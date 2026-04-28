"""Runtime configuration and filesystem setup."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AppSettings:
    data_dir: Path = Path("data")
    uploads_dir: Path = Path("data/uploads")
    db_path: Path = Path("data/receipts.json")
    reports_dir: Path = Path("data/reports")
    templates_dir: Path = Path("templates")

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.reports_dir.mkdir(parents=True, exist_ok=True)
        self.templates_dir.mkdir(parents=True, exist_ok=True)


SETTINGS = AppSettings()
