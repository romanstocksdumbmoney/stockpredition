"""JSON-backed storage for receipt records."""

from __future__ import annotations

import json
from pathlib import Path
from threading import RLock

from expense_reporting.models import ReceiptRecord
from expense_reporting.settings import SETTINGS


class ReceiptRepository:
    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or SETTINGS.db_path
        self._lock = RLock()
        self._ensure_db_file()

    def _ensure_db_file(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.db_path.exists():
            self.db_path.write_text("[]", encoding="utf-8")

    def list_receipts(self) -> list[ReceiptRecord]:
        with self._lock:
            raw = json.loads(self.db_path.read_text(encoding="utf-8"))
            return [ReceiptRecord.model_validate(item) for item in raw]

    def save_all(self, receipts: list[ReceiptRecord]) -> None:
        with self._lock:
            payload = [item.model_dump(mode="json") for item in receipts]
            self.db_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def create(self, receipt: ReceiptRecord) -> ReceiptRecord:
        with self._lock:
            receipts = self.list_receipts()
            receipts.append(receipt)
            self.save_all(receipts)
        return receipt

    def get(self, receipt_id: str) -> ReceiptRecord | None:
        for receipt in self.list_receipts():
            if receipt.receipt_id == receipt_id:
                return receipt
        return None

    def upsert(self, receipt: ReceiptRecord) -> ReceiptRecord:
        with self._lock:
            receipts = self.list_receipts()
            replaced = False
            for idx, existing in enumerate(receipts):
                if existing.receipt_id == receipt.receipt_id:
                    receipts[idx] = receipt
                    replaced = True
                    break
            if not replaced:
                receipts.append(receipt)
            self.save_all(receipts)
        return receipt

