from __future__ import annotations

import json
import re
from datetime import date, datetime, time, timezone
from typing import Any
from zoneinfo import ZoneInfo

try:
    from anthropic import Anthropic
except Exception:  # pragma: no cover - optional dependency fallback
    Anthropic = None  # type: ignore[assignment]

WATCHLIST_LIMIT = 10
SCAN_DELAY_SECONDS = 1.2
EASTERN = ZoneInfo("America/New_York")
SCAN_TIME_ET = time(hour=8, minute=30)

_BRIEFING_TOOL = {
    "name": "submit_morning_briefing",
    "description": "Return the structured TradeBot morning briefing.",
    "input_schema": {
        "type": "object",
        "properties": {
            "headline": {"type": "string"},
            "market_note": {"type": "string"},
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "symbol": {"type": "string"},
                        "note": {"type": "string"},
                        "severity": {"type": "string"},
                    },
                    "required": ["symbol", "note", "severity"],
                },
            },
            "quiet_tickers": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["headline", "market_note", "items", "quiet_tickers"],
    },
}


def normalize_symbol(raw: str) -> str:
    symbol = str(raw or "").strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", symbol):
        raise ValueError("Symbol must be 1-10 chars using A-Z, 0-9, dot, or dash.")
    return symbol


def briefing_date_for_now(now: datetime | None = None) -> date:
    current = now or datetime.now(timezone.utc)
    return current.astimezone(EASTERN).date()


def is_after_scan_time_et(now: datetime | None = None) -> bool:
    current = (now or datetime.now(timezone.utc)).astimezone(EASTERN)
    if current.weekday() >= 5:
        return False
    return current.time() >= SCAN_TIME_ET


def _extract_levels(text: str | None) -> list[float]:
    if not text:
        return []
    return [float(token) for token in re.findall(r"-?\d+(?:\.\d+)?", str(text))]


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _crossed_level(previous_price: float, current_price: float, level: float) -> bool:
    return (previous_price < level <= current_price) or (previous_price > level >= current_price)


def detect_ticker_changes(previous: dict[str, Any] | None, current: dict[str, Any]) -> dict[str, Any]:
    changes: list[str] = []
    previous = previous or {}

    prev_direction = str(previous.get("confidence_direction") or "").lower()
    curr_direction = str(current.get("confidence_direction") or "").lower()
    prev_conf = _to_float(previous.get("confidence_pct"))
    curr_conf = _to_float(current.get("confidence_pct"))
    curr_price = _to_float((current.get("market_context") or {}).get("last_price"))
    prev_price = _to_float((previous.get("market_context") or {}).get("last_price"))

    verdict_flip = {prev_direction, curr_direction} == {"bullish", "bearish"}
    if verdict_flip:
        changes.append(f"Verdict flipped from {prev_direction} to {curr_direction}.")

    confidence_jump = (
        prev_conf is not None and curr_conf is not None and abs(curr_conf - prev_conf) >= 15
    )
    if confidence_jump and prev_conf is not None and curr_conf is not None:
        changes.append(f"Confidence moved {prev_conf:.0f}% → {curr_conf:.0f}% (Δ {curr_conf - prev_conf:+.0f}).")

    trigger_hit_changes: list[str] = []
    prev_scenarios = previous.get("scenarios") if isinstance(previous.get("scenarios"), dict) else {}
    if prev_price is not None and curr_price is not None and prev_scenarios:
        for key in ("bull_trigger", "bear_trigger", "invalidation"):
            levels = _extract_levels(prev_scenarios.get(key))
            if not levels:
                continue
            for level in levels:
                if _crossed_level(prev_price, curr_price, level):
                    trigger_hit_changes.append(
                        f"{key.replace('_', ' ').title()} level {level:.2f} was crossed (price {prev_price:.2f} → {curr_price:.2f})."
                    )
                    break
    changes.extend(trigger_hit_changes)

    prev_earnings_warning = bool(previous.get("earnings_warning"))
    curr_earnings_warning = bool(current.get("earnings_warning"))
    if curr_earnings_warning and not prev_earnings_warning:
        days = (current.get("context_pack") or {}).get("catalysts", {}).get("days_to_earnings")
        if isinstance(days, int):
            changes.append(f"Earnings are now within {days} day(s).")
        else:
            changes.append("Earnings are now within 7 days.")

    day_move = _to_float((current.get("market_context") or {}).get("day_change_pct"))
    if day_move is not None and abs(day_move) >= 3:
        changes.append(f"Day move is {day_move:+.2f}%, beyond ±3%.")

    prev_flags = {str(flag).strip().lower() for flag in (previous.get("risk_flags") or []) if str(flag).strip()}
    new_flags = [
        str(flag).strip()
        for flag in (current.get("risk_flags") or [])
        if str(flag).strip() and str(flag).strip().lower() not in prev_flags
    ]
    if new_flags:
        changes.append(f"New risk flag: {new_flags[0]}.")

    if trigger_hit_changes or verdict_flip or (curr_earnings_warning and not prev_earnings_warning):
        severity = "action"
    elif confidence_jump or new_flags or (day_move is not None and abs(day_move) >= 3):
        severity = "watch"
    else:
        severity = "quiet"

    return {"changes": changes, "severity": severity}


