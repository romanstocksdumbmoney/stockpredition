from __future__ import annotations

from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any, Literal
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf

from app.data.sp500_symbols import SP500_SYMBOLS

_CACHE_TTL = timedelta(minutes=5)
_PRICE_MIN = 5.0
_MARKET_CAP_MIN = 2_000_000_000.0
_VOLUME_MIN = 1_000_000.0
_LIST_LIMIT = 8

_cache_lock = Lock()
_cache: dict[str, Any] = {"fetched_at": None, "payload": None}


def get_market_movers() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    market_open = _is_regular_market_open(now)

    with _cache_lock:
        cached_at = _cache.get("fetched_at")
        cached_payload = _cache.get("payload")
        if isinstance(cached_payload, dict) and isinstance(cached_at, datetime):
            if market_open and (now - cached_at) <= _CACHE_TTL:
                return _with_session_label(cached_payload, "LIVE")
            if not market_open:
                return _with_session_label(cached_payload, "LAST SESSION")

    payload = _fetch_market_movers_payload()
    with _cache_lock:
        _cache["fetched_at"] = now
        _cache["payload"] = payload
    return _with_session_label(payload, "LIVE" if market_open else "LAST SESSION")


def _with_session_label(payload: dict[str, Any], label: Literal["LIVE", "LAST SESSION"]) -> dict[str, Any]:
    shaped = dict(payload)
    shaped["session_label"] = label
    return shaped


def _fetch_market_movers_payload() -> dict[str, Any]:
    gainers_quotes, losers_quotes, active_quotes = _fetch_screeners_or_fallback()

    gainers = _sort_and_cap(gainers_quotes, list_type="gainers")
    losers = _sort_and_cap(losers_quotes, list_type="losers")
    most_active = _sort_and_cap(active_quotes, list_type="most_active")
    as_of = _derive_as_of_iso(gainers, losers, most_active)
    market_news = _fetch_market_news()

    return {
        "gainers": _strip_internal_fields(gainers),
        "losers": _strip_internal_fields(losers),
        "most_active": _strip_internal_fields(most_active),
        "as_of": as_of,
        "market_news": market_news,
    }


def _fetch_screeners_or_fallback() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    try:
        gainers = _normalize_screener_quotes(yf.screen("day_gainers").get("quotes", []))
        losers = _normalize_screener_quotes(yf.screen("day_losers").get("quotes", []))
        active = _normalize_screener_quotes(yf.screen("most_actives").get("quotes", []))
        return gainers, losers, active
    except Exception:
        return _fallback_from_sp500_universe()


