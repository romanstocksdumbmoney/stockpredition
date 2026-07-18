#!/usr/bin/env python3
from __future__ import annotations

import argparse
import math
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import yfinance as yf

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.data.context_pack import get_fundamentals  # noqa: E402
from app.data.indicators import compute_indicators  # noqa: E402
from app.data.patterns import detect_patterns  # noqa: E402
from app.data.yahoo_client import YahooClient  # noqa: E402


@dataclass
class AuditRow:
    metric: str
    displayed: str
    raw_source: str
    computation: str


@dataclass
class Finding:
    symbol: str
    category: str
    detail: str
    root_cause: str


def _fmt_num(value: Any, ndigits: int = 6) -> str:
    if value is None:
        return "null"
    try:
        n = float(value)
    except Exception:
        return str(value)
    if math.isnan(n) or math.isinf(n):
        return "null"
    return f"{n:.{ndigits}f}".rstrip("0").rstrip(".")


def _fmt_pct_from_decimal(value: Any, ndigits: int = 2) -> str:
    if value is None:
        return "null"
    try:
        n = float(value) * 100
    except Exception:
        return "null"
    return f"{n:.{ndigits}f}%"


def _fmt_dt(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, datetime):
        dt = value
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    return str(value)


def _pick_value(payload: dict[str, Any], keys: list[str]) -> tuple[str | None, Any]:
    for key in keys:
        if key in payload and payload[key] not in (None, ""):
            return key, payload[key]
    return None, None


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        n = float(value)
        if math.isnan(n) or math.isinf(n):
            return None
        return n
    except Exception:
        return None


def _normalize_history(history: pd.DataFrame) -> pd.DataFrame:
    usable = history.dropna(subset=["Open", "High", "Low", "Close", "Volume"]).copy()
    if usable.index.tz is None:
        usable.index = usable.index.tz_localize("UTC")
    else:
        usable.index = usable.index.tz_convert("UTC")
    return usable


def _render_table(rows: list[AuditRow]) -> str:
    headers = ["metric", "displayed", "raw yfinance source", "computation"]
    widths = [len(h) for h in headers]
    matrix = [[r.metric, r.displayed, r.raw_source, r.computation] for r in rows]
    for row in matrix:
        for idx, cell in enumerate(row):
            widths[idx] = min(max(widths[idx], len(cell)), 64)

    def trunc(cell: str, width: int) -> str:
        if len(cell) <= width:
            return cell
        if width <= 3:
            return cell[:width]
        return cell[: width - 3] + "..."

    line = " | ".join(h.ljust(widths[i]) for i, h in enumerate(headers))
    sep = "-+-".join("-" * widths[i] for i in range(len(widths)))
    out = [line, sep]
    for row in matrix:
        out.append(" | ".join(trunc(cell, widths[i]).ljust(widths[i]) for i, cell in enumerate(row)))
    return "\n".join(out)


