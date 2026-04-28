# Expense Reporting Tool

Accuracy-first expense reporting application for receipt ingestion, OCR extraction,
manual verification, and mathematically audited monthly reports.

## Features

- Upload receipt images/PDFs (JPG, PNG, PDF)
- OCR extraction with field-level confidence labels
- Strict manual review workflow for uncertain fields
- Decimal-safe money handling (stored in cents)
- Duplicate detection warnings (hash + business fields)
- Receipt lifecycle statuses:
  - Uploaded
  - OCR processed
  - Needs review
  - Approved
  - Rejected
  - Included in report
- Monthly report generation using only approved receipts
- Pre-export audit checks and reconciliation
- Export options:
  - CSV
  - PDF
  - Excel (XLSX)

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[test,ocr]"
uvicorn main:app --reload
```

Open: `http://127.0.0.1:8000`

## Main pages

- `/` Dashboard
- `/upload` Upload Receipt
- `/review-queue` Receipt Review Queue
- `/approved` Approved Receipts
- `/reports` Monthly Reports
- `/settings` Settings

## API highlights

- `POST /api/receipts/upload`
- `POST /api/receipts/{receipt_id}/ocr`
- `POST /api/receipts/{receipt_id}/review`
- `POST /api/reports/{report_month}` (YYYY-MM)
- `GET /api/reports/{report_month}/export/csv`
- `GET /api/reports/{report_month}/export/pdf`
- `GET /api/reports/{report_month}/export/xlsx`

## Testing

```bash
pytest
```

The suite validates cents-based money math, total reconciliation rules, low-confidence
review handling, duplicate detection, verified report totals, and export consistency.
