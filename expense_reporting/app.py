"""FastAPI application for the expense reporting workflow."""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from expense_reporting.constants import (
    STATUS_APPROVED,
    STATUS_NEEDS_REVIEW,
)
from expense_reporting.exceptions import (
    ExpenseReportingError,
    NotFoundError,
    ReportVerificationError,
    ValidationError,
)
from expense_reporting.models import MonthlyReport, ReviewUpdateInput
from expense_reporting.service import ExpenseService
from expense_reporting.settings import SETTINGS
from expense_reporting.templates import ensure_templates

SETTINGS.ensure_dirs()
ensure_templates(SETTINGS)

app = FastAPI(title="Expense Reporting Tool", version="0.1.0")
templates = Jinja2Templates(directory=str(SETTINGS.templates_dir))
service = ExpenseService()


class ReviewPayload(BaseModel):
    merchant: str | None = None
    receipt_date: str | None = None
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

    def to_review_update(self) -> ReviewUpdateInput:
        parsed_date = None
        if self.receipt_date:
            parsed_date = datetime.strptime(self.receipt_date, "%Y-%m-%d").date()
        return ReviewUpdateInput(
            merchant=self.merchant,
            receipt_date=parsed_date,
            department=self.department,
            location=self.location,
            category=self.category,
            subtotal_cents=self.subtotal_cents,
            tax_cents=self.tax_cents,
            tip_cents=self.tip_cents,
            total_cents=self.total_cents,
            notes=self.notes,
            payment_method=self.payment_method,
            receipt_number=self.receipt_number,
            line_items=self.line_items,
            approve=self.approve,
            reject=self.reject,
            mark_needs_review=self.mark_needs_review,
            confirm_low_confidence_review=self.confirm_low_confidence_review,
        )


def _json_error(message: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": message})


@app.exception_handler(ValidationError)
async def validation_error_handler(_: Request, exc: ValidationError) -> JSONResponse:
    return _json_error(str(exc), status_code=422)


@app.exception_handler(NotFoundError)
async def not_found_error_handler(_: Request, exc: NotFoundError) -> JSONResponse:
    return _json_error(str(exc), status_code=404)


@app.exception_handler(ReportVerificationError)
async def verification_error_handler(_: Request, exc: ReportVerificationError) -> JSONResponse:
    return _json_error(str(exc), status_code=409)


@app.exception_handler(ExpenseReportingError)
async def domain_error_handler(_: Request, exc: ExpenseReportingError) -> JSONResponse:
    return _json_error(str(exc), status_code=400)


@app.get("/", response_class=HTMLResponse)
async def dashboard_page(request: Request) -> HTMLResponse:
    dashboard = service.dashboard()
    return templates.TemplateResponse(
        request=request,
        name="dashboard.html",
        context={"dashboard": dashboard},
    )


@app.get("/upload", response_class=HTMLResponse)
async def upload_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request=request, name="upload.html", context={})


@app.get("/review-queue", response_class=HTMLResponse)
async def review_queue_page(request: Request) -> HTMLResponse:
    receipts = service.list_receipts(status=STATUS_NEEDS_REVIEW)
    return templates.TemplateResponse(
        request=request,
        name="review_queue.html",
        context={"receipts": receipts},
    )


@app.get("/approved", response_class=HTMLResponse)
async def approved_page(request: Request) -> HTMLResponse:
    approved = service.list_receipts(status=STATUS_APPROVED)
    return templates.TemplateResponse(
        request=request,
        name="approved_receipts.html",
        context={"receipts": approved},
    )


@app.get("/reports", response_class=HTMLResponse)
async def reports_page(request: Request) -> HTMLResponse:
    reports = service.list_saved_reports()
    return templates.TemplateResponse(
        request=request,
        name="reports.html",
        context={"reports": reports},
    )


@app.get("/settings", response_class=HTMLResponse)
async def settings_page(request: Request) -> HTMLResponse:
    taxonomy = service.taxonomy()
    return templates.TemplateResponse(
        request=request,
        name="settings.html",
        context={"taxonomy": taxonomy},
    )


@app.post("/api/receipts/upload")
async def upload_receipt(
    file: UploadFile = File(...),
    allow_duplicate: bool = False,
) -> dict[str, Any]:
    if not file.filename:
        raise ValidationError("Uploaded file must include a filename.")
    file_bytes = await file.read()
    return service.upload_receipt(
        file.filename,
        file_bytes,
        allow_duplicate=allow_duplicate,
    ).model_dump(mode="json")


@app.post("/api/receipts/{receipt_id}/ocr")
async def process_ocr(receipt_id: str) -> dict[str, Any]:
    record = service.run_ocr(receipt_id)
    return record.model_dump(mode="json")


@app.get("/api/receipts")
async def list_receipts(status: str | None = None) -> list[dict[str, Any]]:
    return [item.model_dump(mode="json") for item in service.list_receipts(status=status)]


