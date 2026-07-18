from __future__ import annotations

import logging
import re
import time as time_module
from datetime import date, datetime, timezone
from threading import Lock
from typing import Any

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.briefing import (
    SCAN_DELAY_SECONDS,
    WATCHLIST_LIMIT,
    briefing_date_for_now,
    detect_ticker_changes,
    generate_briefing_payload,
    is_after_scan_time_et,
    normalize_symbol,
)
from app.config import settings
from app.data.context_pack import get_catalysts, get_fundamentals, get_market_regime
from app.data.indicators import compute_indicators
from app.data.patterns import detect_patterns
from app.data.unusual_whales_client import UnusualWhalesClient
from app.data.yahoo_client import YahooClient
from app.database import Base, SessionLocal, engine, get_db
from app.models import Analysis, Briefing, Watchlist
from app.reasoning.analyzer import TradeAnalyzer
from app.schemas import (
    AnalysisResult,
    AnalyzeRequest,
    BriefingRecord,
    BriefingPayload,
    HistoryItem,
    OutcomeRequest,
    TickerQuote,
    WatchlistItem,
    WatchlistRequest,
)

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
scan_lock = Lock()
scan_scheduler: BackgroundScheduler | None = None


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


def _seed_watchlist_from_history(db: Session) -> None:
    if db.query(Watchlist).count() > 0:
        return

    seen: set[str] = set()
    symbols: list[str] = []
    rows = db.query(Analysis.ticker).order_by(Analysis.created_at.desc()).all()
    for (ticker,) in rows:
        symbol = str(ticker or "").upper().strip()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        symbols.append(symbol)
        if len(symbols) >= WATCHLIST_LIMIT:
            break

    if not symbols:
        return

    for symbol in symbols:
        db.add(Watchlist(symbol=symbol))
    db.commit()


