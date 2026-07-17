from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def _float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
        return float(value)
    except Exception:
        return None


def _state_from_rsi(rsi: float | None) -> str:
    if rsi is None:
        return "unknown"
    if rsi >= 70:
        return "overbought"
    if rsi <= 30:
        return "oversold"
    return "neutral"


def _position_within_band(close: float | None, low: float | None, high: float | None) -> str:
    if None in (close, low, high) or high == low:
        return "unknown"
    ratio = (close - low) / (high - low)
    if ratio >= 0.85:
        return "near_upper_band"
    if ratio <= 0.15:
        return "near_lower_band"
    return "mid_band"


def _ema_stack_state(latest: dict[str, float | None]) -> str:
    e9 = latest.get("ema9")
    e21 = latest.get("ema21")
    e50 = latest.get("ema50")
    e200 = latest.get("ema200")
    if None in (e9, e21, e50, e200):
        return "incomplete"
    assert e9 is not None and e21 is not None and e50 is not None and e200 is not None
    if e9 > e21 > e50 > e200:
        return "bullish"
    if e9 < e21 < e50 < e200:
        return "bearish"
    return "mixed"


def _macd_state(macd: float | None, signal: float | None, hist: float | None) -> str:
    if None in (macd, signal, hist):
        return "unknown"
    assert macd is not None and signal is not None and hist is not None
    if macd > signal and hist > 0:
        return "bullish_momentum"
    if macd < signal and hist < 0:
        return "bearish_momentum"
    return "transitioning"


def _volume_trend_state(ma20: float | None, ma50: float | None) -> str:
    if ma20 is None or ma50 is None:
        return "unknown"
    if ma20 > ma50:
        return "increasing"
    if ma20 < ma50:
        return "decreasing"
    return "flat"


def _volume_profile(close: pd.Series, volume: pd.Series, bins: int = 12) -> dict[str, Any]:
    clean = pd.DataFrame({"close": close, "volume": volume}).dropna()
    if clean.empty:
        return {"point_of_control": None, "high_volume_nodes": []}

    min_price = float(clean["close"].min())
    max_price = float(clean["close"].max())
    if min_price == max_price:
        return {"point_of_control": min_price, "high_volume_nodes": [min_price]}

    edges = np.linspace(min_price, max_price, bins + 1)
    clean["bucket"] = np.clip(np.digitize(clean["close"], edges) - 1, 0, bins - 1)
    grouped = clean.groupby("bucket", as_index=False)["volume"].sum()
    centers = (edges[:-1] + edges[1:]) / 2

    grouped["center"] = grouped["bucket"].map(lambda idx: float(centers[int(idx)]))
    grouped = grouped.sort_values(by="volume", ascending=False)

    point_of_control = float(grouped.iloc[0]["center"]) if not grouped.empty else None
    nodes = [float(v) for v in grouped["center"].head(3).tolist()]
    return {"point_of_control": point_of_control, "high_volume_nodes": nodes}


def compute_indicators(history: pd.DataFrame) -> dict[str, Any]:
    close = history["Close"]
    high = history["High"]
    low = history["Low"]
    volume = history["Volume"]

    ema9 = close.ewm(span=9, adjust=False).mean()
    ema21 = close.ewm(span=21, adjust=False).mean()
    ema50 = close.ewm(span=50, adjust=False).mean()
    ema200 = close.ewm(span=200, adjust=False).mean()

    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    avg_loss_safe = avg_loss.replace(0, np.nan)
    rs = avg_gain / avg_loss_safe
    rsi = 100 - (100 / (1 + rs))
    rsi = rsi.where(~((avg_loss == 0) & (avg_gain > 0)), 100.0)
    rsi = rsi.where(~((avg_gain == 0) & (avg_loss > 0)), 0.0)
    rsi = rsi.where(~((avg_gain == 0) & (avg_loss == 0)), 50.0)

    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    signal_line = macd_line.ewm(span=9, adjust=False).mean()
    macd_hist = macd_line - signal_line

    bb_mid = close.rolling(window=20).mean()
    bb_std = close.rolling(window=20).std()
    bb_upper = bb_mid + (2 * bb_std)
    bb_lower = bb_mid - (2 * bb_std)

    prev_close = close.shift(1)
    tr = pd.concat(
        [
            (high - low),
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr = tr.rolling(window=14).mean()

    vol_ma20 = volume.rolling(window=20).mean()
    vol_ma50 = volume.rolling(window=50).mean()

    latest_ema = {
        "ema9": _float(ema9.iloc[-1]),
        "ema21": _float(ema21.iloc[-1]),
        "ema50": _float(ema50.iloc[-1]),
        "ema200": _float(ema200.iloc[-1]),
    }

    latest_close = _float(close.iloc[-1])
    latest_bb_upper = _float(bb_upper.iloc[-1])
    latest_bb_lower = _float(bb_lower.iloc[-1])
    latest_macd = _float(macd_line.iloc[-1])
    latest_signal = _float(signal_line.iloc[-1])
    latest_hist = _float(macd_hist.iloc[-1])
    latest_rsi = _float(rsi.iloc[-1])
    latest_atr = _float(atr.iloc[-1])
    latest_vol = _float(volume.iloc[-1])
    latest_vol_ma20 = _float(vol_ma20.iloc[-1])
    latest_vol_ma50 = _float(vol_ma50.iloc[-1])

    vol_ratio = None
    if latest_vol is not None and latest_vol_ma20 not in (None, 0):
        vol_ratio = latest_vol / latest_vol_ma20

    atr_pct = None
    if latest_atr is not None and latest_close not in (None, 0):
        atr_pct = (latest_atr / latest_close) * 100

    volume_profile = _volume_profile(close.tail(90), volume.tail(90))

    return {
        "ema": {
            **latest_ema,
            "state": _ema_stack_state(latest_ema),
        },
        "rsi": {
            "value": latest_rsi,
            "state": _state_from_rsi(latest_rsi),
        },
        "macd": {
            "line": latest_macd,
            "signal": latest_signal,
            "histogram": latest_hist,
            "state": _macd_state(latest_macd, latest_signal, latest_hist),
        },
        "bollinger_bands": {
            "upper": latest_bb_upper,
            "middle": _float(bb_mid.iloc[-1]),
            "lower": latest_bb_lower,
            "position": _position_within_band(latest_close, latest_bb_lower, latest_bb_upper),
        },
        "atr": {
            "value": latest_atr,
            "atr_pct_of_price": atr_pct,
        },
        "volume_trend": {
            "latest_volume": latest_vol,
            "average_volume_20d": latest_vol_ma20,
            "average_volume_50d": latest_vol_ma50,
            "volume_ratio_20d": vol_ratio,
            "trend": _volume_trend_state(latest_vol_ma20, latest_vol_ma50),
            "anomaly": bool(vol_ratio and vol_ratio >= 1.8),
        },
        "volume_profile": volume_profile,
    }
