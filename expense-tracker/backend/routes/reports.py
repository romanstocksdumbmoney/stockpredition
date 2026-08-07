import json
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from io import BytesIO
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import and_, desc, func, select
from sqlalchemy.orm import Session

from database import get_db
from models import ExpenseReport, Receipt, User
from routes.auth import get_current_user
from services.csv_export import generate_receipts_csv
from services.pdf_export import generate_report_pdf

router = APIRouter(prefix="/api/reports", tags=["reports"])


class PDFExportPayload(BaseModel):
    report_type: str
    period_start: date
    period_end: date


class CSVExportPayload(BaseModel):
    date_from: date
    date_to: date


def _fetch_receipts(db: Session, user_id: str, start: date, end: date) -> list[Receipt]:
    return db.scalars(
        select(Receipt)
        .where(
            and_(
                Receipt.user_id == user_id,
                Receipt.transaction_date >= start,
                Receipt.transaction_date <= end,
            )
        )
        .order_by(desc(Receipt.transaction_date), desc(Receipt.uploaded_at))
    ).all()


def _amount(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _aggregate(
    receipts: list[Receipt], start: date, end: date, bucket: str = "day", include_empty_days: bool = True
) -> dict[str, Any]:
    receipt_dicts = [receipt.as_dict() for receipt in receipts]
    total_amount = sum(_amount(item["total_amount"]) for item in receipt_dicts)
    receipt_count = len(receipt_dicts)
    days = max((end - start).days + 1, 1)
    daily_average = total_amount / days

    by_category_raw: dict[str, dict[str, Any]] = defaultdict(lambda: {"amount": 0.0, "count": 0})
    merchant_raw: dict[str, dict[str, Any]] = defaultdict(lambda: {"amount": 0.0, "count": 0})
    by_day_raw: dict[str, dict[str, Any]] = defaultdict(lambda: {"amount": 0.0, "count": 0})

    for receipt in receipt_dicts:
        amount = _amount(receipt.get("total_amount"))
        category = receipt.get("category") or "Other"
        merchant = receipt.get("merchant_name") or "Unknown Merchant"
        when = receipt.get("transaction_date")
        when_date = date.fromisoformat(when) if when else start

        by_category_raw[category]["amount"] += amount
        by_category_raw[category]["count"] += 1
        merchant_raw[merchant]["amount"] += amount
        merchant_raw[merchant]["count"] += 1

        if bucket == "week":
            week_start = when_date - timedelta(days=when_date.weekday())
            day_key = week_start.isoformat()
        else:
            day_key = when_date.isoformat()

        by_day_raw[day_key]["amount"] += amount
        by_day_raw[day_key]["count"] += 1

    by_category = []
    for category, values in by_category_raw.items():
        percent = (values["amount"] / total_amount * 100) if total_amount else 0
        by_category.append(
            {
                "category": category,
                "amount": round(values["amount"], 2),
                "count": values["count"],
                "percentage": round(percent, 2),
            }
        )
    by_category.sort(key=lambda row: row["amount"], reverse=True)

    by_day = []
    if include_empty_days and bucket == "day":
        cursor = start
        while cursor <= end:
            day_key = cursor.isoformat()
            values = by_day_raw.get(day_key, {"amount": 0.0, "count": 0})
            by_day.append({"date": day_key, "amount": round(values["amount"], 2), "count": values["count"]})
            cursor += timedelta(days=1)
    else:
        for day_key, values in sorted(by_day_raw.items()):
            by_day.append({"date": day_key, "amount": round(values["amount"], 2), "count": values["count"]})

    top_merchants = [
        {"name": name, "amount": round(values["amount"], 2), "count": values["count"]}
        for name, values in merchant_raw.items()
    ]
    top_merchants.sort(key=lambda row: row["amount"], reverse=True)
    top_merchants = top_merchants[:10]

    return {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "total_amount": round(total_amount, 2),
        "receipt_count": receipt_count,
        "daily_average": round(daily_average, 2),
        "by_category": by_category,
        "by_day": by_day,
        "top_merchants": top_merchants,
        "receipts": receipt_dicts,
    }


def _compare_period(
    db: Session, user_id: str, start: date, end: date, current_amount: float, label: str
) -> dict[str, Any]:
    period_days = (end - start).days + 1
    previous_end = start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=period_days - 1)
    previous_receipts = _fetch_receipts(db, user_id, previous_start, previous_end)
    previous_amount = sum(_amount(receipt.total_amount) for receipt in previous_receipts)
    if previous_amount == 0:
        pct_change = 100.0 if current_amount > 0 else 0.0
    else:
        pct_change = ((current_amount - previous_amount) / previous_amount) * 100
    return {f"amount": round(previous_amount, 2), "percentage_change": round(pct_change, 2), "label": label}


def _store_report(
    db: Session,
    user: User,
    report_type: str,
    period_start: date,
    period_end: date,
    report_data: dict[str, Any],
) -> None:
    report = ExpenseReport(
        user_id=user.id,
        report_type=report_type,
        period_start=period_start,
        period_end=period_end,
        total_amount=Decimal(str(report_data.get("total_amount", 0))),
        receipt_count=report_data.get("receipt_count", 0),
        report_data_json=json.dumps(report_data),
    )
    db.add(report)
    db.commit()


