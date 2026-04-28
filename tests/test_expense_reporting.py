from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

import pytest

from expense_reporting.exceptions import ReportVerificationError, ValidationError
from expense_reporting.models import ReviewUpdateInput
from expense_reporting.money import cents_from_string
from expense_reporting.ocr import parse_ocr_text


def test_money_math_in_cents_is_decimal_safe() -> None:
    assert cents_from_string("12.34") == 1234
    assert cents_from_string("$0.10") == 10
    assert cents_from_string("1,234.56") == 123456


def test_subtotal_tax_tip_must_equal_total_before_approval(service) -> None:
    record = service.upload_receipt("receipt.png", b"fake-image")
    with pytest.raises(ValidationError):
        service.update_review(
            record.receipt_id,
            ReviewUpdateInput(
                merchant="Cafe",
                receipt_date=date(2026, 4, 9),
                department="Sales",
                location="Store 1",
                category="Meals",
                subtotal_cents=1000,
                tax_cents=80,
                tip_cents=100,
                total_cents=1000,
                approve=True,
                confirm_low_confidence_review=True,
            ),
        )

    pending = service.get_receipt(record.receipt_id)
    assert pending.status == "Uploaded"


def test_duplicate_detection_by_hash_blocks_default_upload(service) -> None:
    payload = b"same-file-content"
    service.upload_receipt("one.jpg", payload)
    with pytest.raises(ValidationError):
        service.upload_receipt("two.jpg", payload)


def test_low_confidence_receipt_requires_manual_review_before_approval(service) -> None:
    record = service.upload_receipt("receipt.jpg", b"img-bytes")
    service.run_ocr(record.receipt_id)  # no OCR libs/text => low confidence

    with pytest.raises(ValidationError):
        service.update_review(
            record.receipt_id,
            ReviewUpdateInput(
                merchant="Office Depot",
                receipt_date=date(2026, 4, 1),
                department="Admin",
                category="Office supplies",
                total_cents=1234,
                approve=True,
            ),
        )

    updated = service.update_review(
        record.receipt_id,
        ReviewUpdateInput(
            merchant="Office Depot",
            receipt_date=date(2026, 4, 1),
            department="Admin",
            category="Office supplies",
            subtotal_cents=1000,
            tax_cents=234,
            tip_cents=0,
            total_cents=1234,
            approve=True,
            confirm_low_confidence_review=True,
        ),
    )
    assert updated.status == "Approved"
    assert updated.manual_review_confirmed is True


def test_monthly_report_totals_and_groupings_match_receipts(service) -> None:
    for merchant, dept, loc, cat, total in [
        ("Vendor A", "Sales", "Raleigh", "Meals", 1000),
        ("Vendor B", "Sales", "Raleigh", "Travel", 2000),
        ("Vendor C", "Marketing", "Charlotte", "Software", 3000),
    ]:
        record = service.upload_receipt(f"{merchant}.pdf", f"{merchant}-bytes".encode())
        service.update_review(
            record.receipt_id,
            ReviewUpdateInput(
                merchant=merchant,
                receipt_date=date(2026, 4, 10),
                department=dept,
                location=loc,
                category=cat,
                subtotal_cents=total,
                tax_cents=0,
                tip_cents=0,
                total_cents=total,
                approve=True,
                confirm_low_confidence_review=True,
            ),
        )

    report = service.create_monthly_report("2026-04")
    assert report.total_expense_cents == 6000
    assert report.total_by_department == {"Sales": 3000, "Marketing": 3000}
    assert report.total_by_location == {"Raleigh": 3000, "Charlotte": 3000}
    assert report.total_by_category == {"Meals": 1000, "Travel": 2000, "Software": 3000}
    assert report.receipt_count == 3
    assert report.verified is True
    assert report.verification_message == "Report verified successfully"


