from __future__ import annotations

import json
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
3) Be conservative with confidence due to uncertainty. Never return confidence above 94.
4) If data is thin/conflicting, say so in risk_flags and keep confidence moderate.
5) Do not include markdown. Return strict JSON that matches the required schema.
""".strip()


class TradeAnalyzer:
    def __init__(self, api_key: str | None, model: str):
        self.api_key = api_key
        self.model = model

    def analyze(self, ticker: str, signal_payload: dict[str, Any]) -> dict[str, Any]:
        if not self.api_key or Anthropic is None:
            heuristic = self._heuristic_analysis(ticker, signal_payload)
            heuristic["risk_flags"].append("LLM layer unavailable; using deterministic fallback analysis.")
            return heuristic

        try:
            client = Anthropic(api_key=self.api_key)
            user_prompt = (
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
            )
            response = client.messages.create(
                model=self.model,
                system=SYSTEM_PROMPT,
                max_tokens=900,
                temperature=0.2,
                messages=[{"role": "user", "content": user_prompt}],
            )
            text = "".join(part.text for part in response.content if getattr(part, "type", "") == "text").strip()
            parsed = self._load_json(text)
            return self._normalize_output(parsed, ticker, signal_payload)
        except Exception as exc:
            heuristic = self._heuristic_analysis(ticker, signal_payload)
            heuristic["risk_flags"].append(f"Claude call failed; fallback analysis used ({exc.__class__.__name__}).")
            return heuristic

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
        }


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
