import os
from pathlib import Path
from typing import Generator

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///expenses.db")

if DATABASE_URL.startswith("sqlite:///") and not DATABASE_URL.startswith("sqlite:////"):
    sqlite_name = DATABASE_URL.replace("sqlite:///", "", 1)
    database_path = BASE_DIR / sqlite_name
    DATABASE_URL = f"sqlite:///{database_path}"

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)

Base = declarative_base()


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_upload_dir() -> Path:
    upload_setting = os.getenv("UPLOAD_DIR", "./uploads")
    upload_path = Path(upload_setting)
    if not upload_path.is_absolute():
        upload_path = BASE_DIR / upload_path
    return upload_path


def ensure_upload_dir() -> Path:
    upload_path = get_upload_dir()
    upload_path.mkdir(parents=True, exist_ok=True)
    return upload_path
