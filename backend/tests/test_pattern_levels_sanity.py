from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from app.data.patterns import detect_patterns


def _history_from_close(closes: list[float]) -> pd.DataFrame:
    idx = pd.date_range("2025-01-01", periods=len(closes), freq="D", tz="UTC")
    close_series = pd.Series(closes, index=idx)
    return pd.DataFrame(
        {
            "Open": close_series.shift(1).fillna(close_series.iloc[0]),
            "High": close_series + 1.2,
            "Low": close_series - 1.2,
            "Close": close_series,
            "Volume": np.linspace(1_000_000, 2_000_000, len(close_series)),
        }
    )


class PatternLevelSanityTests(unittest.TestCase):
    def test_levels_are_classified_around_latest_close(self) -> None:
        closes = (100 + np.sin(np.linspace(0, 12 * np.pi, 120)) * 6).tolist()
        closes[-1] = 100.0
        history = _history_from_close(closes)

        latest_close = float(history["Close"].iloc[-1])
        patterns = detect_patterns(history)
        support = patterns["support_levels"]
        resistance = patterns["resistance_levels"]

        self.assertTrue(support)
        self.assertTrue(resistance)
        self.assertTrue(all(level < latest_close for level in support))
        self.assertTrue(all(level > latest_close for level in resistance))

        support_dist = [latest_close - level for level in support]
        resistance_dist = [level - latest_close for level in resistance]
        self.assertEqual(support_dist, sorted(support_dist))
        self.assertEqual(resistance_dist, sorted(resistance_dist))

    def test_price_at_highs_when_no_resistance_above_close(self) -> None:
        closes = np.linspace(100, 180, 120).tolist()
        history = _history_from_close(closes)

        # Force "close at highs" by making the latest candle close at the session high.
        history.iloc[-1, history.columns.get_loc("High")] = history.iloc[-1]["Close"]
        patterns = detect_patterns(history)

        self.assertEqual(patterns["resistance_levels"], [])
        self.assertTrue(patterns["price_at_highs"])
        self.assertIn("price_at_highs", patterns["flags"])


if __name__ == "__main__":
    unittest.main()