def test_report_verification_blocks_unbalanced_exports(service) -> None:
    record = service.upload_receipt("bad.png", b"bad")
    service.update_review(
        record.receipt_id,
        ReviewUpdateInput(
            merchant="Mismatch Co",
            receipt_date=date(2026, 4, 1),
            department="Operations",
            location="Store 2",
            category="Equipment",
            subtotal_cents=500,
            tax_cents=50,
            tip_cents=0,
            total_cents=550,
            approve=True,
            confirm_low_confidence_review=True,
        ),
    )
    report = service.create_monthly_report("2026-04")
    report.total_by_department["Operations"] = 1
    with pytest.raises(ReportVerificationError):
        service.export_csv(report, service.settings.reports_dir / "broken.csv")


def test_csv_export_matches_report_totals(service) -> None:
    receipt = service.upload_receipt("export.jpg", b"123")
    service.update_review(
        receipt.receipt_id,
        ReviewUpdateInput(
            merchant="Export Inc",
            receipt_date=date(2026, 4, 12),
            department="Travel",
            location="Online",
            category="Travel",
            subtotal_cents=2500,
            tax_cents=250,
            tip_cents=0,
            total_cents=2750,
            approve=True,
            confirm_low_confidence_review=True,
        ),
    )
    report = service.create_monthly_report("2026-04")
    csv_path = service.export_csv(report, service.settings.reports_dir / "2026-04.csv")
    rows = list(csv.DictReader(csv_path.open("r", encoding="utf-8")))
    row_total_sum = sum(cents_from_string(row["Total"]) for row in rows)
    assert row_total_sum == report.total_expense_cents


def test_ocr_parser_flags_missing_and_low_confidence_fields() -> None:
    parsed = parse_ocr_text("Tiny\nTotal 9")
    assert "total" in parsed.low_confidence_fields or "merchant" in parsed.low_confidence_fields


def test_upload_page_exposes_camera_capture_flow(client) -> None:
    response = client.get("/upload")
    assert response.status_code == 200
    html = response.text
    assert "Take photo and scan" in html
    assert "Start Camera" in html
    assert "Capture & Scan" in html
    assert "navigator.mediaDevices.getUserMedia" in html


def test_final_acceptance_flow(client) -> None:
    upload = client.post(
        "/api/receipts/upload",
        files={"file": ("receipt.pdf", b"pdf data", "application/pdf")},
    )
    assert upload.status_code == 200
    receipt_id = upload.json()["receipt_id"]

    ocr = client.post(f"/api/receipts/{receipt_id}/ocr")
    assert ocr.status_code == 200
    assert ocr.json()["status"] in {"Needs review", "OCR processed"}

    review = client.post(
        f"/api/receipts/{receipt_id}/review",
        json={
            "merchant": "Client Lunch",
            "receipt_date": "2026-04-15",
            "department": "Sales",
            "location": "Raleigh",
            "category": "Meals",
            "subtotal_cents": 1800,
            "tax_cents": 144,
            "tip_cents": 200,
            "total_cents": 2144,
            "approve": True,
            "confirm_low_confidence_review": True,
        },
    )
    assert review.status_code == 200
    assert review.json()["status"] == "Approved"

    approved = client.get("/api/receipts", params={"status": "Approved"})
    assert approved.status_code == 200
    assert any(item["receipt_id"] == receipt_id for item in approved.json())

    report = client.post("/api/reports/2026-04")
    assert report.status_code == 200
    report_payload = report.json()
    assert report_payload["verification_message"] == "Report verified successfully"
    assert report_payload["receipt_count"] == 1
    assert report_payload["total_expense_cents"] == 2144
    statuses = {row["status"] for row in report_payload["receipts"]}
    assert statuses == {"Included in report"}

    csv_export = client.get("/api/reports/2026-04/export/csv")
    assert csv_export.status_code == 200
    assert "Date,Merchant,Department" in csv_export.text
    assert "$21.44" in csv_export.text

    pdf_export = client.get("/api/reports/2026-04/export/pdf")
    assert pdf_export.status_code == 200
    assert pdf_export.headers["content-type"].startswith("application/pdf")

    xlsx_export = client.get("/api/reports/2026-04/export/xlsx")
    assert xlsx_export.status_code == 200
    assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in xlsx_export.headers["content-type"]
