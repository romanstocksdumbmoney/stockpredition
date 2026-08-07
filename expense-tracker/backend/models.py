import json
import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, Numeric, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

DEFAULT_CATEGORIES = [
    {"name": "Food and Dining", "icon": "🍽️", "color": "#f59e0b"},
    {"name": "Travel", "icon": "✈️", "color": "#06b6d4"},
    {"name": "Lodging", "icon": "🏨", "color": "#8b5cf6"},
    {"name": "Transportation", "icon": "🚗", "color": "#3b82f6"},
    {"name": "Software and Tools", "icon": "💻", "color": "#6366f1"},
    {"name": "Office Supplies", "icon": "📎", "color": "#84cc16"},
    {"name": "Marketing", "icon": "📣", "color": "#ec4899"},
    {"name": "Utilities", "icon": "💡", "color": "#eab308"},
    {"name": "Entertainment", "icon": "🎬", "color": "#ef4444"},
    {"name": "Healthcare", "icon": "🩺", "color": "#10b981"},
    {"name": "Equipment", "icon": "🧰", "color": "#0ea5e9"},
    {"name": "Other", "icon": "📦", "color": "#64748b"},
]


def uuid_str() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    session_token: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    session_expires: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    receipts: Mapped[list["Receipt"]] = relationship(
        "Receipt", back_populates="user", cascade="all, delete-orphan"
    )
    reports: Mapped[list["ExpenseReport"]] = relationship(
        "ExpenseReport", back_populates="user", cascade="all, delete-orphan"
    )
    categories: Mapped[list["Category"]] = relationship(
        "Category", back_populates="user", cascade="all, delete-orphan"
    )

    def as_dict(self) -> dict[str, Any]:
        return {"id": self.id, "email": self.email, "display_name": self.display_name}


class Receipt(Base):
    __tablename__ = "receipts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    image_path: Mapped[str] = mapped_column(Text, nullable=False)
    image_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    scanned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    scan_status: Mapped[str] = mapped_column(String(24), default="pending", nullable=False, index=True)

    merchant_name: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    merchant_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    transaction_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    transaction_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    total_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    subtotal: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    tax_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    tip_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(80), nullable=True)
    category: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    currency: Mapped[str] = mapped_column(String(8), default="USD", nullable=False)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_scan_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    manually_edited: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    line_items_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="receipts")

    def as_dict(self) -> dict[str, Any]:
        line_items = []
        if self.line_items_json:
            try:
                line_items = json.loads(self.line_items_json)
            except json.JSONDecodeError:
                line_items = []
        return {
            "id": self.id,
            "user_id": self.user_id,
            "image_path": self.image_path,
            "image_filename": self.image_filename,
            "uploaded_at": self.uploaded_at.isoformat() if self.uploaded_at else None,
            "scanned_at": self.scanned_at.isoformat() if self.scanned_at else None,
            "scan_status": self.scan_status,
            "merchant_name": self.merchant_name,
            "merchant_address": self.merchant_address,
            "transaction_date": self.transaction_date.isoformat() if self.transaction_date else None,
            "transaction_time": self.transaction_time.isoformat(timespec="minutes") if self.transaction_time else None,
            "total_amount": float(self.total_amount) if self.total_amount is not None else None,
            "subtotal": float(self.subtotal) if self.subtotal is not None else None,
            "tax_amount": float(self.tax_amount) if self.tax_amount is not None else None,
            "tip_amount": float(self.tip_amount) if self.tip_amount is not None else None,
            "payment_method": self.payment_method,
            "category": self.category or "Other",
            "description": self.description,
            "currency": self.currency,
            "confidence_score": self.confidence_score,
            "raw_scan_text": self.raw_scan_text,
            "manually_edited": self.manually_edited,
            "line_items": line_items,
        }


class ExpenseReport(Base):
    __tablename__ = "expense_reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    report_type: Mapped[str] = mapped_column(String(32), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    receipt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    report_data_json: Mapped[str] = mapped_column(Text, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="reports")


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    icon: Mapped[str] = mapped_column(String(12), nullable=False, default="📦")
    color: Mapped[str] = mapped_column(String(16), nullable=False, default="#64748b")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="categories")

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "name": self.name,
            "icon": self.icon,
            "color": self.color,
            "is_default": self.is_default,
        }
