from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from app.data.indicators import compute_indicators


def _history_from_closes(closes: list[float]) -> pd.DataFrame:
    idx = pd.date_range("2025-01-01", periods=len(closes), freq="D", tz="UTC")
    close_series = pd.Series(closes, index=idx)
    return pd.DataFrame(
        {
            "Open": close_series.shift(1).fillna(close_series.iloc[0]),
            "High": close_series + 1.5,
            "Low": close_series - 1.5,
            "Close": close_series,
            "Volume": np.linspace(1_000_000, 1_800_000, len(close_series)),
        }
    )


class IndicatorSanityTests(unittest.TestCase):
    def test_rsi_direction_on_synthetic_series(self) -> None:
        uptrend = _history_from_closes(np.linspace(100, 180, 90).tolist())
        downtrend = _history_from_closes(np.linspace(180, 100, 90).tolist())

        up_rsi = compute_indicators(uptrend)["rsi"]["value"]
        down_rsi = compute_indicators(downtrend)["rsi"]["value"]

        self.assertIsNotNone(up_rsi)
        self.assertIsNotNone(down_rsi)
        assert up_rsi is not None and down_rsi is not None
        self.assertGreater(up_rsi, down_rsi)
        self.assertGreater(up_rsi, 50)
        self.assertLess(down_rsi, 50)

    def test_ema_responsiveness_prefers_shorter_window(self) -> None:
        closes = [100.0] * 70 + [110.0, 120.0, 135.0, 150.0, 165.0]
        history = _history_from_closes(closes)
        ema = compute_indicators(history)["ema"]

        ema9 = ema["ema9"]
        ema21 = ema["ema21"]
        ema50 = ema["ema50"]
        self.assertIsNotNone(ema9)
        self.assertIsNotNone(ema21)
        self.assertIsNotNone(ema50)
        assert ema9 is not None and ema21 is not None and ema50 is not None

        latest_close = closes[-1]
        self.assertGreater(ema9, ema21)
        self.assertGreater(ema21, ema50)
        self.assertLess(abs(latest_close - ema9), abs(latest_close - ema50))

    def test_bollinger_band_width_expands_with_volatility(self) -> None:
        low_vol = _history_from_closes((100 + np.sin(np.linspace(0, 5, 120)) * 0.3).tolist())
        high_vol = _history_from_closes((100 + np.sin(np.linspace(0, 20, 120)) * 8).tolist())

        low_bb = compute_indicators(low_vol)["bollinger_bands"]
        high_bb = compute_indicators(high_vol)["bollinger_bands"]

        low_width = float(low_bb["upper"]) - float(low_bb["lower"])
        high_width = float(high_bb["upper"]) - float(high_bb["lower"])

        self.assertGreater(high_width, low_width)
        self.assertIn(high_bb["position"], {"near_upper_band", "near_lower_band", "mid_band"})


if __name__ == "__main__":
    unittest.main()