def _normalize_screener_quotes(quotes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for quote in quotes:
        if not isinstance(quote, dict):
            continue
        normalized = _normalize_common_item(
            symbol=quote.get("symbol"),
            name=quote.get("shortName") or quote.get("longName") or quote.get("displayName"),
            price=quote.get("regularMarketPrice"),
            change_pct=quote.get("regularMarketChangePercent"),
            volume=quote.get("regularMarketVolume"),
            average_volume=quote.get("averageDailyVolume3Month") or quote.get("averageDailyVolume10Day"),
            market_cap=quote.get("marketCap"),
            as_of_raw=quote.get("regularMarketTime"),
        )
        if normalized is not None:
            rows.append(normalized)
    return rows


def _fallback_from_sp500_universe() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    snapshot = _download_universe_snapshot()
    if not snapshot:
        return [], [], []

    top_gainers = sorted(snapshot, key=lambda row: row["change_pct"], reverse=True)[:120]
    top_losers = sorted(snapshot, key=lambda row: row["change_pct"])[:120]
    top_active = sorted(snapshot, key=lambda row: row["volume"], reverse=True)[:120]
    candidate_symbols = {row["symbol"] for row in top_gainers + top_losers + top_active}

    enriched_by_symbol: dict[str, dict[str, Any]] = {}
    for symbol in candidate_symbols:
        base = next((row for row in snapshot if row["symbol"] == symbol), None)
        if base is None:
            continue

        ticker = yf.Ticker(symbol)
        fast_info: dict[str, Any]
        info: dict[str, Any]
        try:
            fast_info = dict(ticker.fast_info)  # type: ignore[arg-type]
        except Exception:
            fast_info = {}
        try:
            info = ticker.info or {}
        except Exception:
            info = {}

        normalized = _normalize_common_item(
            symbol=symbol,
            name=info.get("shortName") or info.get("longName") or base.get("name"),
            price=base["price"],
            change_pct=base["change_pct"],
            volume=base["volume"],
            average_volume=fast_info.get("tenDayAverageVolume")
            or fast_info.get("ten_day_average_volume")
            or fast_info.get("threeMonthAverageVolume")
            or fast_info.get("three_month_average_volume"),
            market_cap=fast_info.get("marketCap") or fast_info.get("market_cap") or info.get("marketCap"),
            as_of_raw=base.get("as_of"),
        )
        if normalized is not None:
            enriched_by_symbol[symbol] = normalized

    enriched = list(enriched_by_symbol.values())
    gainers = [row for row in enriched if row["change_pct"] > 0]
    losers = [row for row in enriched if row["change_pct"] < 0]
    active = [row for row in enriched if row["volume"] is not None]
    return gainers, losers, active


def _download_universe_snapshot() -> list[dict[str, Any]]:
    try:
        raw = yf.download(
            tickers=" ".join(SP500_SYMBOLS),
            period="5d",
            interval="1d",
            auto_adjust=False,
            progress=False,
            group_by="ticker",
            threads=True,
        )
    except Exception:
        return []

    if raw is None or raw.empty or not isinstance(raw.columns, pd.MultiIndex):
        return []

    rows: list[dict[str, Any]] = []
    symbols = set(raw.columns.get_level_values(0).tolist())
    for symbol in SP500_SYMBOLS:
        if symbol not in symbols:
            continue
        frame = raw[symbol]
        if not isinstance(frame, pd.DataFrame) or frame.empty:
            continue
        close = frame["Close"].dropna() if "Close" in frame else pd.Series(dtype=float)
        volume = frame["Volume"].dropna() if "Volume" in frame else pd.Series(dtype=float)
        if len(close) < 2:
            continue
        latest_close = _to_float(close.iloc[-1])
        previous_close = _to_float(close.iloc[-2])
        latest_volume = _to_float(volume.iloc[-1]) if len(volume) else None
        if latest_close in (None,) or previous_close in (None, 0):
            continue
        change_pct = ((latest_close - previous_close) / previous_close) * 100
        as_of = close.index[-1].to_pydatetime() if hasattr(close.index[-1], "to_pydatetime") else None
        if isinstance(as_of, datetime) and as_of.tzinfo is None:
            as_of = as_of.replace(tzinfo=timezone.utc)
        rows.append(
            {
                "symbol": symbol,
                "name": symbol,
                "price": latest_close,
                "change_pct": change_pct,
                "volume": int(latest_volume) if latest_volume is not None else None,
                "as_of": as_of,
            }
        )
    return rows


def _normalize_common_item(
    *,
    symbol: Any,
    name: Any,
    price: Any,
    change_pct: Any,
    volume: Any,
    average_volume: Any,
    market_cap: Any,
    as_of_raw: Any,
) -> dict[str, Any] | None:
    ticker = str(symbol or "").upper().strip()
    if not ticker:
        return None

    parsed_price = _to_float(price)
    parsed_change = _to_float(change_pct)
    parsed_volume = _to_int(volume)
    parsed_avg_volume = _to_float(average_volume)
    parsed_market_cap = _to_float(market_cap)

    if parsed_price is None or parsed_change is None or parsed_market_cap in (None, 0):
        return None

    filter_volume = float(max(parsed_volume or 0, int(parsed_avg_volume or 0)))
    if parsed_price < _PRICE_MIN:
        return None
    if parsed_market_cap < _MARKET_CAP_MIN:
        return None
    if filter_volume < _VOLUME_MIN:
        return None

    as_of = _parse_timestamp(as_of_raw)
    return {
        "symbol": ticker,
        "name": _short_name(str(name or ticker)),
        "price": round(parsed_price, 4),
        "change_pct": round(parsed_change, 4),
        "volume": parsed_volume or int(parsed_avg_volume or 0),
        "market_cap": int(parsed_market_cap),
        "_as_of": as_of,
    }


def _sort_and_cap(rows: list[dict[str, Any]], *, list_type: Literal["gainers", "losers", "most_active"]) -> list[dict[str, Any]]:
    if list_type == "gainers":
        scoped = [row for row in rows if row["change_pct"] > 0]
        ordered = sorted(scoped, key=lambda row: abs(row["change_pct"]), reverse=True)
    elif list_type == "losers":
        scoped = [row for row in rows if row["change_pct"] < 0]
        ordered = sorted(scoped, key=lambda row: abs(row["change_pct"]), reverse=True)
    else:
        ordered = sorted(rows, key=lambda row: row["volume"] or 0, reverse=True)

    trimmed = ordered[:_LIST_LIMIT]
    return trimmed


def _derive_as_of_iso(*lists_: list[dict[str, Any]]) -> str | None:
    timestamps: list[datetime] = []
    for rows in lists_:
        for row in rows:
            ts = row.get("_as_of")
            if isinstance(ts, datetime):
                timestamps.append(ts.astimezone(timezone.utc))
    if not timestamps:
        return None
    return max(timestamps).isoformat()


def _strip_internal_fields(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "symbol": row["symbol"],
            "name": row["name"],
            "price": row["price"],
            "change_pct": row["change_pct"],
            "volume": row["volume"],
            "market_cap": row["market_cap"],
        }
        for row in rows
    ]


