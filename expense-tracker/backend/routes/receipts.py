import json
import os
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import and_, asc, desc, func, or_, select
from sqlalchemy.orm import Session

from database import SessionLocal, ensure_upload_dir, get_db
from models import Receipt, User
from routes.auth import get_current_user
from services.scanner import scan_receipt

router = APIRouter(prefix="/api/receipts", tags=["receipts"])

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".webp", ".pdf"}
MAX_FILE_SIZE = 20 * 1024 * 1024


class ReceiptUpdatePayload(BaseModel):
    merchant_name: str | None = None
    merchant_address: str | None = None
    transaction_date: date | None = None
    transaction_time: str | None = None
    total_amount: float | None = None
    subtotal: float | None = None
    tax_amount: float | None = None
    tip_amount: float | None = None
    payment_method: str | None = None
    category: str | None = None
    description: str | None = None
    currency: str | None = None
    line_items: list[dict[str, Any]] | None = None


def _to_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date()
    except ValueError:
        return None


def _parse_time(value: Any) -> time | None:
    if not value:
        return None
    if isinstance(value, time):
        return value
    try:
        return datetime.strptime(str(value), "%H:%M").time()
    except ValueError:
        return None


def _process_receipt_scan(receipt_id: str) -> None:
    db = SessionLocal()
    try:
        receipt = db.get(Receipt, receipt_id)
        if not receipt:
            return

        receipt.scan_status = "processing"
        db.commit()

        result = scan_receipt(receipt.image_path)
        if not result.get("success"):
            receipt.scan_status = "failed"
            receipt.scanned_at = datetime.utcnow()
            receipt.raw_scan_text = result.get("error")
            db.commit()
            return

        data = result["data"]
        receipt.scan_status = "complete"
        receipt.scanned_at = datetime.utcnow()
        receipt.merchant_name = data.get("merchant_name")
        receipt.merchant_address = data.get("merchant_address")
        receipt.transaction_date = _parse_date(data.get("transaction_date"))
        receipt.transaction_time = _parse_time(data.get("transaction_time"))
        receipt.subtotal = _to_decimal(data.get("subtotal"))
        receipt.tax_amount = _to_decimal(data.get("tax_amount"))
        receipt.tip_amount = _to_decimal(data.get("tip_amount"))
        receipt.total_amount = _to_decimal(data.get("total_amount"))
        receipt.payment_method = data.get("payment_method")
        receipt.category = data.get("suggested_category") or "Other"
        receipt.currency = data.get("currency") or "USD"
        receipt.confidence_score = float(data.get("confidence_score") or 0)
        receipt.raw_scan_text = data.get("raw_text")
        receipt.line_items_json = json.dumps(data.get("line_items") or [])
        db.commit()
    finally:
        db.close()


def _validate_upload(file: UploadFile, content: bytes) -> None:
    extension = Path(file.filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {extension or 'unknown'}.")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File {file.filename} exceeds 20MB size limit.")


def _receipt_query_for_user(user_id: str):
    return select(Receipt).where(Receipt.user_id == user_id)


