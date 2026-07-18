from __future__ import annotations

from datetime import datetime, timezone
import unittest

from app.data.market_movers import _derive_as_of_iso, _normalize_common_item, _sort_and_cap


class MarketMoversTests(unittest.TestCase):
    def test_quality_filter_rejects_low_price_market_cap_and_volume(self) -> None:
        valid = _normalize_common_item(
            symbol="AAPL",
            name="Apple Inc.",
            price=200,
            change_pct=3.2,
            volume=2_500_000,
            average_volume=2_000_000,
            market_cap=3_000_000_000_000,
            as_of_raw=1_721_218_400,
        )
        self.assertIsNotNone(valid)

        low_price = _normalize_common_item(
            symbol="PENNY",
            name="Penny Name",
            price=4.99,
            change_pct=8.0,
            volume=5_000_000,
            average_volume=5_000_000,
            market_cap=5_000_000_000,
            as_of_raw=1_721_218_400,
        )
        self.assertIsNone(low_price)

        low_market_cap = _normalize_common_item(
            symbol="SMALL",
            name="Small Cap",
            price=12,
            change_pct=8.0,
            volume=5_000_000,
            average_volume=5_000_000,
            market_cap=1_999_999_999,
            as_of_raw=1_721_218_400,
        )
        self.assertIsNone(low_market_cap)

        low_volume = _normalize_common_item(
            symbol="THIN",
            name="Thin Name",
            price=12,
            change_pct=8.0,
            volume=200_000,
            average_volume=900_000,
            market_cap=10_000_000_000,
            as_of_raw=1_721_218_400,
        )
        self.assertIsNone(low_volume)

        missing_market_cap = _normalize_common_item(
            symbol="NOCAP",
            name="No Cap Name",
            price=50,
            change_pct=5.0,
            volume=2_000_000,
            average_volume=2_000_000,
            market_cap=None,
            as_of_raw=1_721_218_400,
        )
        self.assertIsNone(missing_market_cap)

    def test_sorting_and_caps(self) -> None:
        rows = []
        for idx in range(12):
            rows.append(
                {
                    "symbol": f"S{idx}",
                    "name": f"Name {idx}",
                    "price": 20.0,
                    "change_pct": float(idx + 1),
                    "volume": 1_000_000 + idx,
                    "market_cap": 3_000_000_000,
                    "_as_of": datetime(2026, 7, 18, 12, idx, tzinfo=timezone.utc),
                }
            )
        gainers = _sort_and_cap(rows, list_type="gainers")
        self.assertEqual(len(gainers), 8)
        self.assertEqual(gainers[0]["symbol"], "S11")
        self.assertEqual(gainers[-1]["symbol"], "S4")

        losers_input = [{**row, "change_pct": -row["change_pct"]} for row in rows]
        losers = _sort_and_cap(losers_input, list_type="losers")
        self.assertEqual(len(losers), 8)
        self.assertEqual(losers[0]["symbol"], "S11")
        self.assertEqual(losers[-1]["symbol"], "S4")

        active = _sort_and_cap(rows, list_type="most_active")
        self.assertEqual(len(active), 8)
        self.assertEqual(active[0]["volume"], 1_000_011)
        self.assertEqual(active[-1]["volume"], 1_000_004)

    def test_as_of_derivation_uses_latest_timestamp(self) -> None:
        rows_a = [{"_as_of": datetime(2026, 7, 18, 19, 59, tzinfo=timezone.utc)}]
        rows_b = [{"_as_of": datetime(2026, 7, 18, 20, 0, tzinfo=timezone.utc)}]
        derived = _derive_as_of_iso(rows_a, rows_b)
        self.assertEqual(derived, "2026-07-18T20:00:00+00:00")


if __name__ == "__main__":
    unittest.main()
