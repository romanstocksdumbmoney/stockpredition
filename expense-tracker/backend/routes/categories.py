from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from database import get_db
from models import Category, Receipt, User
from routes.auth import get_current_user

router = APIRouter(prefix="/api/categories", tags=["categories"])


class CreateCategoryPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    icon: str = Field(default="📦", max_length=12)
    color: str = Field(default="#64748b", max_length=16)


class UpdateCategoryPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    icon: str = Field(default="📦", max_length=12)
    color: str = Field(default="#64748b", max_length=16)


@router.get("")
def list_categories(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    defaults = db.scalars(select(Category).where(Category.is_default.is_(True)).order_by(Category.name)).all()
    custom = db.scalars(
        select(Category).where(Category.user_id == current_user.id, Category.is_default.is_(False)).order_by(Category.name)
    ).all()
    all_categories = [category.as_dict() for category in [*defaults, *custom]]
    return {"success": True, "categories": all_categories}


@router.post("")
def create_category(
    payload: CreateCategoryPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    existing = db.scalar(
        select(Category).where(
            Category.name == payload.name.strip(),
            or_(Category.user_id == current_user.id, Category.is_default.is_(True)),
        )
    )
    if existing:
        raise HTTPException(status_code=400, detail="Category already exists.")

    category = Category(
        user_id=current_user.id,
        name=payload.name.strip(),
        icon=payload.icon.strip() or "📦",
        color=payload.color.strip() or "#64748b",
        is_default=False,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return {"success": True, "category": category.as_dict()}


@router.patch("/{category_id}")
def update_category(
    category_id: str,
    payload: UpdateCategoryPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    category = db.scalar(
        select(Category).where(Category.id == category_id, Category.user_id == current_user.id, Category.is_default.is_(False))
    )
    if not category:
        raise HTTPException(status_code=404, detail="Custom category not found.")

    old_name = category.name
    category.name = payload.name.strip()
    category.icon = payload.icon.strip() or "📦"
    category.color = payload.color.strip() or "#64748b"

    receipts = db.scalars(select(Receipt).where(Receipt.user_id == current_user.id, Receipt.category == old_name)).all()
    for receipt in receipts:
        receipt.category = category.name

    db.commit()
    db.refresh(category)
    return {"success": True, "category": category.as_dict()}


@router.delete("/{category_id}")
def delete_category(category_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    category = db.scalar(
        select(Category).where(Category.id == category_id, Category.user_id == current_user.id, Category.is_default.is_(False))
    )
    if not category:
        raise HTTPException(status_code=404, detail="Only custom categories can be deleted.")

    receipts = db.scalars(select(Receipt).where(Receipt.user_id == current_user.id, Receipt.category == category.name)).all()
    for receipt in receipts:
        receipt.category = "Other"
    db.delete(category)
    db.commit()
    return {"success": True}
