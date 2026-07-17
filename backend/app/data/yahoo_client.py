from __future__ import annotations

from datetime import datetime
from typing import Any

import pandas as pd
import yfinance as yf


class YahooClient:
    """Thin wrapper around yfinance calls used by TradeBot."""

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
