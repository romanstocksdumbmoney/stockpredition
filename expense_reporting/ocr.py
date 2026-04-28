"""OCR extraction and confidence scoring logic."""

from __future__ import annotations

import re
from pathlib import Path

from pypdf import PdfReader

from expense_reporting.constants import (
    CONFIDENCE_HIGH,
    CONFIDENCE_LOW,
    CONFIDENCE_MEDIUM,
    CONFIDENCE_NEEDS_REVIEW,
)
from expense_reporting.models import OCRExtractedField, OCRExtractionResult

MONEY_PATTERN = re.compile(r"\$?\s*([0-9]+(?:[.,][0-9]{2})?)")
DATE_PATTERN = re.compile(r"(\d{4}-\d{2}-\d{2}|\d{2}/\d{2}/\d{4})")
RECEIPT_NUMBER_PATTERN = re.compile(
    r"(?:receipt|invoice|txn|transaction)\s*(?:#|no|number)?\s*[:\-]?\s*([A-Za-z0-9\-]+)",
    re.IGNORECASE,
)


def _confidence_from_signal(signal: str | None) -> str:
    if not signal:
        return CONFIDENCE_NEEDS_REVIEW
    if len(signal.strip()) >= 8:
        return CONFIDENCE_HIGH
    if len(signal.strip()) >= 4:
        return CONFIDENCE_MEDIUM
    return CONFIDENCE_LOW


def _extract_text_from_pdf(file_path: Path) -> str:
    text_parts: list[str] = []
    try:
        reader = PdfReader(str(file_path))
        for page in reader.pages:
            text_parts.append(page.extract_text() or "")
    except Exception:
        return ""
    return "\n".join(text_parts).strip()


def _extract_text_from_image(file_path: Path) -> str:
    try:
        import pytesseract
        from PIL import Image
    except Exception:
        return ""
    try:
        return pytesseract.image_to_string(Image.open(file_path))
    except Exception:
        return ""


def parse_ocr_text(raw_text: str) -> OCRExtractionResult:
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    merchant = lines[0] if lines else None
    date_match = DATE_PATTERN.search(raw_text)
    date_value = date_match.group(1) if date_match else None

    amounts = MONEY_PATTERN.findall(raw_text)
    cleaned_amounts = [amount.replace(",", "") for amount in amounts]

    subtotal = _extract_field_near_keyword(raw_text, "subtotal")
    tax = _extract_field_near_keyword(raw_text, "tax")
    tip = _extract_field_near_keyword(raw_text, "tip")
    total = _extract_field_near_keyword(raw_text, "total")

    payment_method = _extract_payment_method(raw_text)
    receipt_number_match = RECEIPT_NUMBER_PATTERN.search(raw_text)
    receipt_number = receipt_number_match.group(1) if receipt_number_match else None
    line_items = _extract_line_items(lines)

    result = OCRExtractionResult(
        merchant=OCRExtractedField(value=merchant, confidence=_confidence_from_signal(merchant)),
        receipt_date=OCRExtractedField(value=date_value, confidence=_confidence_from_signal(date_value)),
        subtotal=OCRExtractedField(value=subtotal, confidence=_confidence_from_signal(subtotal)),
        tax=OCRExtractedField(value=tax, confidence=_confidence_from_signal(tax)),
        tip=OCRExtractedField(value=tip, confidence=_confidence_from_signal(tip)),
        total=OCRExtractedField(value=total or (cleaned_amounts[-1] if cleaned_amounts else None), confidence=_confidence_from_signal(total or (cleaned_amounts[-1] if cleaned_amounts else None))),
        payment_method=OCRExtractedField(value=payment_method, confidence=_confidence_from_signal(payment_method)),
        receipt_number=OCRExtractedField(value=receipt_number, confidence=_confidence_from_signal(receipt_number)),
        line_items=OCRExtractedField(value=line_items, confidence=_confidence_from_signal(line_items)),
        raw_text=raw_text,
    )

    low_confidence_fields: list[str] = []
    for field_name in [
        "merchant",
        "receipt_date",
        "subtotal",
        "tax",
        "tip",
        "total",
        "payment_method",
        "receipt_number",
        "line_items",
    ]:
        field = getattr(result, field_name)
        if field.confidence in {CONFIDENCE_LOW, CONFIDENCE_NEEDS_REVIEW}:
            low_confidence_fields.append(field_name)

    result.low_confidence_fields = low_confidence_fields
    return result


def extract_from_file(file_path: Path) -> OCRExtractionResult:
    suffix = file_path.suffix.lower()
    raw_text = _extract_text_from_pdf(file_path) if suffix == ".pdf" else _extract_text_from_image(file_path)
    if not raw_text.strip():
        return OCRExtractionResult(
            raw_text="",
            low_confidence_fields=[
                "merchant",
                "receipt_date",
                "subtotal",
                "tax",
                "tip",
                "total",
            ],
        )
    return parse_ocr_text(raw_text)


def _extract_field_near_keyword(raw_text: str, keyword: str) -> str | None:
    pattern = re.compile(rf"{keyword}\s*[:\-]?\s*\$?\s*([0-9]+(?:[.,][0-9]{{2}})?)", re.IGNORECASE)
    match = pattern.search(raw_text)
    if not match:
        return None
    return match.group(1).replace(",", "")


def _extract_payment_method(raw_text: str) -> str | None:
    lowered = raw_text.lower()
    if "visa" in lowered:
        return "Visa"
    if "mastercard" in lowered:
        return "Mastercard"
    if "amex" in lowered:
        return "Amex"
    if "cash" in lowered:
        return "Cash"
    if "debit" in lowered:
        return "Debit"
    return None


def _extract_line_items(lines: list[str]) -> str | None:
    if not lines:
        return None
    candidates = [
        line for line in lines
        if not DATE_PATTERN.search(line) and not MONEY_PATTERN.fullmatch(line.strip())
    ]
    if len(candidates) < 2:
        return None
    snippet = candidates[1:6]
    return "\n".join(snippet)
