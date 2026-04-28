from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from expense_reporting.app import app
from expense_reporting.service import ExpenseService
from expense_reporting.settings import AppSettings
from expense_reporting.storage import ReceiptRepository
from expense_reporting.templates import ensure_templates


@pytest.fixture()
def service(tmp_path: Path) -> ExpenseService:
    settings = AppSettings(
        data_dir=tmp_path / "data",
        uploads_dir=tmp_path / "data" / "uploads",
        db_path=tmp_path / "data" / "receipts.json",
        reports_dir=tmp_path / "data" / "reports",
        templates_dir=tmp_path / "templates",
    )
    repository = ReceiptRepository(db_path=settings.db_path)
    ensure_templates(settings)
    return ExpenseService(repository=repository, settings=settings)


@pytest.fixture()
def client(service: ExpenseService) -> TestClient:
    import expense_reporting.app as app_module

    original_service = app_module.service
    original_templates_dir = app_module.templates.directory
    app_module.service = service
    app_module.templates.directory = str(service.settings.templates_dir)
    try:
        yield TestClient(app)
    finally:
        app_module.service = original_service
        app_module.templates.directory = original_templates_dir