def _resolve_week(week: str | None) -> tuple[date, date]:
    today = date.today()
    if not week:
        week_start = today - timedelta(days=today.weekday())
    else:
        try:
            year, week_num = week.split("-")
            week_start = date.fromisocalendar(int(year), int(week_num), 1)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Week must use format YYYY-WW.") from exc
    week_end = week_start + timedelta(days=6)
    return week_start, week_end


def _resolve_month(month: str | None) -> tuple[date, date]:
    today = date.today()
    if not month:
        start = today.replace(day=1)
    else:
        try:
            start = datetime.strptime(f"{month}-01", "%Y-%m-%d").date()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Month must use format YYYY-MM.") from exc
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1, day=1) - timedelta(days=1)
    else:
        end = start.replace(month=start.month + 1, day=1) - timedelta(days=1)
    return start, end


@router.get("/weekly")
def weekly_report(
    week: str | None = Query(default=None, description="YYYY-WW"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    start, end = _resolve_week(week)
    receipts = _fetch_receipts(db, current_user.id, start, end)
    report = _aggregate(receipts, start, end, bucket="day")
    comparison = _compare_period(db, current_user.id, start, end, report["total_amount"], "last_week")
    report["vs_last_week"] = {"amount": comparison["amount"], "percentage_change": comparison["percentage_change"]}
    _store_report(db, current_user, "weekly", start, end, report)
    return report


@router.get("/monthly")
def monthly_report(
    month: str | None = Query(default=None, description="YYYY-MM"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    start, end = _resolve_month(month)
    receipts = _fetch_receipts(db, current_user.id, start, end)
    report = _aggregate(receipts, start, end, bucket="week", include_empty_days=False)
    report["by_week"] = report.pop("by_day")
    comparison = _compare_period(db, current_user.id, start, end, report["total_amount"], "last_month")
    report["vs_last_month"] = {"amount": comparison["amount"], "percentage_change": comparison["percentage_change"]}
    return report


@router.get("/custom")
def custom_report(
    date_from: date = Query(...),
    date_to: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="date_to must be after date_from.")
    receipts = _fetch_receipts(db, current_user.id, date_from, date_to)
    report = _aggregate(receipts, date_from, date_to, bucket="day")
    return report


@router.get("/summary")
def summary(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    year_start = today.replace(month=1, day=1)
    this_week = _fetch_receipts(db, current_user.id, week_start, today)
    this_month = _fetch_receipts(db, current_user.id, month_start, today)
    this_year = _fetch_receipts(db, current_user.id, year_start, today)

    month_total = sum(_amount(item.total_amount) for item in this_month)
    category_totals: dict[str, float] = defaultdict(float)
    for receipt in this_month:
        category_totals[receipt.category or "Other"] += _amount(receipt.total_amount)
    top_category = max(category_totals.items(), key=lambda item: item[1])[0] if category_totals else "Other"

    last_30_start = today - timedelta(days=29)
    last_30_receipts = _fetch_receipts(db, current_user.id, last_30_start, today)
    last_30_map: dict[str, float] = defaultdict(float)
    for receipt in last_30_receipts:
        key = (receipt.transaction_date or today).isoformat()
        last_30_map[key] += _amount(receipt.total_amount)
    last_30_days = []
    cursor = last_30_start
    while cursor <= today:
        key = cursor.isoformat()
        last_30_days.append({"date": key, "amount": round(last_30_map.get(key, 0), 2)})
        cursor += timedelta(days=1)

    return {
        "this_week_total": round(sum(_amount(item.total_amount) for item in this_week), 2),
        "this_month_total": round(month_total, 2),
        "this_year_total": round(sum(_amount(item.total_amount) for item in this_year), 2),
        "receipt_count_this_month": len(this_month),
        "top_category_this_month": top_category,
        "daily_average_this_month": round(month_total / max(today.day, 1), 2),
        "last_30_days": last_30_days,
    }


@router.post("/export/pdf")
def export_pdf(
    payload: PDFExportPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.period_end < payload.period_start:
        raise HTTPException(status_code=400, detail="period_end must be after period_start.")
    receipts = _fetch_receipts(db, current_user.id, payload.period_start, payload.period_end)
    report = _aggregate(receipts, payload.period_start, payload.period_end)
    period_label = f"{payload.period_start:%b %d, %Y} - {payload.period_end:%b %d, %Y}"
    pdf_bytes = generate_report_pdf(
        report_data=report,
        user_name=current_user.display_name or current_user.email,
        period_label=period_label,
    )
    filename = f"expense-report-{payload.period_start}-{payload.period_end}.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/export/csv")
def export_csv(
    payload: CSVExportPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.date_to < payload.date_from:
        raise HTTPException(status_code=400, detail="date_to must be after date_from.")
    receipts = _fetch_receipts(db, current_user.id, payload.date_from, payload.date_to)
    csv_bytes = generate_receipts_csv([receipt.as_dict() for receipt in receipts])
    filename = f"expense-report-{payload.date_from}-{payload.date_to}.csv"
    return StreamingResponse(
        BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
