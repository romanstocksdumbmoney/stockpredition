"""Core business logic for receipt lifecycle and monthly reporting."""

from __future__ import annotations

import csv
import hashlib
import json
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

from openpyxl import Workbook
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from expense_reporting.constants import (
    CONFIDENCE_HIGH,
    CONFIDENCE_LOW,
    CONFIDENCE_MEDIUM,
    CONFIDENCE_NEEDS_REVIEW,
    DEFAULT_CATEGORIES,
    DEFAULT_DEPARTMENTS,
    DEFAULT_LOCATIONS,
    STATUS_APPROVED,
    STATUS_INCLUDED_IN_REPORT,
    STATUS_NEEDS_REVIEW,
    STATUS_OCR_PROCESSED,
    STATUS_REJECTED,
    STATUS_UPLOADED,
    SUPPORTED_EXTENSIONS,
)
from expense_reporting.exceptions import NotFoundError, ReportVerificationError, ValidationError
from expense_reporting.models import (
    ApprovedReceiptData,
    MonthlyReport,
    OCRExtractionResult,
    ReceiptRecord,
    ReceiptSummaryRow,
    ReviewUpdateInput,
)
from expense_reporting.money import cents_from_string, format_cents
from expense_reporting.ocr import extract_from_file
from expense_reporting.settings import AppSettings, SETTINGS
from expense_reporting.storage import ReceiptRepository


