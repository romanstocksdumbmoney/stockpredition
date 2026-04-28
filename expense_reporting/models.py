"""Pydantic models for receipts, OCR extraction, and monthly reports."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator

from expense_reporting.constants import (
    CONFIDENCE_LEVELS,
    CONFIDENCE_NEEDS_REVIEW,
    RECEIPT_STATUSES,
    STATUS_APPROVED,
    STATUS_NEEDS_REVIEW,
)
from expense_reporting.money import sum_components


ConfidenceLevel = Literal[
    "High confidence",
    "Medium confidence",
    "Low confidence",
    "Needs manual review",
]

ReceiptStatus = Literal[
    "Uploaded",
    "OCR processed",
    "Needs review",
    "Approved",
    "Rejected",
    "Included in report",
]


class OCRExtractedField(BaseModel):
    value: str | None = None
    confidence: ConfidenceLevel = CONFIDENCE_NEEDS_REVIEW

    @model_validator(mode="after")
    def validate_confidence(self) -> "OCRExtractedField":
        if self.confidence not in CONFIDENCE_LEVELS:
            raise ValueError(f"Unsupported confidence level: {self.confidence}")
        return self


class OCRExtractionResult(BaseModel):
    merchant: OCRExtractedField = Field(default_factory=OCRExtractedField)
    receipt_date: OCRExtractedField = Field(default_factory=OCRExtractedField)
    subtotal: OCRExtractedField = Field(default_factory=OCRExtractedField)
    tax: OCRExtractedField = Field(default_factory=OCRExtractedField)
    tip: OCRExtractedField = Field(default_factory=OCRExtractedField)
    total: OCRExtractedField = Field(default_factory=OCRExtractedField)
    payment_method: OCRExtractedField = Field(default_factory=OCRExtractedField)
    receipt_number: OCRExtractedField = Field(default_factory=OCRExtractedField)
    line_items: OCRExtractedField = Field(default_factory=OCRExtractedField)
    raw_text: str = ""
    low_confidence_fields: list[str] = Field(default_factory=list)


class ApprovedReceiptData(BaseModel):
    merchant: str | None = None
    receipt_date: date | None = None
    department: str | None = None
    location: str | None = None
    category: str | None = None
    subtotal_cents: int | None = None
    tax_cents: int | None = None
    tip_cents: int | None = None
    total_cents: int | None = None
    notes: str | None = None
    payment_method: str | None = None
    receipt_number: str | None = None
    line_items: str | None = None

    def total_consistency_error(self) -> str | None:
        expected = sum_components(self.subtotal_cents, self.tax_cents, self.tip_cents)
        if expected is not None and self.total_cents is not None and expected != self.total_cents:
            return "Total mismatch: subtotal + tax + tip must equal total before approval."
        return None


class ReceiptRecord(BaseModel):
    receipt_id: str = Field(default_factory=lambda: str(uuid4()))
    file_name: str
    file_path: str
    file_hash: str
    status: ReceiptStatus
    ocr: OCRExtractionResult = Field(default_factory=OCRExtractionResult)
    approved: ApprovedReceiptData = Field(default_factory=ApprovedReceiptData)
    confidence_score: float = 0.0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    report_month: str | None = None
    duplicate_warning: str | None = None
    verification_error: str | None = None
    manual_review_confirmed: bool = False

    @model_validator(mode="after")
    def validate_status(self) -> "ReceiptRecord":
        if self.status not in RECEIPT_STATUSES:
            raise ValueError(f"Unsupported status: {self.status}")
        if self.status == STATUS_APPROVED:
            self.ensure_required_approved_fields()
        return self

    def ensure_required_approved_fields(self) -> None:
        required_missing = []
        if not self.approved.receipt_date:
            required_missing.append("Date")
        if not self.approved.merchant:
            required_missing.append("Merchant")
        if not (self.approved.department or self.approved.location):
            required_missing.append("Department or location")
        if not self.approved.category:
            required_missing.append("Category")
        if self.approved.total_cents is None:
            required_missing.append("Total")
        if required_missing:
            raise ValueError(f"Missing required approved fields: {', '.join(required_missing)}")


class ReceiptSummaryRow(BaseModel):
    receipt_id: str
    receipt_date: date
    merchant: str
    department: str | None
    location: str | None
    category: str | None
    subtotal_cents: int | None
    tax_cents: int | None
    tip_cents: int | None
    total_cents: int
    status: ReceiptStatus
    file_path: str


class MonthlyReport(BaseModel):
    report_month: str
    total_expense_cents: int
    tax_total_cents: int
    receipt_count: int
    total_by_department: dict[str, int]
    total_by_location: dict[str, int]
    total_by_category: dict[str, int]
    largest_expenses: list[ReceiptSummaryRow]
    receipts: list[ReceiptSummaryRow]
    verified: bool = False
    verification_message: str | None = None


class ReviewUpdateInput(BaseModel):
    merchant: str | None = None
    receipt_date: date | None = None
    department: str | None = None
    location: str | None = None
    category: str | None = None
    subtotal_cents: int | None = None
    tax_cents: int | None = None
    tip_cents: int | None = None
    total_cents: int | None = None
    notes: str | None = None
    payment_method: str | None = None
    receipt_number: str | None = None
    line_items: str | None = None
    approve: bool = False
    reject: bool = False
    mark_needs_review: bool = False
    confirm_low_confidence_review: bool = False

    @model_validator(mode="after")
    def validate_actions(self) -> "ReviewUpdateInput":
        selected = [self.approve, self.reject, self.mark_needs_review]
        if sum(1 for x in selected if x) > 1:
            raise ValueError("Only one action can be set at a time.")
        if self.approve and self.total_cents is None:
            # Total is required, but callers may rely on existing approved value.
            pass
        return self

