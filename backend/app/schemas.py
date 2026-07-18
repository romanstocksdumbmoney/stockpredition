from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    ticker: str | None = Field(default=None, description="Ticker symbol like AAPL")
    query: str | None = Field(default=None, description="Free text, e.g., 'look at $AAPL'")


class OutcomeRequest(BaseModel):
    outcome: Literal["right", "wrong", "mixed"]


class AnalysisResult(BaseModel):
    ticker: str
    bull_case: list[str]
    bear_case: list[str]
    scenarios: dict[str, str]
    context_factors: list[str]
    earnings_warning: bool
    key_flow_signal: str | None
    pattern_summary: str
    confidence_pct: int
    confidence_direction: Literal["bullish", "bearish", "neutral"]
    summary: str
    risk_flags: list[str]
    reasoning_source: Literal["claude", "fallback"]
    disclaimer: str
    generated_at: datetime
    chart: dict[str, Any]
    indicators: dict[str, Any]
    patterns: dict[str, Any]
    flow_data: dict[str, Any]
    context_pack: dict[str, Any]
    market_context: dict[str, Any]
    analysis_id: int | None = None


class HistoryItem(BaseModel):
    id: int
    ticker: str
    query_text: str | None
    created_at: datetime
    outcome: str | None
    result: dict[str, Any]


class TickerQuote(BaseModel):
    price: float
    change_pct: float | None
    volume: int | None
    as_of: datetime | None
    market_state: Literal["open", "closed", "pre", "post"]


class MarketMoverItem(BaseModel):
    symbol: str
    name: str
    price: float
    change_pct: float
    volume: int
    market_cap: int


class MarketHeadline(BaseModel):
    title: str
    publisher: str | None = None
    published_at: datetime | None = None
    url: str | None = None


class MarketMoversResponse(BaseModel):
    gainers: list[MarketMoverItem]
    losers: list[MarketMoverItem]
    most_active: list[MarketMoverItem]
    as_of: datetime | None
    session_label: Literal["LIVE", "LAST SESSION"]
    market_news: list[MarketHeadline]


class WatchlistRequest(BaseModel):
    symbol: str


class WatchlistItem(BaseModel):
    symbol: str
    added_at: datetime


class BriefingItem(BaseModel):
    symbol: str
    note: str
    severity: Literal["action", "watch", "quiet"]
    analysis_id: int | None = None
    scan_failed: bool = False


class BriefingPayload(BaseModel):
    headline: str
    market_note: str
    items: list[BriefingItem]
    quiet_tickers: list[str]


class BriefingRecord(BaseModel):
    date: date
    created_at: datetime
    briefing: BriefingPayload