@router.post("/upload")
async def upload_receipts(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not files:
        raise HTTPException(status_code=400, detail="Please select at least one file.")
    if len(files) > 10:
        raise HTTPException(status_code=400, detail="You can upload up to 10 files at a time.")

    base_upload_dir = ensure_upload_dir()
    user_dir = base_upload_dir / current_user.id
    user_dir.mkdir(parents=True, exist_ok=True)

    items = []
    for file in files:
        content = await file.read()
        _validate_upload(file, content)

        extension = Path(file.filename or "upload.jpg").suffix.lower()
        saved_name = f"{uuid4()}{extension}"
        saved_path = user_dir / saved_name
        saved_path.write_bytes(content)

        receipt = Receipt(
            user_id=current_user.id,
            image_path=str(saved_path),
            image_filename=file.filename or saved_name,
            scan_status="pending",
            category="Other",
        )
        db.add(receipt)
        db.commit()
        db.refresh(receipt)

        background_tasks.add_task(_process_receipt_scan, receipt.id)
        items.append({"id": receipt.id, "scan_status": receipt.scan_status})

    return {"success": True, "receipts": items}


@router.get("")
def list_receipts(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    category: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    sort_by: str = Query(default="date"),
    sort_order: str = Query(default="desc"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    query = _receipt_query_for_user(current_user.id)
    count_query = select(func.count()).select_from(Receipt).where(Receipt.user_id == current_user.id)
    conditions = []
    if category:
        conditions.append(Receipt.category == category)
    if date_from:
        conditions.append(Receipt.transaction_date >= date_from)
    if date_to:
        conditions.append(Receipt.transaction_date <= date_to)
    if search:
        like = f"%{search.strip()}%"
        conditions.append(
            or_(Receipt.merchant_name.ilike(like), Receipt.category.ilike(like), Receipt.description.ilike(like))
        )
    if conditions:
        query = query.where(and_(*conditions))
        count_query = count_query.where(and_(*conditions))

    sort_field = {
        "date": Receipt.transaction_date,
        "uploaded_at": Receipt.uploaded_at,
        "amount": Receipt.total_amount,
        "merchant": Receipt.merchant_name,
    }.get(sort_by, Receipt.uploaded_at)
    sort_expression = desc(sort_field) if sort_order.lower() == "desc" else asc(sort_field)
    query = query.order_by(sort_expression, desc(Receipt.uploaded_at))

    total = db.scalar(count_query) or 0
    receipts = db.scalars(query.offset((page - 1) * limit).limit(limit)).all()

    return {
        "success": True,
        "items": [item.as_dict() for item in receipts],
        "pagination": {"page": page, "limit": limit, "total": total, "pages": (total + limit - 1) // limit},
    }


def _get_owned_receipt(db: Session, user_id: str, receipt_id: str) -> Receipt:
    receipt = db.scalar(select(Receipt).where(Receipt.id == receipt_id, Receipt.user_id == user_id))
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found.")
    return receipt


@router.get("/{receipt_id}")
def get_receipt(receipt_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    receipt = _get_owned_receipt(db, current_user.id, receipt_id)
    return {"success": True, "receipt": receipt.as_dict()}


@router.patch("/{receipt_id}")
def update_receipt(
    receipt_id: str,
    payload: ReceiptUpdatePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    receipt = _get_owned_receipt(db, current_user.id, receipt_id)
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key == "line_items":
            receipt.line_items_json = json.dumps(value or [])
            continue
        if key in {"total_amount", "subtotal", "tax_amount", "tip_amount"}:
            setattr(receipt, key, _to_decimal(value))
            continue
        if key == "transaction_time":
            setattr(receipt, key, _parse_time(value))
            continue
        setattr(receipt, key, value)

    receipt.manually_edited = True
    db.commit()
    db.refresh(receipt)
    return {"success": True, "receipt": receipt.as_dict()}


@router.delete("/{receipt_id}")
def delete_receipt(receipt_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    receipt = _get_owned_receipt(db, current_user.id, receipt_id)
    image_path = Path(receipt.image_path)
    db.delete(receipt)
    db.commit()
    if image_path.exists():
        image_path.unlink(missing_ok=True)
    return {"success": True}


@router.get("/{receipt_id}/status")
def receipt_status(receipt_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    receipt = _get_owned_receipt(db, current_user.id, receipt_id)
    data = receipt.as_dict() if receipt.scan_status == "complete" else None
    return {"id": receipt.id, "scan_status": receipt.scan_status, "data": data}


@router.post("/{receipt_id}/rescan")
def rescan_receipt(
    receipt_id: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    receipt = _get_owned_receipt(db, current_user.id, receipt_id)
    receipt.scan_status = "pending"
    receipt.scanned_at = None
    db.commit()
    background_tasks.add_task(_process_receipt_scan, receipt.id)
    return {"success": True}


@router.get("/{receipt_id}/image")
def receipt_image(receipt_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    receipt = _get_owned_receipt(db, current_user.id, receipt_id)
    if not os.path.exists(receipt.image_path):
        raise HTTPException(status_code=404, detail="Image file not found.")
    return FileResponse(receipt.image_path, filename=receipt.image_filename)


@router.delete("")
def delete_all_receipts(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    receipts = db.scalars(select(Receipt).where(Receipt.user_id == current_user.id)).all()
    for receipt in receipts:
        image_path = Path(receipt.image_path)
        if image_path.exists():
            image_path.unlink(missing_ok=True)
        db.delete(receipt)
    db.commit()
    return {"success": True}
