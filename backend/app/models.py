from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Analysis(Base):
    __tablename__ = "analyses"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    ticker: Mapped[str] = mapped_column(String(16), index=True)
    query_text: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    result_json: Mapped[dict] = mapped_column(JSON)
    reasoning_source: Mapped[str] = mapped_column(String(16), default="fallback", server_default="fallback", index=True)
    outcome: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    outcome_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