def _fetch_market_news() -> list[dict[str, Any]]:
    for symbol in ("^GSPC", "SPY"):
        try:
            ticker = yf.Ticker(symbol)
            raw_news = ticker.news or []
        except Exception:
            raw_news = []

        items: list[dict[str, Any]] = []
        for entry in raw_news:
            if not isinstance(entry, dict):
                continue
            content = entry.get("content") if isinstance(entry.get("content"), dict) else {}
            title = _to_str(entry.get("title")) or _to_str(content.get("title"))
            if not title:
                continue
            publisher = _to_str(entry.get("publisher")) or _to_str(
                (content.get("provider") or {}).get("displayName") if isinstance(content.get("provider"), dict) else None
            )
            published_at = _parse_timestamp(
                entry.get("providerPublishTime")
                or entry.get("publishedAt")
                or entry.get("pubDate")
                or content.get("pubDate")
                or content.get("displayTime")
            )
            canonical_url = None
            if isinstance(content.get("canonicalUrl"), dict):
                canonical_url = content.get("canonicalUrl", {}).get("url")
            click_url = None
            if isinstance(content.get("clickThroughUrl"), dict):
                click_url = content.get("clickThroughUrl", {}).get("url")
            items.append(
                {
                    "title": title,
                    "publisher": publisher,
                    "published_at": published_at.isoformat() if published_at else None,
                    "url": _to_str(entry.get("link") or entry.get("url") or canonical_url or click_url),
                }
            )
            if len(items) >= 4:
                break

        if items:
            return items
    return []


def _is_regular_market_open(now: datetime) -> bool:
    et = now.astimezone(ZoneInfo("America/New_York"))
    if et.weekday() >= 5:
        return False
    minute_of_day = et.hour * 60 + et.minute
    return 9 * 60 + 30 <= minute_of_day < 16 * 60


def _parse_timestamp(value: Any) -> datetime | None:
    try:
        if value is None:
            return None
        if isinstance(value, datetime):
            dt = value
        elif isinstance(value, (int, float)):
            seconds = float(value)
            if seconds > 1e12:
                seconds = seconds / 1000.0
            dt = datetime.fromtimestamp(seconds, tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(str(value))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _short_name(name: str) -> str:
    text = (name or "").strip()
    if len(text) <= 42:
        return text
    return f"{text[:39].rstrip()}..."


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _to_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(float(value))
    except Exception:
        return None


def _to_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
