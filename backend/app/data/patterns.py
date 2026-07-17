from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def _cluster_levels(levels: list[float], tolerance_pct: float = 0.007, max_levels: int = 3) -> list[float]:
    if not levels:
        return []
    levels = sorted(levels)
    clusters: list[list[float]] = [[levels[0]]]
    for level in levels[1:]:
        prev = clusters[-1][-1]
        if prev == 0:
            clusters[-1].append(level)
            continue
        if abs(level - prev) / prev <= tolerance_pct:
            clusters[-1].append(level)
        else:
            clusters.append([level])
    averaged = [float(sum(cluster) / len(cluster)) for cluster in clusters]
    return averaged[:max_levels]


def detect_patterns(history: pd.DataFrame) -> dict[str, Any]:
    if history.empty:
        return {
            "trend_direction": "unknown",
            "breakout": False,
            "breakdown": False,
            "consolidation": False,
            "support_levels": [],
            "resistance_levels": [],
            "flags": ["insufficient_data"],
            "explanations": ["No price history available to evaluate patterns."],
        }

    recent = history.tail(min(90, len(history))).copy()
    close = recent["Close"].reset_index(drop=True)
    high = recent["High"].reset_index(drop=True)
    low = recent["Low"].reset_index(drop=True)

    support_points: list[float] = []
    resistance_points: list[float] = []

    for idx in range(2, len(recent) - 2):
        low_window = low.iloc[idx - 2 : idx + 3]
        high_window = high.iloc[idx - 2 : idx + 3]
        if low.iloc[idx] == low_window.min():
            support_points.append(float(low.iloc[idx]))
        if high.iloc[idx] == high_window.max():
            resistance_points.append(float(high.iloc[idx]))

    if not support_points:
        support_points.append(float(low.tail(20).min()))
    if not resistance_points:
        resistance_points.append(float(high.tail(20).max()))

    support_levels = _cluster_levels(support_points)
    resistance_levels = _cluster_levels(resistance_points[::-1])[::-1]

    slope_pct = 0.0
    if len(close) >= 10:
        x = np.arange(len(close))
        slope, _ = np.polyfit(x, close.to_numpy(), 1)
        mean_price = float(close.mean()) or 1.0
        slope_pct = (float(slope) / mean_price) * 100

    if slope_pct > 0.12:
        trend_direction = "uptrend"
    elif slope_pct < -0.12:
        trend_direction = "downtrend"
    else:
        trend_direction = "sideways"

    latest_close = float(close.iloc[-1])
    prior_20_high = float(high.iloc[-21:-1].max()) if len(high) > 21 else float(high.max())
    prior_20_low = float(low.iloc[-21:-1].min()) if len(low) > 21 else float(low.min())
    breakout = latest_close > (prior_20_high * 1.002)
    breakdown = latest_close < (prior_20_low * 0.998)

    trailing_range = (float(high.tail(20).max()) - float(low.tail(20).min())) / max(latest_close, 1e-9)
    consolidation = trailing_range <= 0.06

    flags: list[str] = []
    explanations: list[str] = []
    if trend_direction == "uptrend":
        flags.append("higher_lows_higher_highs")
        explanations.append("Recent slope of closing prices points to an uptrend.")
    elif trend_direction == "downtrend":
        flags.append("lower_lows_lower_highs")
        explanations.append("Recent slope of closing prices points to a downtrend.")
    else:
        flags.append("range_bound")
        explanations.append("Price slope is relatively flat, suggesting a sideways regime.")

    if breakout:
        flags.append("breakout")
        explanations.append("Latest close pushed above the prior 20-session range high.")
    if breakdown:
        flags.append("breakdown")
        explanations.append("Latest close dropped below the prior 20-session range low.")
    if consolidation:
        flags.append("consolidation")
        explanations.append("20-session range is tight, indicating consolidation.")

    return {
        "trend_direction": trend_direction,
        "slope_pct_per_bar": round(slope_pct, 4),
        "breakout": breakout,
        "breakdown": breakdown,
        "consolidation": consolidation,
        "support_levels": [round(level, 2) for level in support_levels],
        "resistance_levels": [round(level, 2) for level in resistance_levels],
        "flags": flags,
        "explanations": explanations,
    }