class ExpenseService:
    def __init__(
        self,
        repository: ReceiptRepository | None = None,
        settings: AppSettings | None = None,
    ) -> None:
        self.settings = settings or SETTINGS
        self.settings.ensure_dirs()
        self.repository = repository or ReceiptRepository(db_path=self.settings.db_path)
        self.custom_departments: set[str] = set()
        self.custom_locations: set[str] = set()
        self.custom_categories: set[str] = set()

    def upload_receipt(
        self,
        file_name: str,
        file_bytes: bytes,
        allow_duplicate: bool = False,
    ) -> ReceiptRecord:
        extension = Path(file_name).suffix.lower()
        if extension not in SUPPORTED_EXTENSIONS:
            raise ValidationError("Unsupported file format. Use JPG, PNG, or PDF.")

        file_hash = hashlib.sha256(file_bytes).hexdigest()
        matching_hash = [
            receipt for receipt in self.repository.list_receipts() if receipt.file_hash == file_hash
        ]
        if matching_hash and not allow_duplicate:
            duplicate_ids = ", ".join(item.receipt_id for item in matching_hash)
            raise ValidationError(
                f"Potential duplicate receipt detected: {duplicate_ids}. "
                "Set allow_duplicate=true to save anyway."
            )
        stored_name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}_{Path(file_name).name}"
        stored_path = self.settings.uploads_dir / stored_name
        stored_path.write_bytes(file_bytes)

        record = ReceiptRecord(
            file_name=file_name,
            file_path=str(stored_path),
            file_hash=file_hash,
            status=STATUS_UPLOADED,
        )

        record.duplicate_warning = self._duplicate_warning(record)
        self.repository.create(record)
        return record

    def run_ocr(self, receipt_id: str) -> ReceiptRecord:
        record = self._get_or_raise(receipt_id)
        extraction = extract_from_file(Path(record.file_path))
        record.ocr = extraction
        record.confidence_score = self._compute_confidence_score(extraction)
        record.manual_review_confirmed = False
        record.updated_at = datetime.utcnow()
        record.status = STATUS_OCR_PROCESSED
        if self._has_low_confidence_critical_fields(extraction):
            record.status = STATUS_NEEDS_REVIEW
        self._sync_approved_from_ocr(record)
        record.verification_error = self._verify_math(record.approved)
        self.repository.upsert(record)
        return record

    def get_receipt(self, receipt_id: str) -> ReceiptRecord:
        return self._get_or_raise(receipt_id)

    def list_receipts(self, status: str | None = None) -> list[ReceiptRecord]:
        records = self.repository.list_receipts()
        if status is None:
            return records
        return [record for record in records if record.status == status]

    def update_review(self, receipt_id: str, update: ReviewUpdateInput) -> ReceiptRecord:
        record = self._get_or_raise(receipt_id)
        approved = record.approved.model_copy(deep=True)

        for field in [
            "merchant",
            "receipt_date",
            "department",
            "location",
            "category",
            "subtotal_cents",
            "tax_cents",
            "tip_cents",
            "total_cents",
            "notes",
            "payment_method",
            "receipt_number",
            "line_items",
        ]:
            incoming = getattr(update, field)
            if incoming is not None:
                setattr(approved, field, incoming)

        record.approved = ApprovedReceiptData.model_validate(approved.model_dump())
        record.verification_error = self._verify_math(record.approved)
        record.updated_at = datetime.utcnow()
        if update.confirm_low_confidence_review:
            record.manual_review_confirmed = True

        if update.reject:
            record.status = STATUS_REJECTED
        elif update.mark_needs_review:
            record.status = STATUS_NEEDS_REVIEW
        elif update.approve:
            if self._has_low_confidence_critical_fields(record.ocr) and not record.manual_review_confirmed:
                raise ValidationError(
                    "This receipt has low-confidence fields. Please review before approving."
                )
            if record.verification_error:
                raise ValidationError(record.verification_error)
            record.ensure_required_approved_fields()
            record.status = STATUS_APPROVED
        elif record.status not in {STATUS_APPROVED, STATUS_REJECTED}:
            record.status = STATUS_NEEDS_REVIEW

        self._record_taxonomy(approved.department, approved.location, approved.category)
        record.duplicate_warning = self._duplicate_warning(record)
        self.repository.upsert(record)
        return record

    def dashboard(self) -> dict[str, object]:
        now = datetime.utcnow()
        month = f"{now.year:04d}-{now.month:02d}"
        month_records = [r for r in self.repository.list_receipts() if self._record_month(r) == month]
        needs_review = [r for r in month_records if r.status == STATUS_NEEDS_REVIEW]
        approved = [r for r in month_records if r.status == STATUS_APPROVED]

        by_department = self._aggregate_by_key(approved, "department")
        by_location = self._aggregate_by_key(approved, "location")
        by_category = self._aggregate_by_key(approved, "category")
        monthly_spending = sum(r.approved.total_cents or 0 for r in approved)

        return {
            "month": month,
            "receipts_needing_review": len(needs_review),
            "approved_receipts": len(approved),
            "monthly_spending_cents": monthly_spending,
            "spending_by_department": by_department,
            "spending_by_location": by_location,
            "spending_by_category": by_category,
        }

    def taxonomy(self) -> dict[str, list[str]]:
        return {
            "departments": sorted(set(DEFAULT_DEPARTMENTS).union(self.custom_departments)),
            "locations": sorted(set(DEFAULT_LOCATIONS).union(self.custom_locations)),
            "categories": sorted(set(DEFAULT_CATEGORIES).union(self.custom_categories)),
        }

    def create_monthly_report(self, report_month: str) -> MonthlyReport:
        approved = self._approved_receipts_for_month(report_month)
        rows = [self._to_summary_row(record) for record in approved]

        report = MonthlyReport(
            report_month=report_month,
            total_expense_cents=sum(r.total_cents for r in rows),
            tax_total_cents=sum((r.tax_cents or 0) for r in rows),
            receipt_count=len(rows),
            total_by_department=self._aggregate_rows(rows, "department"),
            total_by_location=self._aggregate_rows(rows, "location"),
            total_by_category=self._aggregate_rows(rows, "category"),
            largest_expenses=sorted(rows, key=lambda x: x.total_cents, reverse=True)[:5],
            receipts=rows,
        )
        self.verify_report(report)
        self.audit_report_against_records(report)

        for record in approved:
            record.status = STATUS_INCLUDED_IN_REPORT
            record.report_month = report_month
            record.updated_at = datetime.utcnow()
            self.repository.upsert(record)

        report.receipts = [
            row.model_copy(update={"status": STATUS_INCLUDED_IN_REPORT})
            for row in report.receipts
        ]
        report.largest_expenses = [
            row.model_copy(update={"status": STATUS_INCLUDED_IN_REPORT})
            for row in report.largest_expenses
        ]
        self._save_report(report)
        return report

    def verify_report(self, report: MonthlyReport) -> None:
        department_total = sum(report.total_by_department.values())
        location_total = sum(report.total_by_location.values())
        category_total = sum(report.total_by_category.values())
        grand = report.total_expense_cents

        if department_total != grand:
            raise ReportVerificationError(
                "Department totals do not equal grand total."
            )
        if location_total != grand:
            raise ReportVerificationError(
                "Location totals do not equal grand total."
            )
        if category_total != grand:
            raise ReportVerificationError(
                "Category totals do not equal grand total."
            )

        recomputed = sum(row.total_cents for row in report.receipts)
        if recomputed != grand:
            raise ReportVerificationError("Receipt totals do not equal grand total.")

        report.verified = True
        report.verification_message = "Report verified successfully"

    def audit_report_against_records(self, report: MonthlyReport) -> None:
        receipts_by_id = {receipt.receipt_id: receipt for receipt in self.repository.list_receipts()}
        recomputed_rows: list[ReceiptSummaryRow] = []
        for row in report.receipts:
            record = receipts_by_id.get(row.receipt_id)
            if not record:
                raise ReportVerificationError(
                    f"Receipt {row.receipt_id} from report no longer exists."
                )
            if record.status not in {STATUS_APPROVED, STATUS_INCLUDED_IN_REPORT}:
                raise ReportVerificationError(
                    f"Receipt {row.receipt_id} is not approved for reporting."
                )
            recomputed_rows.append(self._to_summary_row(record))

        recomputed_total = sum(item.total_cents for item in recomputed_rows)
        if recomputed_total != report.total_expense_cents:
            raise ReportVerificationError(
                "Recalculated receipt totals do not match report grand total."
            )

        if self._aggregate_rows(recomputed_rows, "department") != report.total_by_department:
            raise ReportVerificationError(
                "Recalculated department totals do not match report totals."
            )
        if self._aggregate_rows(recomputed_rows, "location") != report.total_by_location:
            raise ReportVerificationError(
                "Recalculated location totals do not match report totals."
            )
        if self._aggregate_rows(recomputed_rows, "category") != report.total_by_category:
            raise ReportVerificationError(
                "Recalculated category totals do not match report totals."
            )

    def export_csv(self, report: MonthlyReport, output_path: Path) -> Path:
        self.verify_report(report)
        self.audit_report_against_records(report)
        with output_path.open("w", newline="", encoding="utf-8") as file_handle:
            writer = csv.writer(file_handle)
            writer.writerow(
                [
                    "Date",
                    "Merchant",
                    "Department",
                    "Location",
                    "Category",
                    "Subtotal",
                    "Tax",
                    "Tip",
                    "Total",
                    "Status",
                    "Receipt ID",
                    "Original Receipt",
                ]
            )
            for row in report.receipts:
                writer.writerow(
                    [
                        row.receipt_date.isoformat(),
                        row.merchant,
                        row.department or "",
                        row.location or "",
                        row.category or "",
                        format_cents(row.subtotal_cents) or "",
                        format_cents(row.tax_cents) or "",
                        format_cents(row.tip_cents) or "",
                        format_cents(row.total_cents),
                        row.status,
                        row.receipt_id,
                        row.file_path,
                    ]
                )
        return output_path

    def export_xlsx(self, report: MonthlyReport, output_path: Path) -> Path:
        self.verify_report(report)
        self.audit_report_against_records(report)
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Monthly Expenses"
        headers = [
            "Date",
            "Merchant",
            "Department",
            "Location",
            "Category",
            "Subtotal (cents)",
            "Tax (cents)",
            "Tip (cents)",
            "Total (cents)",
            "Status",
            "Receipt ID",
            "Original Receipt",
        ]
        sheet.append(headers)
        for row in report.receipts:
            sheet.append(
                [
                    row.receipt_date.isoformat(),
                    row.merchant,
                    row.department or "",
                    row.location or "",
                    row.category or "",
                    row.subtotal_cents or "",
                    row.tax_cents or "",
                    row.tip_cents or "",
                    row.total_cents,
                    row.status,
                    row.receipt_id,
                    row.file_path,
                ]
            )
        workbook.save(output_path)
        return output_path

    def export_pdf(self, report: MonthlyReport, output_path: Path) -> Path:
        self.verify_report(report)
        self.audit_report_against_records(report)
        pdf = canvas.Canvas(str(output_path), pagesize=letter)
        _, height = letter
        y = height - 40
        pdf.setFont("Helvetica-Bold", 14)
        pdf.drawString(40, y, f"Monthly Expense Report - {report.report_month}")
        y -= 24
        pdf.setFont("Helvetica", 10)
        pdf.drawString(40, y, f"Total expenses: {format_cents(report.total_expense_cents)}")
        y -= 14
        pdf.drawString(40, y, f"Tax total: {format_cents(report.tax_total_cents)}")
        y -= 14
        pdf.drawString(40, y, f"Receipt count: {report.receipt_count}")
        y -= 18
        pdf.drawString(40, y, report.verification_message or "")
        y -= 22
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawString(40, y, "Date")
        pdf.drawString(100, y, "Merchant")
        pdf.drawString(240, y, "Dept")
        pdf.drawString(320, y, "Location")
        pdf.drawString(400, y, "Category")
        pdf.drawString(500, y, "Total")
        y -= 14
        pdf.setFont("Helvetica", 8)
        for row in report.receipts:
            if y < 40:
                pdf.showPage()
                y = height - 40
                pdf.setFont("Helvetica", 8)
            pdf.drawString(40, y, row.receipt_date.isoformat())
            pdf.drawString(100, y, row.merchant[:22])
            pdf.drawString(240, y, (row.department or "")[:12])
            pdf.drawString(320, y, (row.location or "")[:12])
            pdf.drawString(400, y, (row.category or "")[:14])
            pdf.drawRightString(570, y, format_cents(row.total_cents) or "")
            y -= 12
        pdf.save()
        return output_path

    def detect_duplicates(self, candidate: ReceiptRecord) -> list[ReceiptRecord]:
        duplicates: list[ReceiptRecord] = []
        for existing in self.repository.list_receipts():
            if existing.receipt_id == candidate.receipt_id:
                continue
            hash_match = existing.file_hash == candidate.file_hash
            receipt_number_match = (
                candidate.approved.receipt_number
                and existing.approved.receipt_number
                and candidate.approved.receipt_number == existing.approved.receipt_number
            )
            merchant_match = (
                candidate.approved.merchant
                and existing.approved.merchant
                and candidate.approved.merchant.strip().lower()
                == existing.approved.merchant.strip().lower()
            )
            date_match = (
                candidate.approved.receipt_date
                and existing.approved.receipt_date
                and candidate.approved.receipt_date == existing.approved.receipt_date
            )
            total_match = (
                candidate.approved.total_cents is not None
                and existing.approved.total_cents is not None
                and candidate.approved.total_cents == existing.approved.total_cents
            )
            if hash_match or receipt_number_match or (merchant_match and date_match and total_match):
                duplicates.append(existing)
        return duplicates

    def _duplicate_warning(self, candidate: ReceiptRecord) -> str | None:
        duplicates = self.detect_duplicates(candidate)
        if not duplicates:
            return None
        duplicate_ids = ", ".join(item.receipt_id for item in duplicates)
        return f"Potential duplicate receipt detected: {duplicate_ids}"

    def _get_or_raise(self, receipt_id: str) -> ReceiptRecord:
        record = self.repository.get(receipt_id)
        if not record:
            raise NotFoundError(f"Receipt {receipt_id} not found.")
        return record

    def _compute_confidence_score(self, extraction: OCRExtractionResult) -> float:
        weights = {
            CONFIDENCE_HIGH: 1.0,
            CONFIDENCE_MEDIUM: 0.65,
            CONFIDENCE_LOW: 0.35,
            CONFIDENCE_NEEDS_REVIEW: 0.0,
        }
        critical_fields = [
            extraction.merchant.confidence,
            extraction.receipt_date.confidence,
            extraction.total.confidence,
            extraction.subtotal.confidence,
            extraction.tax.confidence,
            extraction.tip.confidence,
        ]
        score = sum(weights[c] for c in critical_fields) / len(critical_fields)
        return round(score * 100, 2)

    def _sync_approved_from_ocr(self, record: ReceiptRecord) -> None:
        date_value = self._parse_date(record.ocr.receipt_date.value)
        subtotal = self._to_cents(record.ocr.subtotal.value)
        tax = self._to_cents(record.ocr.tax.value)
        tip = self._to_cents(record.ocr.tip.value)
        total = self._to_cents(record.ocr.total.value)
        record.approved = ApprovedReceiptData(
            merchant=record.ocr.merchant.value,
            receipt_date=date_value,
            subtotal_cents=subtotal,
            tax_cents=tax,
            tip_cents=tip,
            total_cents=total,
            payment_method=record.ocr.payment_method.value,
            receipt_number=record.ocr.receipt_number.value,
            line_items=record.ocr.line_items.value,
        )

    def _to_cents(self, value: str | None) -> int | None:
        if value is None or not value.strip():
            return None
        try:
            return cents_from_string(value)
        except ValueError:
            return None

    def _parse_date(self, value: str | None) -> date | None:
        if not value:
            return None
        for fmt in ("%Y-%m-%d", "%m/%d/%Y"):
            try:
                return datetime.strptime(value, fmt).date()
            except ValueError:
                continue
        return None

    def _verify_math(self, approved: ApprovedReceiptData) -> str | None:
        if approved.total_cents is None:
            return "Missing total. Please review before approval."
        consistency_error = approved.total_consistency_error()
        if consistency_error:
            return "Mismatch detected: subtotal + tax + tip does not equal total."
        return None

    def _has_low_confidence_critical_fields(self, extraction: OCRExtractionResult) -> bool:
        critical = {
            "merchant",
            "receipt_date",
            "total",
            "subtotal",
            "tax",
            "tip",
        }
        return any(field in critical for field in extraction.low_confidence_fields)

    def _record_taxonomy(self, department: str | None, location: str | None, category: str | None) -> None:
        if department:
            self.custom_departments.add(department)
        if location:
            self.custom_locations.add(location)
        if category:
            self.custom_categories.add(category)

    def _record_month(self, record: ReceiptRecord) -> str | None:
        if record.approved.receipt_date:
            return record.approved.receipt_date.strftime("%Y-%m")
        return None

    def _approved_receipts_for_month(self, report_month: str) -> list[ReceiptRecord]:
        approved: list[ReceiptRecord] = []
        for record in self.repository.list_receipts():
            if record.status not in {STATUS_APPROVED, STATUS_INCLUDED_IN_REPORT}:
                continue
            if not record.approved.receipt_date:
                continue
            if record.approved.receipt_date.strftime("%Y-%m") == report_month:
                if record.verification_error:
                    continue
                approved.append(record)
        return approved

    def _aggregate_by_key(self, records: list[ReceiptRecord], key: str) -> dict[str, int]:
        totals: defaultdict[str, int] = defaultdict(int)
        for record in records:
            label = getattr(record.approved, key) or "Unspecified"
            totals[label] += record.approved.total_cents or 0
        return dict(totals)

    def _to_summary_row(self, record: ReceiptRecord) -> ReceiptSummaryRow:
        if not record.approved.receipt_date or not record.approved.merchant:
            raise ValidationError(
                f"Receipt {record.receipt_id} missing required approved fields for report."
            )
        if record.approved.total_cents is None:
            raise ValidationError(f"Receipt {record.receipt_id} missing total for report.")
        return ReceiptSummaryRow(
            receipt_id=record.receipt_id,
            receipt_date=record.approved.receipt_date,
            merchant=record.approved.merchant,
            department=record.approved.department,
            location=record.approved.location,
            category=record.approved.category,
            subtotal_cents=record.approved.subtotal_cents,
            tax_cents=record.approved.tax_cents,
            tip_cents=record.approved.tip_cents,
            total_cents=record.approved.total_cents,
            status=record.status,
            file_path=record.file_path,
        )

    def _aggregate_rows(self, rows: list[ReceiptSummaryRow], key: str) -> dict[str, int]:
        totals: defaultdict[str, int] = defaultdict(int)
        for row in rows:
            label = getattr(row, key) or "Unspecified"
            totals[label] += row.total_cents
        return dict(totals)

    def get_saved_report(self, report_month: str) -> MonthlyReport | None:
        report_path = self._report_path(report_month)
        if not report_path.exists():
            return None
        payload = json.loads(report_path.read_text(encoding="utf-8"))
        return MonthlyReport.model_validate(payload)

    def list_saved_reports(self) -> list[MonthlyReport]:
        reports: list[MonthlyReport] = []
        for path in sorted(self.settings.reports_dir.glob("*.json")):
            payload = json.loads(path.read_text(encoding="utf-8"))
            reports.append(MonthlyReport.model_validate(payload))
        return reports

    def _save_report(self, report: MonthlyReport) -> None:
        report_path = self._report_path(report.report_month)
        report_path.write_text(
            json.dumps(report.model_dump(mode="json"), indent=2),
            encoding="utf-8",
        )

    def _report_path(self, report_month: str) -> Path:
        return self.settings.reports_dir / f"{report_month}.json"
