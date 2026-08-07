import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from database import Base, engine, ensure_upload_dir
from models import Category, DEFAULT_CATEGORIES
from routes.auth import router as auth_router
from routes.categories import router as categories_router
from routes.receipts import router as receipts_router
from routes.reports import router as reports_router

load_dotenv()

app = FastAPI(title="Expense Tracker API", version="1.0.0")

app_url = os.getenv("APP_URL", "http://localhost:3000")
allowed_origins = [app_url, "http://localhost:3000", "http://127.0.0.1:3000"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys(allowed_origins)),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(receipts_router)
app.include_router(reports_router)
app.include_router(categories_router)


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_upload_dir()

    from database import SessionLocal

    db = SessionLocal()
    try:
        for entry in DEFAULT_CATEGORIES:
            existing = db.scalar(select(Category).where(Category.name == entry["name"], Category.is_default.is_(True)))
            if not existing:
                db.add(
                    Category(
                        user_id=None,
                        name=entry["name"],
                        icon=entry["icon"],
                        color=entry["color"],
                        is_default=True,
                    )
                )
        db.commit()
    finally:
        db.close()

    print("=" * 50)
    print("  Expense Tracker is ready!")
    print("=" * 50)
    print()
    print("  👉 Open your browser and go to:")
    print("  http://localhost:3000")
    print()
    print("  Create your account to get started.")
    print("  Upload your first receipt to test the AI.")
    print()
    print("  Backend API: http://localhost:8000")
    print("  API docs:    http://localhost:8000/docs")
    print("=" * 50)


@app.get("/api/health")
def health() -> dict:
    return {"success": True, "status": "ok"}