def audit_symbol(symbol: str) -> tuple[list[AuditRow], list[Finding]]:
    symbol = symbol.upper().strip()
    findings: list[Finding] = []
    rows: list[AuditRow] = []

    client = YahooClient()
    quote = client.fetch_quote(symbol)
    fundamentals = get_fundamentals(symbol)
    history_unadj = client.fetch_price_history(symbol, period="6mo", interval="1d")
    indicators_unadj = compute_indicators(history_unadj)
    patterns_unadj = detect_patterns(history_unadj)

    ticker = yf.Ticker(symbol)
    try:
        fast_info = dict(ticker.fast_info)  # type: ignore[arg-type]
    except Exception:
        fast_info = {}
    try:
        info = ticker.info or {}
    except Exception:
        info = {}

    raw_hist_unadj = _normalize_history(ticker.history(period="6mo", interval="1d", auto_adjust=False))

    price_key, raw_fast_price = _pick_value(
        fast_info,
        ["lastPrice", "last_price", "regularMarketPrice", "regular_market_price"],
    )
    prev_key, raw_prev_close = _pick_value(
        fast_info,
        ["regularMarketPreviousClose", "regular_market_previous_close", "previousClose", "previous_close"],
    )
    raw_change_pct_fast = None
    if raw_fast_price not in (None, "") and raw_prev_close not in (None, "", 0):
        try:
            raw_change_pct_fast = ((float(raw_fast_price) - float(raw_prev_close)) / float(raw_prev_close)) * 100
        except Exception:
            raw_change_pct_fast = None

    reg_prev_key, regular_market_prev_close = _pick_value(
        fast_info,
        ["regularMarketPreviousClose", "regular_market_previous_close"],
    )
    raw_change_pct_regular = None
    if raw_fast_price not in (None, "") and regular_market_prev_close not in (None, "", 0):
        try:
            raw_change_pct_regular = (
                (float(raw_fast_price) - float(regular_market_prev_close)) / float(regular_market_prev_close)
            ) * 100
        except Exception:
            raw_change_pct_regular = None

    close_unadj = raw_hist_unadj["Close"].dropna()
    history_day_change = None
    if len(close_unadj) >= 2 and close_unadj.iloc[-2] != 0:
        history_day_change = ((float(close_unadj.iloc[-1]) - float(close_unadj.iloc[-2])) / float(close_unadj.iloc[-2])) * 100

    rows.extend(
        [
            AuditRow(
                metric="quote.price",
                displayed=_fmt_num(quote.get("price"), 4),
                raw_source=f"fast_info[{price_key}]={_fmt_num(raw_fast_price, 4)} | info[currentPrice]={_fmt_num(info.get('currentPrice'), 4)}",
                computation=f"YahooClient.fetch_quote picks first key in [lastPrice,last_price,regularMarketPrice,regular_market_price]; chosen={price_key}",
            ),
            AuditRow(
                metric="quote.change_pct",
                displayed=f"{_fmt_num(quote.get('change_pct'), 4)}%",
                raw_source=(
                    f"fast change={( _fmt_num(raw_change_pct_fast,4) )}% from {price_key}/{prev_key}; "
                    f"regular change={_fmt_num(raw_change_pct_regular,4)}% via {reg_prev_key}; "
                    f"history close-to-close={_fmt_num(history_day_change,4)}%"
                ),
                computation=f"((price - previous_close)/previous_close)*100 where previous_close from key order [regularMarketPreviousClose,regular_market_previous_close,previousClose,previous_close]; chosen={prev_key}",
            ),
            AuditRow(
                metric="quote.volume",
                displayed=_fmt_num(quote.get("volume"), 0),
                raw_source=f"fast_info[lastVolume]={_fmt_num(fast_info.get('lastVolume'),0)} | fast_info[volume]={_fmt_num(fast_info.get('volume'),0)} | info[volume]={_fmt_num(info.get('volume'),0)}",
                computation="YahooClient.fetch_quote picks first int key in [lastVolume,last_volume,regularMarketVolume,regular_market_volume,volume]",
            ),
            AuditRow(
                metric="quote.market_state",
                displayed=str(quote.get("market_state")),
                raw_source=f"fast_info[marketState]={fast_info.get('marketState')} | as_of={quote.get('as_of')}",
                computation="Use fast_info.marketState when present, else infer from as_of timestamp in America/New_York trading session windows",
            ),
            AuditRow(
                metric="fundamentals.market_cap",
                displayed=_fmt_num(fundamentals.get("market_cap"), 0),
                raw_source=f"info[marketCap]={_fmt_num(info.get('marketCap'),0)} | fast_info[marketCap]={_fmt_num(fast_info.get('marketCap'),0)}",
                computation="context_pack.get_fundamentals -> float(info['marketCap'])",
            ),
            AuditRow(
                metric="fundamentals.pe_trailing",
                displayed=_fmt_num(fundamentals.get("pe_trailing"), 4),
                raw_source=f"info[trailingPE]={_fmt_num(info.get('trailingPE'),4)}",
                computation="context_pack.get_fundamentals -> float(info['trailingPE'])",
            ),
            AuditRow(
                metric="fundamentals.pe_forward",
                displayed=_fmt_num(fundamentals.get("pe_forward"), 4),
                raw_source=f"info[forwardPE]={_fmt_num(info.get('forwardPE'),4)}",
                computation="context_pack.get_fundamentals -> float(info['forwardPE'])",
            ),
            AuditRow(
                metric="fundamentals.revenue_growth_yoy",
                displayed=f"{_fmt_num(fundamentals.get('revenue_growth_yoy'),6)} ({_fmt_pct_from_decimal(fundamentals.get('revenue_growth_yoy'))})",
                raw_source=f"info[revenueGrowth]={_fmt_num(info.get('revenueGrowth'),6)}",
                computation="Stored as decimal fraction from info['revenueGrowth']; UI formats as percent by multiplying by 100",
            ),
            AuditRow(
                metric="fundamentals.profit_margin",
                displayed=f"{_fmt_num(fundamentals.get('profit_margin'),6)} ({_fmt_pct_from_decimal(fundamentals.get('profit_margin'))})",
                raw_source=f"info[profitMargins]={_fmt_num(info.get('profitMargins'),6)}",
                computation="Stored as decimal fraction from info['profitMargins']; UI formats as percent by multiplying by 100",
            ),
            AuditRow(
                metric="fundamentals.short_percent_float",
                displayed=f"{_fmt_num(fundamentals.get('short_percent_float'),6)} ({_fmt_pct_from_decimal(fundamentals.get('short_percent_float'))})",
                raw_source=f"info[shortPercentOfFloat]={_fmt_num(info.get('shortPercentOfFloat'),6)}",
                computation="Stored as decimal fraction from info['shortPercentOfFloat']; UI formats as percent by multiplying by 100",
            ),
            AuditRow(
                metric="fundamentals.beta",
                displayed=_fmt_num(fundamentals.get("beta"), 6),
                raw_source=f"info[beta]={_fmt_num(info.get('beta'),6)}",
                computation="context_pack.get_fundamentals -> float(info['beta'])",
            ),
            AuditRow(
                metric="indicators.rsi",
                displayed=_fmt_num(indicators_unadj.get("rsi", {}).get("value"), 4),
                raw_source=f"unadjusted close tail={','.join(_fmt_num(v,2) for v in close_unadj.tail(5).tolist())}",
                computation="RSI(14) via Wilder EWMA: avg_gain/avg_loss over unadjusted Close from yfinance history(auto_adjust=False)",
            ),
            AuditRow(
                metric="indicators.ema9/21/50/200",
                displayed=(
                    f"{_fmt_num(indicators_unadj.get('ema', {}).get('ema9'),4)} / "
                    f"{_fmt_num(indicators_unadj.get('ema', {}).get('ema21'),4)} / "
                    f"{_fmt_num(indicators_unadj.get('ema', {}).get('ema50'),4)} / "
                    f"{_fmt_num(indicators_unadj.get('ema', {}).get('ema200'),4)}"
                ),
                raw_source=f"close[-1]={_fmt_num(close_unadj.iloc[-1],4)} from yfinance history(auto_adjust=False)",
                computation="EMA spans 9/21/50/200 with pandas ewm(adjust=False) on unadjusted Close",
            ),
            AuditRow(
                metric="indicators.macd",
                displayed=(
                    f"line={_fmt_num(indicators_unadj.get('macd', {}).get('line'),4)}, "
                    f"signal={_fmt_num(indicators_unadj.get('macd', {}).get('signal'),4)}, "
                    f"hist={_fmt_num(indicators_unadj.get('macd', {}).get('histogram'),4)}"
                ),
                raw_source="close series from yfinance history(auto_adjust=False)",
                computation="MACD line=EMA12-EMA26; signal=EMA9(MACD); histogram=line-signal",
            ),
            AuditRow(
                metric="indicators.bollinger",
                displayed=(
                    f"upper={_fmt_num(indicators_unadj.get('bollinger_bands', {}).get('upper'),4)}, "
                    f"mid={_fmt_num(indicators_unadj.get('bollinger_bands', {}).get('middle'),4)}, "
                    f"lower={_fmt_num(indicators_unadj.get('bollinger_bands', {}).get('lower'),4)}"
                ),
                raw_source="close series from yfinance history(auto_adjust=False)",
                computation="Bollinger(20,2): middle=SMA20, upper=middle+2*std20, lower=middle-2*std20",
            ),
            AuditRow(
                metric="patterns.support_levels",
                displayed=str(patterns_unadj.get("support_levels")),
                raw_source=f"latest_close={_fmt_num(close_unadj.iloc[-1],4)} | low/high pivots from last 90 bars",
                computation="Local extrema clustered (~0.7% tolerance), then filtered to levels below latest close and sorted by proximity",
            ),
            AuditRow(
                metric="patterns.resistance_levels",
                displayed=str(patterns_unadj.get("resistance_levels")),
                raw_source=f"latest_close={_fmt_num(close_unadj.iloc[-1],4)} | low/high pivots from last 90 bars",
                computation="Local extrema clustered (~0.7% tolerance), then filtered to levels above latest close and sorted by proximity",
            ),
            AuditRow(
                metric="price_series_basis",
                displayed="unadjusted",
                raw_source="yfinance history(auto_adjust=False) used by fetch_price_history",
                computation="Indicators and support/resistance are both computed from the same unadjusted OHLCV series",
            ),
        ]
    )

    quote_change_pct = _to_float(quote.get("change_pct"))
    expected_change_pct = raw_change_pct_regular if raw_change_pct_regular is not None else raw_change_pct_fast
    if quote_change_pct is not None and expected_change_pct is not None and abs(quote_change_pct - expected_change_pct) > 0.2:
        findings.append(
            Finding(
                symbol=symbol,
                category="change_pct formula mismatch",
                detail=(
                    f"Displayed quote change_pct={_fmt_num(quote_change_pct,4)}% differs from expected baseline "
                    f"{_fmt_num(expected_change_pct,4)}% by {_fmt_num(abs(quote_change_pct - expected_change_pct),4)} pts."
                ),
                root_cause=(
                    "Displayed change_pct should match the endpoint formula against regular-market previous close (fallback to previous close)."
                ),
            )
        )

    info_current_price = _to_float(info.get("currentPrice"))
    fast_price = _to_float(raw_fast_price)
    if info_current_price is not None and fast_price is not None and info_current_price != 0:
        pct_diff = abs(fast_price - info_current_price) / abs(info_current_price) * 100
        if pct_diff > 0.5:
            findings.append(
                Finding(
                    symbol=symbol,
                    category="fast_info vs info mismatch",
                    detail=(
                        f"fast_info price={_fmt_num(fast_price,4)} vs info.currentPrice={_fmt_num(info_current_price,4)} "
                        f"({pct_diff:.2f}% difference)."
                    ),
                    root_cause="yfinance `.info` often lags while `.fast_info` is quote-oriented and updates more frequently.",
                )
            )

    info_market_cap = _to_float(info.get("marketCap"))
    fast_market_cap = _to_float(fast_info.get("marketCap") or fast_info.get("market_cap"))
    if info_market_cap is not None and fast_market_cap is not None and info_market_cap != 0:
        cap_diff_pct = abs(info_market_cap - fast_market_cap) / info_market_cap * 100
        if cap_diff_pct > 1:
            findings.append(
                Finding(
                    symbol=symbol,
                    category="fast_info vs info mismatch",
                    detail=(
                        f"info.marketCap={_fmt_num(info_market_cap,0)} vs fast_info marketCap={_fmt_num(fast_market_cap,0)} "
                        f"({cap_diff_pct:.2f}% difference)."
                    ),
                    root_cause="Different yfinance payload update cadences and possible float-share count timing differences.",
                )
            )

    market_time = info.get("regularMarketTime")
    parsed_market_time: datetime | None = None
    if market_time is not None:
        if isinstance(market_time, datetime):
            parsed_market_time = market_time
        elif isinstance(market_time, (int, float)):
            ts = float(market_time)
            if ts > 1e12:
                ts = ts / 1000.0
            parsed_market_time = datetime.fromtimestamp(ts, tz=timezone.utc)
    if parsed_market_time is not None:
        now_utc = datetime.now(timezone.utc)
        age_hours = (now_utc - parsed_market_time.astimezone(timezone.utc)).total_seconds() / 3600
        if age_hours > 24:
            findings.append(
                Finding(
                    symbol=symbol,
                    category="stale info fields",
                    detail=f"info.regularMarketTime is {age_hours:.1f} hours old ({_fmt_dt(parsed_market_time)}).",
                    root_cause="`Ticker.info` metadata can be stale, especially outside regular market sessions.",
                )
            )

    for field_name, display_name in [
        ("revenueGrowth", "revenue_growth_yoy"),
        ("profitMargins", "profit_margin"),
        ("shortPercentOfFloat", "short_percent_float"),
        ("dividendYield", "dividend_yield"),
    ]:
        val = _to_float(info.get(field_name))
        if val is None:
            continue
        if 1.5 < abs(val) <= 100:
            findings.append(
                Finding(
                    symbol=symbol,
                    category="percent scaling risk (100x)",
                    detail=f"info.{field_name}={_fmt_num(val,6)} is >1 and would display as {_fmt_pct_from_decimal(val)} if treated as decimal fraction.",
                    root_cause="Potential upstream unit mismatch (already-percent vs decimal fraction). App assumes decimal fractions for percent fields.",
                )
            )

    as_of_value = quote.get("as_of")
    as_of_dt: datetime | None = None
    if isinstance(as_of_value, str):
        try:
            as_of_dt = datetime.fromisoformat(as_of_value)
            if as_of_dt.tzinfo is None:
                as_of_dt = as_of_dt.replace(tzinfo=timezone.utc)
            else:
                as_of_dt = as_of_dt.astimezone(timezone.utc)
        except Exception:
            as_of_dt = None
    quote_has_native_time = any(k in fast_info for k in ("lastTradeTime", "last_trade_time", "regularMarketTime", "regular_market_time"))
    if quote.get("market_state") == "closed" and as_of_dt is not None and not quote_has_native_time:
        age_minutes = (datetime.now(timezone.utc) - as_of_dt).total_seconds() / 60
        if age_minutes < 5:
            findings.append(
                Finding(
                    symbol=symbol,
                    category="market-closed timestamp edge case",
                    detail=(
                        f"market_state=closed but as_of={_fmt_dt(as_of_dt)} appears to be fetch-time (fresh, {age_minutes:.1f} min old) with no fast_info trade timestamp keys."
                    ),
                    root_cause="Quote endpoint falls back to current time when fast_info lacks timestamp, so `as_of` can represent fetch time instead of exchange trade time.",
                )
            )

    return rows, findings


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Audit displayed TradeBot values against raw yfinance sources and formulas."
    )
    parser.add_argument("symbols", nargs="+", help="One or more ticker symbols (e.g. AAPL NVDA TSLA)")
    args = parser.parse_args()

    all_findings: list[Finding] = []

    print(f"Data Accuracy Audit run at {datetime.now(timezone.utc).isoformat()}")
    for raw_symbol in args.symbols:
        symbol = raw_symbol.upper().strip()
        print("\n" + "=" * 120)
        print(f"TICKER: {symbol}")
        try:
            rows, findings = audit_symbol(symbol)
        except Exception as exc:
            print(f"Audit failed for {symbol}: {exc}")
            continue

        print(_render_table(rows))
        if findings:
            print("\nPotentially suspicious findings:")
            for idx, finding in enumerate(findings, start=1):
                print(
                    f"  {idx}. [{finding.category}] {finding.detail} Root cause: {finding.root_cause}"
                )
        else:
            print("\nPotentially suspicious findings: none triggered by current heuristics.")
        all_findings.extend(findings)

    print("\n" + "=" * 120)
    print("ROLLUP FINDINGS")
    if not all_findings:
        print("No suspicious findings triggered.")
        return 0

    for idx, finding in enumerate(all_findings, start=1):
        print(
            f"{idx}. {finding.symbol} [{finding.category}] {finding.detail} Root cause: {finding.root_cause}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
