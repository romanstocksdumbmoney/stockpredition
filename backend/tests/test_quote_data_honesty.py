from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app.data.yahoo_client import YahooClient


class _FakeTicker:
    def __init__(self, fast_info: dict, info: dict | None = None) -> None:
        self.fast_info = fast_info
        self.info = info or {}


class QuoteDataHonestyTests(unittest.TestCase):
    @patch("app.data.yahoo_client.yf.Ticker")
    def test_change_pct_uses_regular_market_previous_close_first(self, ticker_mock) -> None:
        ts = int(datetime(2026, 7, 17, 20, 0, tzinfo=timezone.utc).timestamp())
        ticker_mock.return_value = _FakeTicker(
            fast_info={
                "lastPrice": 110.0,
                "previousClose": 100.0,
                "regularMarketPreviousClose": 105.0,
                "regularMarketTime": ts,
            }
        )

        quote = YahooClient().fetch_quote("AAPL")
        expected = round(((110.0 - 105.0) / 105.0) * 100, 4)

        self.assertEqual(quote["change_pct"], expected)

    @patch("app.data.yahoo_client.yf.Ticker")
    def test_change_pct_falls_back_to_previous_close(self, ticker_mock) -> None:
        ts = int(datetime(2026, 7, 17, 20, 0, tzinfo=timezone.utc).timestamp())
        ticker_mock.return_value = _FakeTicker(
            fast_info={
                "lastPrice": 110.0,
                "previousClose": 100.0,
                "regularMarketTime": ts,
            }
        )

        quote = YahooClient().fetch_quote("AAPL")
        expected = round(((110.0 - 100.0) / 100.0) * 100, 4)

        self.assertEqual(quote["change_pct"], expected)

    @patch("app.data.yahoo_client.yf.Ticker")
    def test_as_of_is_null_when_no_real_timestamp_available(self, ticker_mock) -> None:
        ticker_mock.return_value = _FakeTicker(
            fast_info={
                "lastPrice": 110.0,
                "regularMarketPreviousClose": 100.0,
            },
            info={},
        )

        quote = YahooClient().fetch_quote("AAPL")
        self.assertIsNone(quote["as_of"])


if __name__ == "__main__":
    unittest.main()
