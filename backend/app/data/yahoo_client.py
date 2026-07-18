from __future__ import annotations

from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf


class YahooClient:
    """Thin wrapper around yfinance calls used by TradeBot."""

    def __init__(self) -> None:
        self._quote_cache: dict[str, tuple[datetime, dict[str, Any]]] = {}
        self._quote_cache_ttl = timedelta(seconds=10)
        self._cache_lock = Lock()

    def fetch_price_history(self, symbol: str, period: str = "6mo", interval: str = "1d") -> pd.DataFrame:
        ticker = yf.Ticker(symbol)
        history = ticker.history(period=period, interval=interval, auto_adjust=False)
        if history is None or history.empty:
            raise ValueError(f"No price history returned for '{symbol}'")

        history = history.dropna(subset=["Open", "High", "Low", "Close", "Volume"]).copy()
        if history.empty:
            raise ValueError(f"Price history for '{symbol}' had no usable OHLCV rows")

        if history.index.tz is None:
            history.index = history.index.tz_localize("UTC")
        else:
            history.index = history.index.tz_convert("UTC")
        return history

    def fetch_key_stats(self, symbol: str) -> dict[str, Any]:
        ticker = yf.Ticker(symbol)
        info = {}
        try:
            info = ticker.info or {}
        except Exception:
            info = {}

        fast_info = {}
        try:
            fast_info = dict(ticker.fast_info)  # type: ignore[arg-type]
        except Exception:
            fast_info = {}

        earnings_date = None
        try:
            calendar = ticker.calendar
            if calendar is not None and not getattr(calendar, "empty", True):
                value = calendar.iloc[0, 0]
                if isinstance(value, datetime):
                    earnings_date = value.isoformat()
                elif value is not None:
                    earnings_date = str(value)
        except Exception:
            earnings_date = None

        def pick(*keys: str) -> Any:
            for key in keys:
                if key in info and info[key] not in (None, ""):
                    return info[key]
                if key in fast_info and fast_info[key] not in (None, ""):
                    return fast_info[key]
            return None

        return {
            "short_name": pick("shortName"),
            "sector": pick("sector"),
            "market_cap": pick("marketCap"),
            "trailing_pe": pick("trailingPE"),
            "forward_pe": pick("forwardPE"),
            "fifty_two_week_high": pick("fiftyTwoWeekHigh", "yearHigh"),
            "fifty_two_week_low": pick("fiftyTwoWeekLow", "yearLow"),
            "avg_volume": pick("averageVolume", "tenDayAverageVolume"),
            "current_volume": pick("volume", "lastVolume"),
            "earnings_date": earnings_date,
        }

    def fetch_quote(self, symbol: str) -> dict[str, Any]:
        symbol = symbol.upper().strip()
        now = datetime.now(timezone.utc)

        with self._cache_lock:
            cached = self._quote_cache.get(symbol)
            if cached and (now - cached[0]) <= self._quote_cache_ttl:
                return dict(cached[1])

        ticker = yf.Ticker(symbol)
        fast_info: dict[str, Any]
        try:
            fast_info = dict(ticker.fast_info)  # type: ignore[arg-type]
        except Exception as exc:
            raise ValueError(f"Unable to fetch fast quote for '{symbol}': {exc}") from exc

        price = self._pick_float(fast_info, "lastPrice", "last_price", "regularMarketPrice", "regular_market_price")
        previous_close = self._pick_float(
            fast_info,
            "previousClose",
            "previous_close",
            "regularMarketPreviousClose",
            "regular_market_previous_close",
        )
        if price is None:
            raise ValueError(f"No quote price returned for '{symbol}'")

        change_pct = None
        if previous_close not in (None, 0):
            change_pct = round(((price - previous_close) / previous_close) * 100, 4)

        volume = self._pick_int(fast_info, "lastVolume", "last_volume", "regularMarketVolume", "regular_market_volume", "volume")
        as_of_dt = self._pick_timestamp(fast_info, now)
        market_state = self._market_state_from_fast_info(fast_info, as_of_dt)

        payload = {
            "price": price,
            "change_pct": change_pct,
            "volume": volume,
            "as_of": as_of_dt.isoformat(),
            "market_state": market_state,
        }

        with self._cache_lock:
            self._quote_cache[symbol] = (now, payload)

        return dict(payload)

    @staticmethod
    def to_ohlcv_records(history: pd.DataFrame) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for idx, row in history.iterrows():
            rows.append(
                {
                    "timestamp": idx.isoformat(),
                    "open": float(row["Open"]),
                    "high": float(row["High"]),
                    "low": float(row["Low"]),
                    "close": float(row["Close"]),
                    "volume": int(row["Volume"]),
                }
            )
        return rows

    @staticmethod
    def _pick_float(payload: dict[str, Any], *keys: str) -> float | None:
        for key in keys:
            value = payload.get(key)
            try:
                if value is None:
                    continue
                return float(value)
            except Exception:
                continue
        return None

    @staticmethod
    def _pick_int(payload: dict[str, Any], *keys: str) -> int | None:
        for key in keys:
            value = payload.get(key)
            try:
                if value is None:
                    continue
                return int(float(value))
            except Exception:
                continue
        return None

    @staticmethod
    def _pick_timestamp(payload: dict[str, Any], fallback: datetime) -> datetime:
        for key in ("lastTradeTime", "last_trade_time", "regularMarketTime", "regular_market_time"):
            value = payload.get(key)
            if value is None:
                continue
            try:
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
                else:
                    dt = dt.astimezone(timezone.utc)
                return dt
            except Exception:
                continue
        return fallback

    @staticmethod
    def _market_state_from_fast_info(payload: dict[str, Any], as_of: datetime) -> str:
        candidate = str(payload.get("marketState") or payload.get("market_state") or "").lower().strip()
        if candidate:
            if "pre" in candidate:
                return "pre"
            if "post" in candidate or "after" in candidate:
                return "post"
            if "open" in candidate or "regular" in candidate:
                return "open"
            if "close" in candidate:
                return "closed"

        et = as_of.astimezone(ZoneInfo("America/New_York"))
        weekday = et.weekday()
        minute_of_day = et.hour * 60 + et.minute
        if weekday >= 5:
            return "closed"
        if 4 * 60 <= minute_of_day < 9 * 60 + 30:
            return "pre"
        if 9 * 60 + 30 <= minute_of_day < 16 * 60:
            return "open"
        if 16 * 60 <= minute_of_day < 20 * 60:
            return "post"
        return "closed"
