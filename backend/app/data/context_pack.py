from __future__ import annotations

from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any

import pandas as pd
import yfinance as yf

SECTOR_ETF_MAP: dict[str, str] = {
    "Technology": "XLK",
    "Financial Services": "XLF",
    "Financials": "XLF",
    "Energy": "XLE",
    "Healthcare": "XLV",
    "Consumer Cyclical": "XLY",
    "Consumer Defensive": "XLP",
    "Industrials": "XLI",
    "Utilities": "XLU",
    "Basic Materials": "XLB",
    "Materials": "XLB",
    "Real Estate": "XLRE",
    "Communication Services": "XLC",
}

_MARKET_REGIME_CACHE_TTL = timedelta(minutes=10)
_market_regime_cache_lock = Lock()
_market_regime_cache: dict[str, Any] = {"fetched_at": None, "payload": None}


def map_sector_to_etf(sector: str | None) -> str | None:
    if not sector:
        return None
    return SECTOR_ETF_MAP.get(str(sector).strip())


def bucket_vix(vix_value: float | None) -> str | None:
    if vix_value is None:
        return None
    if vix_value < 15:
        return "calm"
    if vix_value < 20:
        return "normal"
    if vix_value < 30:
        return "elevated"
    return "stressed"


def compute_days_to_earnings(next_earnings_date: datetime | None, now: datetime | None = None) -> int | None:
    if next_earnings_date is None:
        return None
    now_utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    next_utc = next_earnings_date.astimezone(timezone.utc)
    days = (next_utc.date() - now_utc.date()).days
    if days < 0:
        return None
    return int(days)


def get_fundamentals(symbol: str) -> dict[str, Any]:
    defaults = {
        "market_cap": None,
        "pe_trailing": None,
        "pe_forward": None,
        "price_to_sales": None,
        "revenue_growth_yoy": None,
        "profit_margin": None,
        "short_percent_float": None,
        "beta": None,
        "dividend_yield": None,
        "sector": None,
        "industry": None,
    }
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}
    except Exception:
        return defaults

    return {
        "market_cap": _to_float(info.get("marketCap")),
        "pe_trailing": _to_float(info.get("trailingPE")),
        "pe_forward": _to_float(info.get("forwardPE")),
        "price_to_sales": _to_float(info.get("priceToSalesTrailing12Months") or info.get("priceToSales")),
        "revenue_growth_yoy": _to_float(info.get("revenueGrowth")),
        "profit_margin": _to_float(info.get("profitMargins")),
        "short_percent_float": _to_float(info.get("shortPercentOfFloat")),
        "beta": _to_float(info.get("beta")),
        "dividend_yield": _to_float(info.get("dividendYield")),
        "sector": _to_str_or_none(info.get("sector")),
        "industry": _to_str_or_none(info.get("industry")),
    }


def get_catalysts(symbol: str) -> dict[str, Any]:
    defaults = {
        "next_earnings_date": None,
        "days_to_earnings": None,
        "recent_news": None,
    }
    try:
        ticker = yf.Ticker(symbol)
    except Exception:
        return defaults

    next_earnings_date = _extract_next_earnings_date(ticker)
    days_to_earnings = compute_days_to_earnings(next_earnings_date)

    news_rows: list[dict[str, Any]] = []
    try:
        raw_news = ticker.news or []
        for item in raw_news[:5]:
            if not isinstance(item, dict):
                continue
            content = item.get("content") if isinstance(item.get("content"), dict) else {}
            title = _to_str_or_none(item.get("title")) or _to_str_or_none(content.get("title"))
            if not title:
                continue
            publisher = _to_str_or_none(item.get("publisher")) or _to_str_or_none(
                (content.get("provider") or {}).get("displayName") if isinstance(content.get("provider"), dict) else None
            )
            published_dt = _parse_datetime(
                item.get("providerPublishTime")
                or item.get("publishedAt")
                or item.get("pubDate")
                or content.get("pubDate")
                or content.get("displayTime")
            )
            canonical_url = None
            if isinstance(content.get("canonicalUrl"), dict):
                canonical_url = content.get("canonicalUrl", {}).get("url")
            click_url = None
            if isinstance(content.get("clickThroughUrl"), dict):
                click_url = content.get("clickThroughUrl", {}).get("url")
            news_rows.append(
                {
                    "title": title,
                    "publisher": publisher,
                    "published_at": published_dt.isoformat() if published_dt else None,
                    "url": _to_str_or_none(item.get("link") or item.get("url") or canonical_url or click_url),
                }
            )
    except Exception:
        news_rows = []

    return {
        "next_earnings_date": next_earnings_date.isoformat() if next_earnings_date else None,
        "days_to_earnings": days_to_earnings,
        "recent_news": news_rows or None,
    }


