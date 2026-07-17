from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

try:
    from anthropic import Anthropic
except Exception:  # pragma: no cover - optional dependency fallback
    Anthropic = None  # type: ignore[assignment]


SYSTEM_PROMPT = """
You are TradeBot's reasoning engine: a disciplined, skeptical trading analyst.
You are not a signal seller and you are never promotional.

Rules:
1) Always produce BOTH sides: bull_case and bear_case, even if one side is weak.
2) Ground each claim in the provided data payload only. Do not use general market lore.
3) Every bull_case and bear_case bullet must contain at least one numeric citation from the payload.
4) You must explicitly cite the exact RSI value from payload.indicators.rsi.value in at least one bullet.
5) You must explicitly cite at least one support level and one resistance level from payload.patterns.
4) Be conservative with confidence due to uncertainty. Never return confidence above 94.
5) If data is thin/conflicting, say so in risk_flags and keep confidence moderate.
6) Do not include markdown. Return strict JSON that matches the required schema.
""".strip()


logger = logging.getLogger(__name__)


class TradeAnalyzer:
    def __init__(self, api_key: str | None, model: str):
        self.api_key = api_key
        self.model = model

    def analyze(self, ticker: str, signal_payload: dict[str, Any]) -> dict[str, Any]:
        if not self.api_key or Anthropic is None:
            if not self.api_key:
                logger.warning("Anthropic API key is missing; using fallback reasoning for %s.", ticker)
            if Anthropic is None:
                logger.warning("Anthropic SDK import unavailable; using fallback reasoning for %s.", ticker)
            heuristic = self._heuristic_analysis(ticker, signal_payload)
            heuristic["risk_flags"].append("LLM layer unavailable; using deterministic fallback analysis.")
            return heuristic

        try:
            client = Anthropic(api_key=self.api_key)
            for attempt in range(2):
                user_prompt = self._build_user_prompt(ticker=ticker, signal_payload=signal_payload, strict=attempt > 0)
                response = client.messages.create(
                    model=self.model,
                    system=SYSTEM_PROMPT,
                    max_tokens=900,
                    messages=[{"role": "user", "content": user_prompt}],
                )
                text = "".join(part.text for part in response.content if getattr(part, "type", "") == "text").strip()
                parsed = self._load_json(text)
                normalized = self._normalize_output(parsed, ticker, signal_payload)
                if self._has_required_numeric_references(normalized, signal_payload):
                    normalized["reasoning_source"] = "claude"
                    return normalized
                logger.warning("Claude response missing required numeric citations for %s (attempt %s).", ticker, attempt + 1)

            raise ValueError("Claude response did not include required RSI/support/resistance numeric citations.")
        except Exception as exc:
            logger.exception("Claude reasoning failed for %s: %s", ticker, exc)
            heuristic = self._heuristic_analysis(ticker, signal_payload)
            heuristic["risk_flags"].append(f"Claude call failed; fallback analysis used ({exc.__class__.__name__}: {exc}).")
            return heuristic

    @staticmethod
    def _build_user_prompt(ticker: str, signal_payload: dict[str, Any], strict: bool) -> str:
        strict_clause = ""
        if strict:
            strict_clause = (
                "\n\nHARD REQUIREMENT: Every bullet in both bull_case and bear_case must quote a payload number. "
                "At least one bullet must quote RSI exactly, and at least one bullish/bearish bullet must quote concrete "
                "support/resistance prices from payload.patterns."
            )

        return (
            "Analyze this market snapshot and output JSON only.\n\n"
            f"Ticker: {ticker}\n"
            f"Payload:\n{json.dumps(signal_payload, default=str)}\n\n"
            "Required JSON shape:\n"
            '{\n'
            '  "ticker": "AAPL",\n'
            '  "bull_case": ["reason 1", "reason 2", "reason 3"],\n'
            '  "bear_case": ["reason 1", "reason 2", "reason 3"],\n'
            '  "key_flow_signal": "short summary or null",\n'
            '  "pattern_summary": "short summary of chart pattern context",\n'
            '  "confidence_pct": 62,\n'
            '  "confidence_direction": "bullish | bearish | neutral",\n'
            '  "summary": "2-3 sentence plain-English takeaway",\n'
            '  "risk_flags": ["flag 1", "flag 2"]\n'
            "}\n"
            f"{strict_clause}\n"
        )

    @staticmethod
    def _numbers_in_text(text: str) -> list[float]:
        return [float(token) for token in re.findall(r"-?\d+(?:\.\d+)?", text)]

    def _has_required_numeric_references(self, normalized: dict[str, Any], signal_payload: dict[str, Any]) -> bool:
        bull_case = [str(item) for item in normalized.get("bull_case") or []]
        bear_case = [str(item) for item in normalized.get("bear_case") or []]
        points = [*bull_case, *bear_case]
        if not points:
            return False

        # Reject generic bullets by requiring at least one number in each line.
        if any(not re.search(r"\d", point) for point in points):
            return False

        rsi_value = signal_payload.get("indicators", {}).get("rsi", {}).get("value")
        support_levels = signal_payload.get("patterns", {}).get("support_levels") or []
        resistance_levels = signal_payload.get("patterns", {}).get("resistance_levels") or []

        has_rsi = rsi_value is None
        has_support = not support_levels
        has_resistance = not resistance_levels

        for point in points:
            values = self._numbers_in_text(point)
            if rsi_value is not None and any(abs(value - float(rsi_value)) <= 0.2 for value in values):
                has_rsi = True
            if support_levels and any(
                abs(value - float(level)) <= 0.05 for value in values for level in support_levels if level is not None
            ):
                has_support = True
            if resistance_levels and any(
                abs(value - float(level)) <= 0.05 for value in values for level in resistance_levels if level is not None
            ):
                has_resistance = True

        return has_rsi and has_support and has_resistance

    @staticmethod
    def _load_json(text: str) -> dict[str, Any]:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
            cleaned = re.sub(r"```$", "", cleaned).strip()
        loaded = json.loads(cleaned)
        if not isinstance(loaded, dict):
            raise ValueError("Expected object JSON from model")
        return loaded

    def _normalize_output(self, raw: dict[str, Any], ticker: str, signal_payload: dict[str, Any]) -> dict[str, Any]:
        bull_case = [str(item) for item in (raw.get("bull_case") or []) if str(item).strip()]
        bear_case = [str(item) for item in (raw.get("bear_case") or []) if str(item).strip()]
        if len(bull_case) < 3:
            bull_case.extend(
                [
                    "Price structure has at least one constructive signal from current data.",
                    "Momentum has not fully rolled over based on latest indicator readings.",
                    "Risk/reward may improve near support if buyers defend recent levels.",
                ][: 3 - len(bull_case)]
            )
        if len(bear_case) < 3:
            bear_case.extend(
                [
                    "Conflicting indicators reduce conviction for continuation.",
                    "Macro/earnings uncertainty can invalidate technical setups quickly.",
                    "Failure at resistance could trigger a short-term pullback.",
                ][: 3 - len(bear_case)]
            )

        confidence = int(raw.get("confidence_pct") or 50)
        confidence = max(5, min(confidence, 94))

        direction = str(raw.get("confidence_direction") or "neutral").lower().strip()
        if direction not in {"bullish", "bearish", "neutral"}:
            direction = "neutral"

        pattern_summary = str(raw.get("pattern_summary") or "").strip()
        if not pattern_summary:
            pattern_summary = self._fallback_pattern_summary(signal_payload.get("patterns") or {})

        summary = str(raw.get("summary") or "").strip()
        if not summary:
            summary = "Signals are mixed. TradeBot suggests balancing upside opportunity with downside risk before acting."

        key_flow_signal = raw.get("key_flow_signal")
        if key_flow_signal is not None:
            key_flow_signal = str(key_flow_signal)

        risk_flags = [str(flag) for flag in (raw.get("risk_flags") or []) if str(flag).strip()]
        if not risk_flags:
            risk_flags = ["Model returned limited risk detail; treat confidence as uncertain."]

        return {
            "ticker": ticker,
            "bull_case": bull_case[:5],
            "bear_case": bear_case[:5],
            "key_flow_signal": key_flow_signal,
            "pattern_summary": pattern_summary,
            "confidence_pct": confidence,
            "confidence_direction": direction,
            "summary": summary,
            "risk_flags": risk_flags[:6],
            "reasoning_source": "claude",
        }

    @staticmethod
    def _fallback_pattern_summary(patterns: dict[str, Any]) -> str:
        trend = patterns.get("trend_direction", "unknown")
        flags = patterns.get("flags") or []
        if flags:
            return f"Trend: {trend}. Notable chart flags: {', '.join(str(flag) for flag in flags[:3])}."
        return f"Trend: {trend}. No strong breakout/breakdown flag detected."

    def _heuristic_analysis(self, ticker: str, signal_payload: dict[str, Any]) -> dict[str, Any]:
        indicators = signal_payload.get("indicators", {})
        patterns = signal_payload.get("patterns", {})
        flow = signal_payload.get("flow_data", {})
        context = signal_payload.get("market_context", {})

        ema_state = indicators.get("ema", {}).get("state")
        macd_state = indicators.get("macd", {}).get("state")
        rsi_state = indicators.get("rsi", {}).get("state")
        rsi_value = indicators.get("rsi", {}).get("value")
        volume_ratio = indicators.get("volume_trend", {}).get("volume_ratio_20d")
        trend = patterns.get("trend_direction", "unknown")

        bull_score = 0
        bear_score = 0
        bull_case: list[str] = []
        bear_case: list[str] = []
        risk_flags: list[str] = []

        if ema_state == "bullish":
            bull_score += 2
            bull_case.append("EMA stack is bullish (9 > 21 > 50 > 200), showing constructive trend alignment.")
        elif ema_state == "bearish":
            bear_score += 2
            bear_case.append("EMA stack is bearish (9 < 21 < 50 < 200), indicating persistent downside pressure.")
        else:
            risk_flags.append("EMA stack is mixed, reducing trend clarity.")

        if macd_state == "bullish_momentum":
            bull_score += 1
            bull_case.append("MACD momentum is positive with line above signal.")
        elif macd_state == "bearish_momentum":
            bear_score += 1
            bear_case.append("MACD momentum is negative with line below signal.")

        if rsi_state == "oversold":
            bull_score += 1
            bull_case.append("RSI is near oversold levels, which can support mean-reversion bounces.")
        elif rsi_state == "overbought":
            bear_score += 1
            bear_case.append("RSI is near overbought territory, which can precede pullbacks.")
        elif rsi_value is None:
            risk_flags.append("RSI history is incomplete.")

        if patterns.get("breakout"):
            bull_score += 1
            bull_case.append("Price is attempting a breakout above the recent 20-session range.")
        if patterns.get("breakdown"):
            bear_score += 1
            bear_case.append("Price has broken below the recent 20-session range support.")
        if patterns.get("consolidation"):
            risk_flags.append("Consolidation regime can produce false breakouts in either direction.")

        if trend == "uptrend":
            bull_score += 1
            bull_case.append("Recent slope in price action still points upward.")
        elif trend == "downtrend":
            bear_score += 1
            bear_case.append("Recent slope in price action points downward.")

        if isinstance(volume_ratio, (int, float)) and volume_ratio >= 1.8:
            bull_score += 1
            bull_case.append("Volume is running materially above 20-day average, supporting move conviction.")
        elif isinstance(volume_ratio, (int, float)) and volume_ratio <= 0.7:
            bear_score += 1
            bear_case.append("Subpar volume participation weakens bullish follow-through potential.")

        call_put_ratio = flow.get("call_put_ratio")
        net_premium = flow.get("net_premium")
        key_flow_signal: str | None = None
        if flow.get("available"):
            if isinstance(call_put_ratio, (int, float)):
                if call_put_ratio >= 1.3:
                    bull_score += 1
                    key_flow_signal = f"Options flow leans bullish with call/put premium ratio near {call_put_ratio:.2f}."
                elif call_put_ratio <= 0.8:
                    bear_score += 1
                    key_flow_signal = f"Options flow leans bearish with call/put premium ratio near {call_put_ratio:.2f}."
                else:
                    key_flow_signal = f"Options flow appears balanced (call/put premium ratio near {call_put_ratio:.2f})."
            elif isinstance(net_premium, (int, float)):
                key_flow_signal = (
                    "Net options premium appears call-skewed."
                    if net_premium > 0
                    else "Net options premium appears put-skewed."
                )
            else:
                key_flow_signal = "Flow data is present but mixed."
        else:
            risk_flags.append("Options flow data unavailable or thin; conviction should be lower.")

        if not bull_case:
            bull_case = [
                "A rebound remains possible if support levels hold and momentum stabilizes.",
                "Even in weak setups, short covering can create upside bursts.",
                "Risk/reward can improve for bulls near validated support zones.",
            ]
        if not bear_case:
            bear_case = [
                "Failure to hold support could accelerate downside quickly.",
                "Momentum setups can fail abruptly when volume fades.",
                "Event risk can overwhelm otherwise constructive technicals.",
            ]

        score_delta = bull_score - bear_score
        if score_delta >= 2:
            direction = "bullish"
        elif score_delta <= -2:
            direction = "bearish"
        else:
            direction = "neutral"

        confidence = min(82, 52 + abs(score_delta) * 7)
        if len(risk_flags) >= 2:
            confidence = max(45, confidence - 8)

        pattern_summary = self._fallback_pattern_summary(patterns)
        last_price = context.get("last_price")
        change_pct = context.get("day_change_pct")
        summary = (
            f"{ticker} currently shows a {direction} tilt based on indicator and pattern balance."
            f" Last price {last_price} with day change {change_pct}%."
            " Treat this as a scenario-weighting exercise, not a prediction."
        )

        return {
            "ticker": ticker,
            "bull_case": bull_case[:5],
            "bear_case": bear_case[:5],
            "key_flow_signal": key_flow_signal,
            "pattern_summary": pattern_summary,
            "confidence_pct": int(max(5, min(confidence, 94))),
            "confidence_direction": direction,
            "summary": summary,
            "risk_flags": risk_flags[:6],
            "reasoning_source": "fallback",
        }


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
