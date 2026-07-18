from datetime import datetime
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
    as_of: datetime
    market_state: Literal["open", "closed", "pre", "post"]
