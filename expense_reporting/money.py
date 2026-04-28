"""Decimal-safe money handling utilities using cents internally."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


class MoneyParseError(ValueError):
    """Raised when incoming money values cannot be parsed safely."""


def cents_from_string(value: str) -> int:
    """Parse a user/OCR money string into integer cents."""
    cleaned = (
        value.strip()
        .replace("$", "")
        .replace(",", "")
    )
    if not cleaned:
        raise MoneyParseError("Money value is required.")
    try:
        decimal_value = Decimal(cleaned).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except InvalidOperation as exc:
        raise MoneyParseError(f"Invalid money format: {value}") from exc
    return int(decimal_value * 100)


def cents_from_optional_string(value: str | None) -> int | None:
    if value is None or not value.strip():
        return None
    return cents_from_string(value)


def format_cents(cents: int | None) -> str | None:
    if cents is None:
        return None
    return f"${Decimal(cents) / Decimal(100):.2f}"


def sum_components(subtotal_cents: int | None, tax_cents: int | None, tip_cents: int | None) -> int | None:
    if subtotal_cents is None:
        return None
    return subtotal_cents + (tax_cents or 0) + (tip_cents or 0)