@app.get("/api/receipts/{receipt_id}")
async def get_receipt(receipt_id: str) -> dict[str, Any]:
    return service.get_receipt(receipt_id).model_dump(mode="json")


@app.post("/api/receipts/{receipt_id}/review")
async def review_receipt(receipt_id: str, payload: ReviewPayload) -> dict[str, Any]:
    try:
        update = payload.to_review_update()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Date must use YYYY-MM-DD format.") from exc
    return service.update_review(receipt_id, update).model_dump(mode="json")


@app.post("/api/receipts/{receipt_id}/review-form")
async def review_receipt_form(
    receipt_id: str,
    merchant: str | None = Form(default=None),
    receipt_date: str | None = Form(default=None),
    department: str | None = Form(default=None),
    location: str | None = Form(default=None),
    category: str | None = Form(default=None),
    subtotal_cents: int | None = Form(default=None),
    tax_cents: int | None = Form(default=None),
    tip_cents: int | None = Form(default=None),
    total_cents: int | None = Form(default=None),
    notes: str | None = Form(default=None),
    payment_method: str | None = Form(default=None),
    receipt_number: str | None = Form(default=None),
    line_items: str | None = Form(default=None),
    approve: bool = Form(default=False),
    reject: bool = Form(default=False),
    mark_needs_review: bool = Form(default=False),
    confirm_low_confidence_review: bool = Form(default=False),
) -> dict[str, Any]:
    payload = ReviewPayload(
        merchant=merchant,
        receipt_date=receipt_date,
        department=department,
        location=location,
        category=category,
        subtotal_cents=subtotal_cents,
        tax_cents=tax_cents,
        tip_cents=tip_cents,
        total_cents=total_cents,
        notes=notes,
        payment_method=payment_method,
        receipt_number=receipt_number,
        line_items=line_items,
        approve=approve,
        reject=reject,
        mark_needs_review=mark_needs_review,
        confirm_low_confidence_review=confirm_low_confidence_review,
    )
    try:
        update = payload.to_review_update()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Date must use YYYY-MM-DD format.") from exc
    return service.update_review(receipt_id, update).model_dump(mode="json")


@app.get("/api/dashboard")
async def dashboard_data() -> dict[str, Any]:
    return service.dashboard()


@app.get("/api/taxonomy")
async def taxonomy_data() -> dict[str, list[str]]:
    return service.taxonomy()


@app.post("/api/reports/{report_month}")
async def generate_report(report_month: str) -> dict[str, Any]:
    if not _valid_month(report_month):
        raise ValidationError("Report month must be in YYYY-MM format.")
    report = service.create_monthly_report(report_month)
    return report.model_dump(mode="json")


@app.get("/api/reports")
async def list_reports() -> list[dict[str, Any]]:
    return [report.model_dump(mode="json") for report in service.list_saved_reports()]


@app.get("/api/reports/{report_month}")
async def get_report(report_month: str) -> dict[str, Any]:
    if not _valid_month(report_month):
        raise ValidationError("Report month must be in YYYY-MM format.")
    report = service.get_saved_report(report_month)
    if report is None:
        raise NotFoundError(f"Report {report_month} not found.")
    return report.model_dump(mode="json")


def _report_or_404(report_month: str) -> MonthlyReport:
    if not _valid_month(report_month):
        raise ValidationError("Report month must be in YYYY-MM format.")
    report = service.get_saved_report(report_month)
    if report is None:
        raise NotFoundError(f"Report {report_month} not found.")
    return report


@app.get("/api/reports/{report_month}/export/csv")
async def export_csv(report_month: str) -> FileResponse:
    report = _report_or_404(report_month)
    output = SETTINGS.reports_dir / f"{report_month}.csv"
    service.export_csv(report, output)
    return FileResponse(path=output, filename=output.name, media_type="text/csv")


@app.get("/api/reports/{report_month}/export/pdf")
async def export_pdf(report_month: str) -> FileResponse:
    report = _report_or_404(report_month)
    output = SETTINGS.reports_dir / f"{report_month}.pdf"
    service.export_pdf(report, output)
    return FileResponse(path=output, filename=output.name, media_type="application/pdf")


@app.get("/api/reports/{report_month}/export/xlsx")
async def export_xlsx(report_month: str) -> FileResponse:
    report = _report_or_404(report_month)
    output = SETTINGS.reports_dir / f"{report_month}.xlsx"
    service.export_xlsx(report, output)
    return FileResponse(
        path=output,
        filename=output.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.get("/receipts/{receipt_id}/file")
async def view_receipt_file(receipt_id: str) -> FileResponse:
    record = service.get_receipt(receipt_id)
    path = Path(record.file_path)
    if not path.exists():
        raise NotFoundError("Original receipt file is missing from storage.")
    return FileResponse(path=path, filename=record.file_name)


def _valid_month(report_month: str) -> bool:
    return bool(re.fullmatch(r"\d{4}-\d{2}", report_month))