def _run_and_store_analysis(ticker: str, query_text: str | None, db: Session) -> dict[str, Any]:
    payload = _build_signal_payload(ticker)
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
        "context_pack": payload["context_pack"],
        "market_context": {
            **payload["market_context"],
            "fundamentals": payload["key_stats"],
        },
    }

    row = Analysis(
        ticker=ticker,
        query_text=query_text,
        result_json=full_result,
        reasoning_source=reasoning_source,
        outcome=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    full_result["analysis_id"] = row.id
    return full_result


def _build_briefing_record(row: Briefing) -> BriefingRecord:
    payload = dict(row.briefing_json or {})
    payload.setdefault("headline", "Pre-market briefing ready.")
    payload.setdefault("market_note", "Market regime unavailable.")
    payload.setdefault("items", [])
    payload.setdefault("quiet_tickers", [])
    return BriefingRecord(
        date=row.briefing_date,
        created_at=row.created_at,
        briefing=BriefingPayload(**payload),
    )


def _run_morning_scan(db: Session, run_date: date | None = None) -> Briefing:
    if not scan_lock.acquire(blocking=False):
        raise RuntimeError("A watchlist scan is already in progress.")

    try:
        effective_date = run_date or briefing_date_for_now()
        watch_rows = db.query(Watchlist).order_by(Watchlist.added_at.asc()).all()
        notable_items: list[dict[str, Any]] = []
        quiet_tickers: list[str] = []
        regime_snapshot: dict[str, Any] | None = None

        for idx, watched in enumerate(watch_rows):
            symbol = watched.symbol.upper()
            previous_row = (
                db.query(Analysis).filter(Analysis.ticker == symbol).order_by(Analysis.created_at.desc()).first()
            )
            previous_result = dict(previous_row.result_json or {}) if previous_row else None

            try:
                fresh_result = _run_and_store_analysis(
                    ticker=symbol,
                    query_text=f"Morning scan {effective_date.isoformat()}",
                    db=db,
                )
                if regime_snapshot is None:
                    regime_snapshot = (fresh_result.get("context_pack") or {}).get("market_regime")

                change_meta = detect_ticker_changes(previous_result, fresh_result)
                item_payload = {
                    "symbol": symbol,
                    "changes": change_meta["changes"],
                    "severity": change_meta["severity"],
                    "analysis": fresh_result,
                    "analysis_id": fresh_result.get("analysis_id"),
                    "scan_failed": False,
                }
                if change_meta["severity"] == "quiet":
                    quiet_tickers.append(symbol)
                else:
                    notable_items.append(item_payload)
            except Exception as exc:
                logger.exception("Morning scan failed for %s: %s", symbol, exc)
                notable_items.append(
                    {
                        "symbol": symbol,
                        "changes": [f"Scan failed: {exc.__class__.__name__}: {exc}"],
                        "severity": "action",
                        "analysis": {},
                        "analysis_id": None,
                        "scan_failed": True,
                    }
                )

            if idx < len(watch_rows) - 1:
                time_module.sleep(SCAN_DELAY_SECONDS)

        briefing_payload = generate_briefing_payload(
            api_key=settings.anthropic_api_key,
            model=settings.anthropic_model,
            run_date=effective_date,
            notable_items=notable_items,
            quiet_tickers=quiet_tickers,
            market_regime=regime_snapshot,
        )

        item_rows = briefing_payload.get("items")
        if not isinstance(item_rows, list):
            item_rows = []
            briefing_payload["items"] = item_rows
        present_symbols = {str(item.get("symbol") or "").upper() for item in item_rows if isinstance(item, dict)}
        for item in notable_items:
            if item.get("scan_failed") and item["symbol"] not in present_symbols:
                item_rows.append(
                    {
                        "symbol": item["symbol"],
                        "note": item["changes"][0],
                        "severity": "action",
                        "analysis_id": item.get("analysis_id"),
                        "scan_failed": True,
                    }
                )

        existing = db.query(Briefing).filter(Briefing.briefing_date == effective_date).first()
        if existing:
            existing.briefing_json = briefing_payload
            existing.created_at = datetime.utcnow()
            db.add(existing)
            db.commit()
            db.refresh(existing)
            return existing

        row = Briefing(briefing_date=effective_date, briefing_json=briefing_payload)
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    finally:
        scan_lock.release()


def _scheduled_morning_scan() -> None:
    db = SessionLocal()
    try:
        _run_morning_scan(db=db, run_date=briefing_date_for_now())
    except Exception as exc:
        logger.exception("Scheduled morning scan failed: %s", exc)
    finally:
        db.close()


def _run_startup_scan_catchup_if_needed() -> None:
    if not is_after_scan_time_et():
        return

    db = SessionLocal()
    try:
        today = briefing_date_for_now()
        existing = db.query(Briefing).filter(Briefing.briefing_date == today).first()
        if existing is None:
            _run_morning_scan(db=db, run_date=today)
    except Exception as exc:
        logger.exception("Startup scan catch-up failed: %s", exc)
    finally:
        db.close()


@app.on_event("startup")
def startup() -> None:
    global scan_scheduler
    Base.metadata.create_all(bind=engine)
    try:
        _ensure_analysis_schema()
        db = SessionLocal()
        try:
            _seed_watchlist_from_history(db)
        finally:
            db.close()
    except Exception as exc:  # pragma: no cover - defensive startup logging
        logger.exception("Failed to ensure analysis schema migration: %s", exc)

    try:
        scan_scheduler = BackgroundScheduler(timezone="America/New_York")
        scan_scheduler.add_job(
            _scheduled_morning_scan,
            trigger=CronTrigger(day_of_week="mon-fri", hour=8, minute=30, timezone="America/New_York"),
            id="weekday-morning-scan",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=60 * 60,
        )
        scan_scheduler.start()
    except Exception as exc:
        logger.exception("Failed to start scan scheduler: %s", exc)

    _run_startup_scan_catchup_if_needed()


@app.on_event("shutdown")
def shutdown() -> None:
    global scan_scheduler
    if scan_scheduler is not None:
        scan_scheduler.shutdown(wait=False)
        scan_scheduler = None


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
    fundamentals = get_fundamentals(symbol)
    catalysts = get_catalysts(symbol)
    market_regime = get_market_regime(fundamentals.get("sector"))

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
        "context_pack": {
            "fundamentals": fundamentals,
            "catalysts": catalysts,
            "market_regime": market_regime,
        },
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
        result = _run_and_store_analysis(ticker=ticker, query_text=request.query, db=db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Data pipeline error: {exc}") from exc

    return result


@app.get("/api/history", response_model=list[HistoryItem])
def history(db: Session = Depends(get_db)):
    rows = db.query(Analysis).order_by(Analysis.created_at.desc()).limit(200).all()
    return [_history_item_from_row(row) for row in rows]


@app.get("/api/watchlist", response_model=list[WatchlistItem])
def get_watchlist(db: Session = Depends(get_db)):
    rows = db.query(Watchlist).order_by(Watchlist.added_at.asc()).all()
    return [WatchlistItem(symbol=row.symbol, added_at=row.added_at) for row in rows]


@app.post("/api/watchlist", response_model=WatchlistItem)
def add_watchlist_item(request: WatchlistRequest, db: Session = Depends(get_db)):
    try:
        symbol = normalize_symbol(request.symbol)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    existing = db.query(Watchlist).filter(Watchlist.symbol == symbol).first()
    if existing:
        return WatchlistItem(symbol=existing.symbol, added_at=existing.added_at)

    count = db.query(Watchlist).count()
    if count >= WATCHLIST_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"Watchlist is limited to {WATCHLIST_LIMIT} tickers to cap morning scan API cost.",
        )

    row = Watchlist(symbol=symbol)
    db.add(row)
    db.commit()
    db.refresh(row)
    return WatchlistItem(symbol=row.symbol, added_at=row.added_at)


@app.delete("/api/watchlist/{symbol}", response_model=WatchlistItem)
def remove_watchlist_item(symbol: str, db: Session = Depends(get_db)):
    try:
        normalized_symbol = normalize_symbol(symbol)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    row = db.query(Watchlist).filter(Watchlist.symbol == normalized_symbol).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Ticker not found in watchlist.")

    response = WatchlistItem(symbol=row.symbol, added_at=row.added_at)
    db.delete(row)
    db.commit()
    return response


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


@app.get("/api/briefing/latest", response_model=BriefingRecord)
def get_latest_briefing(db: Session = Depends(get_db)):
    row = db.query(Briefing).order_by(Briefing.briefing_date.desc()).first()
    if row is None:
        raise HTTPException(status_code=404, detail="No briefing available yet.")
    return _build_briefing_record(row)


@app.get("/api/briefing/{briefing_date}", response_model=BriefingRecord)
def get_briefing_for_date(briefing_date: str, db: Session = Depends(get_db)):
    try:
        parsed_date = date.fromisoformat(briefing_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Date must be in YYYY-MM-DD format.") from exc

    row = db.query(Briefing).filter(Briefing.briefing_date == parsed_date).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Briefing not found for requested date.")
    return _build_briefing_record(row)


@app.post("/api/briefing/run", response_model=BriefingRecord)
def run_briefing_scan(db: Session = Depends(get_db)):
    try:
        row = _run_morning_scan(db=db, run_date=briefing_date_for_now())
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Briefing scan failed: {exc}") from exc
    return _build_briefing_record(row)


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


@app.get("/api/ticker/{symbol}/quote", response_model=TickerQuote)
def ticker_quote(symbol: str):
    try:
        return yahoo_client.fetch_quote(symbol=symbol.upper())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Unable to fetch quote data: {exc}") from exc