def get_market_regime(sector: str | None = None) -> dict[str, Any]:
    cached_base = _get_market_regime_base_cached()
    selected_etf = map_sector_to_etf(sector)
    etf_performance_by_symbol = cached_base.get("sector_etf_1mo_by_symbol") or {}
    sector_etf = None
    if selected_etf:
        sector_etf = {
            "symbol": selected_etf,
            "performance_1mo_pct": _to_float(etf_performance_by_symbol.get(selected_etf)),
        }

    return {
        "spy": cached_base.get("spy"),
        "vix": cached_base.get("vix"),
        "sector_etf": sector_etf,
    }


def _get_market_regime_base_cached() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    with _market_regime_cache_lock:
        cached_at = _market_regime_cache.get("fetched_at")
        cached_payload = _market_regime_cache.get("payload")
        if (
            isinstance(cached_at, datetime)
            and isinstance(cached_payload, dict)
            and (now - cached_at) <= _MARKET_REGIME_CACHE_TTL
        ):
            return dict(cached_payload)

    payload = _fetch_market_regime_base()
    with _market_regime_cache_lock:
        _market_regime_cache["fetched_at"] = now
        _market_regime_cache["payload"] = payload
    return dict(payload)


def _fetch_market_regime_base() -> dict[str, Any]:
    spy_data = {"last_close": None, "pct_vs_ema50": None, "trend": None}
    vix_data = {"last_close": None, "bucket": None}
    sector_etf_1mo_by_symbol: dict[str, float | None] = {}

    try:
        spy_history = yf.Ticker("SPY").history(period="3mo", interval="1d", auto_adjust=False)
        closes = spy_history["Close"].dropna()
        if not closes.empty:
            last_close = float(closes.iloc[-1])
            ema50 = float(closes.ewm(span=50, adjust=False).mean().iloc[-1])
            pct_vs_ema50 = None
            if ema50:
                pct_vs_ema50 = round(((last_close - ema50) / ema50) * 100, 4)
            spy_data = {
                "last_close": last_close,
                "pct_vs_ema50": pct_vs_ema50,
                "trend": "above" if pct_vs_ema50 is not None and pct_vs_ema50 >= 0 else "below",
            }
    except Exception:
        spy_data = {"last_close": None, "pct_vs_ema50": None, "trend": None}

    try:
        vix_history = yf.Ticker("^VIX").history(period="1mo", interval="1d", auto_adjust=False)
        vix_closes = vix_history["Close"].dropna()
        if not vix_closes.empty:
            vix_last = float(vix_closes.iloc[-1])
            vix_data = {"last_close": vix_last, "bucket": bucket_vix(vix_last)}
    except Exception:
        vix_data = {"last_close": None, "bucket": None}

    for etf_symbol in set(SECTOR_ETF_MAP.values()):
        sector_etf_1mo_by_symbol[etf_symbol] = _fetch_1mo_performance_pct(etf_symbol)

    return {
        "spy": spy_data,
        "vix": vix_data,
        "sector_etf_1mo_by_symbol": sector_etf_1mo_by_symbol,
    }


def _fetch_1mo_performance_pct(symbol: str) -> float | None:
    try:
        history = yf.Ticker(symbol).history(period="1mo", interval="1d", auto_adjust=False)
        closes = history["Close"].dropna()
        if len(closes) < 2:
            return None
        start = float(closes.iloc[0])
        end = float(closes.iloc[-1])
        if start == 0:
            return None
        return round(((end - start) / start) * 100, 4)
    except Exception:
        return None


def _extract_next_earnings_date(ticker: yf.Ticker) -> datetime | None:
    candidates: list[datetime] = []

    try:
        calendar = ticker.calendar
        if isinstance(calendar, pd.DataFrame) and not calendar.empty:
            for value in calendar.to_numpy().flatten().tolist():
                dt = _parse_datetime(value)
                if dt is not None:
                    candidates.append(dt)
    except Exception:
        pass

    try:
        earnings_dates = ticker.earnings_dates
        if isinstance(earnings_dates, pd.DataFrame) and not earnings_dates.empty:
            for idx in earnings_dates.index.tolist():
                dt = _parse_datetime(idx)
                if dt is not None:
                    candidates.append(dt)
    except Exception:
        pass

    now = datetime.now(timezone.utc)
    future_or_today = [dt for dt in candidates if dt.astimezone(timezone.utc).date() >= now.date()]
    if not future_or_today:
        return None
    return min(future_or_today)


def _parse_datetime(value: Any) -> datetime | None:
    try:
        if value is None:
            return None
        if isinstance(value, pd.Timestamp):
            dt = value.to_pydatetime()
        elif isinstance(value, datetime):
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


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _to_str_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
