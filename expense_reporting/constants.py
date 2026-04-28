"""Application constants and default taxonomy values."""

from __future__ import annotations

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf"}

STATUS_UPLOADED = "Uploaded"
STATUS_OCR_PROCESSED = "OCR processed"
STATUS_NEEDS_REVIEW = "Needs review"
STATUS_APPROVED = "Approved"
STATUS_REJECTED = "Rejected"
STATUS_INCLUDED_IN_REPORT = "Included in report"

RECEIPT_STATUSES = {
    STATUS_UPLOADED,
    STATUS_OCR_PROCESSED,
    STATUS_NEEDS_REVIEW,
    STATUS_APPROVED,
    STATUS_REJECTED,
    STATUS_INCLUDED_IN_REPORT,
}

CONFIDENCE_HIGH = "High confidence"
CONFIDENCE_MEDIUM = "Medium confidence"
CONFIDENCE_LOW = "Low confidence"
CONFIDENCE_NEEDS_REVIEW = "Needs manual review"

CONFIDENCE_LEVELS = {
    CONFIDENCE_HIGH,
    CONFIDENCE_MEDIUM,
    CONFIDENCE_LOW,
    CONFIDENCE_NEEDS_REVIEW,
}

DEFAULT_DEPARTMENTS = [
    "Sales",
    "Operations",
    "Marketing",
    "Admin",
    "Travel",
    "Warehouse",
]

DEFAULT_LOCATIONS = [
    "Store 1",
    "Store 2",
    "Raleigh",
    "Charlotte",
    "Online",
]

DEFAULT_CATEGORIES = [
    "Meals",
    "Travel",
    "Office supplies",
    "Fuel",
    "Equipment",
    "Software",
    "Client expense",
    "Miscellaneous",
]
