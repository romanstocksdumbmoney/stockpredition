"""Domain errors raised by expense reporting services."""

from __future__ import annotations


class ExpenseReportingError(Exception):
    """Base class for domain-level errors."""


class ValidationError(ExpenseReportingError):
    """Raised when incoming data fails business-rule validation."""


class NotFoundError(ExpenseReportingError):
    """Raised when a requested receipt/report is not found."""


class ReportVerificationError(ExpenseReportingError):
    """Raised when report totals do not reconcile exactly."""

