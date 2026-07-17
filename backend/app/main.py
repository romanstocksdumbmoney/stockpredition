from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.config import settings
from app.data.indicators import compute_indicators
from app.data.patterns import detect_patterns
from app.data.unusual_whales_client import UnusualWhalesClient
from app.data.yahoo_client import YahooClient
from app.database import Base, engine, get_db
from app.models import Analysis
from app.reasoning.analyzer import TradeAnalyzer
from app.schemas import AnalysisResult, AnalyzeRequest, HistoryItem, OutcomeRequest

DISCLAIMER = (
    "TradeBot weighs signals but doesn't predict the future. "
    "This is not financial advice, and confidence scores are not guarantees."
)

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

yahoo_client = YahooClient()
uw_client = UnusualWhalesClient(api_key=settings.uw_api_key, base_url=settings.uw_base_url)
trade_analyzer = TradeAnalyzer(api_key=settings.anthropic_api_key, model=settings.anthropic_model)
logger = logging.getLogger(__name__)


def _ensure_analysis_schema() -> None:
    if not settings.database_url.startswith("sqlite"):
        return

    with engine.begin() as connection:
        columns = [row[1] for row in connection.exec_driver_sql("PRAGMA table_info(analyses)").fetchall()]
        if "reasoning_source" not in columns:
            connection.exec_driver_sql("ALTER TABLE analyses ADD COLUMN reasoning_source VARCHAR(16)")
        connection.exec_driver_sql(
            "UPDATE analyses SET reasoning_source = 'fallback' WHERE reasoning_source IS NULL OR reasoning_source = ''"
        )


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    try:
        _ensure_analysis_schema()
    except Exception as exc:  # pragma: no cover - defensive startup logging
        logger.exception("Failed to ensure analysis schema migration: %s", exc)


def _extract_ticker(text: str) -> str | None:
    text = text.strip().upper()
    cash_match = re.search(r"\$([A-Z]{1,6})\b", text)
    if cash_match:
        return cash_match.group(1)

    for symbol_match in re.finditer(r"\b([A-Z]{1,6})\b", text):
        candidate = symbol_match.group(1)
        if candidate not in {"LOOK", "THIS", "TRADEBOT", "AT", "HEY"}:
            return candidate
    return None


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _build_signal_payload(symbol: str, period: str = "6mo", interval: str = "1d") -> dict[str, Any]:
    history = yahoo_client.fetch_price_history(symbol=symbol, period=period, interval=interval)
    ohlcv = yahoo_client.to_ohlcv_records(history)
    key_stats = yahoo_client.fetch_key_stats(symbol)
    indicators = compute_indicators(history)
    patterns = detect_patterns(history)
    flow_data = uw_client.fetch_symbol_flow(symbol)

    close = history["Close"]
    last_price = _to_float(close.iloc[-1])
    prev_price = _to_float(close.iloc[-2]) if len(close) > 1 else last_price
    day_change_pct = None
    if last_price is not None and prev_price not in (None, 0):
        day_change_pct = round(((last_price - prev_price) / prev_price) * 100, 2)

    return {
        "ohlcv": ohlcv,
        "key_stats": key_stats,
        "indicators": indicators,
        "patterns": patterns,
        "flow_data": flow_data,
        "market_context": {
            "last_price": last_price,
            "previous_close": prev_price,
            "day_change_pct": day_change_pct,
            "as_of": ohlcv[-1]["timestamp"] if ohlcv else None,
        },
    }


def _normalize_reasoning_source(value: Any) -> str:
    source = str(value or "fallback").lower().strip()
    if source not in {"claude", "fallback"}:
        return "fallback"
    return source


def _history_item_from_row(row: Analysis) -> HistoryItem:
    result_payload = dict(row.result_json or {})
    source = _normalize_reasoning_source(result_payload.get("reasoning_source") or row.reasoning_source)
    result_payload["reasoning_source"] = source
    return HistoryItem(
        id=row.id,
        ticker=row.ticker,
        query_text=row.query_text,
        created_at=row.created_at,
        outcome=row.outcome,
        result=result_payload,
    )


@app.post("/api/analyze", response_model=AnalysisResult)
def analyze(request: AnalyzeRequest, db: Session = Depends(get_db)):
    raw_input = request.ticker or request.query
    if not raw_input:
        raise HTTPException(status_code=400, detail="Provide either 'ticker' or 'query'.")

    ticker = (request.ticker or _extract_ticker(request.query or "") or "").upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="Unable to determine ticker symbol from input.")

    try:
        payload = _build_signal_payload(ticker)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Data pipeline error: {exc}") from exc

    analysis = trade_analyzer.analyze(ticker=ticker, signal_payload=payload)
    reasoning_source = _normalize_reasoning_source(analysis.get("reasoning_source"))
    analysis["reasoning_source"] = reasoning_source
    full_result: dict[str, Any] = {
        **analysis,
        "disclaimer": DISCLAIMER,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "chart": {
            "ohlcv": payload["ohlcv"],
            "support_levels": payload["patterns"].get("support_levels", []),
            "resistance_levels": payload["patterns"].get("resistance_levels", []),
        },
        "indicators": payload["indicators"],
        "patterns": payload["patterns"],
        "flow_data": payload["flow_data"],
        "market_context": {
            **payload["market_context"],
            "fundamentals": payload["key_stats"],
        },
    }

    row = Analysis(
        ticker=ticker,
        query_text=request.query,
        result_json=full_result,
        reasoning_source=reasoning_source,
        outcome=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    full_result["analysis_id"] = row.id
    return full_result


@app.get("/api/history", response_model=list[HistoryItem])
def history(db: Session = Depends(get_db)):
    rows = db.query(Analysis).order_by(Analysis.created_at.desc()).limit(200).all()
    return [_history_item_from_row(row) for row in rows]


@app.post("/api/history/{analysis_id}/outcome", response_model=HistoryItem)
def mark_outcome(analysis_id: int, request: OutcomeRequest, db: Session = Depends(get_db)):
    row = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Analysis record not found.")

    row.outcome = request.outcome
    row.outcome_updated_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()
    db.refresh(row)

    return _history_item_from_row(row)


@app.get("/api/ticker/{symbol}/chart")
def ticker_chart(
    symbol: str,
    period: str = Query("6mo", description="yfinance period like 1mo, 3mo, 6mo, 1y"),
    interval: str = Query("1d", description="yfinance interval like 1d, 1h"),
):
    try:
        history = yahoo_client.fetch_price_history(symbol=symbol.upper(), period=period, interval=interval)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Unable to fetch chart data: {exc}") from exc

    return {
        "ticker": symbol.upper(),
        "period": period,
        "interval": interval,
        "ohlcv": yahoo_client.to_ohlcv_records(history),
    }
