from __future__ import annotations

import unittest

from app.briefing.scanner import detect_ticker_changes


class BriefingChangeDetectionTests(unittest.TestCase):
    def test_detects_trigger_cross_and_verdict_flip(self) -> None:
        previous = {
            "confidence_direction": "bullish",
            "confidence_pct": 72,
            "earnings_warning": False,
            "market_context": {"last_price": 100.0},
            "risk_flags": ["Old risk"],
            "scenarios": {
                "bull_trigger": "Break above 101.00 with volume",
                "bear_trigger": "Lose 97.50 support",
                "invalidation": "Below 95.00 invalidates setup",
            },
        }
        current = {
            "confidence_direction": "bearish",
            "confidence_pct": 53,
            "earnings_warning": True,
            "market_context": {"last_price": 102.0, "day_change_pct": 3.4},
            "risk_flags": ["Old risk", "Fresh flag"],
            "context_pack": {"catalysts": {"days_to_earnings": 5}},
        }

        detected = detect_ticker_changes(previous, current)

        self.assertEqual(detected["severity"], "action")
        joined = " ".join(detected["changes"])
        self.assertIn("Verdict flipped", joined)
        self.assertIn("Bull Trigger", joined)
        self.assertIn("Earnings are now within 5 day(s).", joined)
        self.assertIn("beyond ±3%", joined)

    def test_handles_pre_context_previous_without_scenarios(self) -> None:
        previous = {
            "confidence_direction": "neutral",
            "confidence_pct": 51,
            "market_context": {"last_price": 210.0},
        }
        current = {
            "confidence_direction": "neutral",
            "confidence_pct": 54,
            "market_context": {"last_price": 211.0, "day_change_pct": 0.3},
            "risk_flags": [],
        }

        detected = detect_ticker_changes(previous, current)

        self.assertEqual(detected["changes"], [])
        self.assertEqual(detected["severity"], "quiet")


if __name__ == "__main__":
    unittest.main()