def _market_note_from_regime(regime: dict[str, Any] | None) -> str:
    regime = regime or {}
    spy = regime.get("spy") or {}
    vix = regime.get("vix") or {}
    sector = regime.get("sector_etf") or {}
    spy_part = "SPY regime unavailable"
    if spy.get("trend") and isinstance(_to_float(spy.get("pct_vs_ema50")), float):
        spy_part = f"SPY {spy['trend']} trend ({_to_float(spy.get('pct_vs_ema50')):+.2f}% vs 50 EMA)"
    vix_part = "VIX unavailable"
    if isinstance(_to_float(vix.get("last_close")), float):
        vix_part = f"VIX {_to_float(vix.get('last_close')):.1f} ({vix.get('bucket') or 'unknown'})"
    sector_part = "Sector ETF unavailable"
    if sector.get("symbol") and isinstance(_to_float(sector.get("performance_1mo_pct")), float):
        sector_part = f"{sector['symbol']} {_to_float(sector.get('performance_1mo_pct')):+.1f}% (1mo)"
    return f"{spy_part} · {vix_part} · {sector_part}"


def _fallback_briefing(
    run_date: date,
    notable_items: list[dict[str, Any]],
    quiet_tickers: list[str],
    market_note: str,
) -> dict[str, Any]:
    action_count = sum(1 for item in notable_items if item["severity"] == "action")
    watch_count = sum(1 for item in notable_items if item["severity"] == "watch")
    if action_count:
        headline = f"{action_count} action setup(s) and {watch_count} watchlist shift(s) ahead of the open."
    elif watch_count:
        headline = f"{watch_count} watchlist ticker(s) shifted this morning."
    else:
        headline = "Quiet pre-market scan with no major watchlist shifts."

    items = []
    for item in notable_items:
        symbol = item["symbol"]
        changes = item.get("changes") or []
        if item.get("scan_failed"):
            note = "Scan failed for this ticker in the latest run; review manually."
        elif changes:
            note = " ".join(changes[:2])
        else:
            direction = item.get("analysis", {}).get("confidence_direction", "neutral")
            confidence = item.get("analysis", {}).get("confidence_pct", "n/a")
            note = f"{direction} lean at {confidence}% with no major deltas detected."
        items.append(
            {
                "symbol": symbol,
                "note": note,
                "severity": item["severity"],
                "analysis_id": item.get("analysis_id"),
                "scan_failed": bool(item.get("scan_failed")),
            }
        )

    return {
        "headline": headline,
        "market_note": market_note,
        "items": items,
        "quiet_tickers": quiet_tickers,
        "date": run_date.isoformat(),
    }


