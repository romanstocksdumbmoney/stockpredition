from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from app.data.context_pack import bucket_vix, compute_days_to_earnings, map_sector_to_etf


class ContextPackSanityTests(unittest.TestCase):
    def test_sector_etf_mapping(self) -> None:
        self.assertEqual(map_sector_to_etf("Technology"), "XLK")
        self.assertEqual(map_sector_to_etf("Financials"), "XLF")
        self.assertEqual(map_sector_to_etf("Real Estate"), "XLRE")
        self.assertEqual(map_sector_to_etf("Unknown Sector"), None)

    def test_vix_bucket_boundaries(self) -> None:
        self.assertEqual(bucket_vix(14.99), "calm")
        self.assertEqual(bucket_vix(15.0), "normal")
        self.assertEqual(bucket_vix(19.99), "normal")
        self.assertEqual(bucket_vix(20.0), "elevated")
        self.assertEqual(bucket_vix(29.99), "elevated")
        self.assertEqual(bucket_vix(30.0), "stressed")
        self.assertIsNone(bucket_vix(None))

    def test_days_to_earnings_handles_null_and_past_dates(self) -> None:
        now = datetime(2026, 7, 17, 12, 0, tzinfo=timezone.utc)
        self.assertIsNone(compute_days_to_earnings(None, now=now))
        self.assertIsNone(compute_days_to_earnings(now - timedelta(days=1), now=now))
        self.assertEqual(compute_days_to_earnings(now, now=now), 0)
        self.assertEqual(compute_days_to_earnings(now + timedelta(days=6), now=now), 6)


if __name__ == "__main__":
    unittest.main()