def generate_briefing_payload(
    *,
    api_key: str | None,
    model: str,
    run_date: date,
    notable_items: list[dict[str, Any]],
    quiet_tickers: list[str],
    market_regime: dict[str, Any] | None,
) -> dict[str, Any]:
    market_note = _market_note_from_regime(market_regime)

    if not notable_items and not quiet_tickers:
        return {
            "headline": "Watchlist is empty. Add symbols to enable the pre-market briefing.",
            "market_note": market_note,
            "items": [],
            "quiet_tickers": [],
            "date": run_date.isoformat(),
        }

    if not api_key or Anthropic is None:
        return _fallback_briefing(run_date, notable_items, quiet_tickers, market_note)

    compact_items = [
        {
            "symbol": item["symbol"],
            "changes": item.get("changes") or [],
            "severity": item["severity"],
            "scan_failed": bool(item.get("scan_failed")),
            "summary": (item.get("analysis") or {}).get("summary"),
            "confidence_direction": (item.get("analysis") or {}).get("confidence_direction"),
            "confidence_pct": (item.get("analysis") or {}).get("confidence_pct"),
            "scenarios": (item.get("analysis") or {}).get("scenarios"),
            "risk_flags": (item.get("analysis") or {}).get("risk_flags"),
        }
        for item in notable_items
    ]

    prompt_payload = {
        "run_date": run_date.isoformat(),
        "market_note": market_note,
        "notable_items": compact_items,
        "quiet_tickers": quiet_tickers,
    }
    prompt = (
        "You are TradeBot's pre-market briefing writer.\n"
        "Return strict JSON via the provided tool only.\n"
        "Use only payload facts; do not invent data.\n"
        "Each item note must cite specific detected changes and numbers.\n"
        f"Payload:\n{json.dumps(prompt_payload, default=str)}"
    )

    try:
        client = Anthropic(api_key=api_key)
        response = client.messages.create(
            model=model,
            max_tokens=1200,
            messages=[{"role": "user", "content": prompt}],
            tools=[_BRIEFING_TOOL],
            tool_choice={"type": "tool", "name": _BRIEFING_TOOL["name"]},
        )
        parsed = None
        if isinstance(response.content, list):
            for block in response.content:
                if str(getattr(block, "type", "")).lower() == "tool_use" and isinstance(
                    getattr(block, "input", None), dict
                ):
                    parsed = getattr(block, "input")
                    break
        if not isinstance(parsed, dict):
            raise ValueError("Briefing tool response missing.")
    except Exception:
        return _fallback_briefing(run_date, notable_items, quiet_tickers, market_note)

    items: list[dict[str, Any]] = []
    parsed_items = parsed.get("items") if isinstance(parsed.get("items"), list) else []
    analysis_id_by_symbol = {item["symbol"]: item.get("analysis_id") for item in notable_items}
    failure_by_symbol = {item["symbol"]: bool(item.get("scan_failed")) for item in notable_items}
    for row in parsed_items:
        if not isinstance(row, dict):
            continue
        symbol = str(row.get("symbol") or "").strip().upper()
        if not symbol:
            continue
        severity = str(row.get("severity") or "watch").strip().lower()
        if severity not in {"action", "watch", "quiet"}:
            severity = "watch"
        note = str(row.get("note") or "").strip()
        if not note:
            note = "No additional commentary provided."
        items.append(
            {
                "symbol": symbol,
                "note": note,
                "severity": severity,
                "analysis_id": analysis_id_by_symbol.get(symbol),
                "scan_failed": failure_by_symbol.get(symbol, False),
            }
        )

    return {
        "headline": str(parsed.get("headline") or "").strip() or "Pre-market briefing ready.",
        "market_note": str(parsed.get("market_note") or market_note).strip() or market_note,
        "items": items,
        "quiet_tickers": [str(symbol).strip().upper() for symbol in (parsed.get("quiet_tickers") or quiet_tickers)],
        "date": run_date.isoformat(),
    }
