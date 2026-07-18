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
5) Cite at least one support level and, when available, at least one resistance level from payload.patterns.
6) Scenario levels in scenarios.bull_trigger / bear_trigger / invalidation must come from payload.patterns support/resistance values.
7) If payload.context_pack.catalysts.days_to_earnings <= 7, explicitly mention earnings proximity as a major risk regardless of technicals.
8) Reference fundamentals when they reinforce OR conflict with technicals.
9) Reference market regime explicitly (SPY trend + VIX bucket). In stressed/below-trend regimes, discount bullish conviction.
10) News titles can be cited as catalysts, but do not invent details beyond the provided titles.
11) Return context_factors as 2-4 concise non-chart drivers.
12) Be conservative with confidence due to uncertainty. Never return confidence above 94.
13) If data is thin/conflicting, say so in risk_flags and keep confidence moderate.
14) Do not include markdown. Return strict JSON that matches the required schema.
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
            last_exc: Exception | None = None
            for attempt in range(4):
                try:
                    user_prompt = self._build_user_prompt(
                        ticker=ticker, signal_payload=signal_payload, strict=attempt > 0
                    )
                    response = client.messages.create(
                        model=self.model,
                        system=SYSTEM_PROMPT,
                        max_tokens=1200,
                        messages=[{"role": "user", "content": user_prompt}],
                    )
                    text = self._extract_response_text(response.content)
                    parsed = self._load_json(text)
                    normalized = self._normalize_output(parsed, ticker, signal_payload)
                    if self._has_required_numeric_references(normalized, signal_payload):
                        normalized["reasoning_source"] = "claude"
                        return normalized
                    last_exc = ValueError("Claude response missing required numeric citations.")
                    logger.warning(
                        "Claude response missing required numeric citations for %s (attempt %s).", ticker, attempt + 1
                    )
                except Exception as exc:  # pragma: no cover - network/model variability
                    last_exc = exc
                    logger.warning("Claude response parse/validation failed for %s (attempt %s): %s", ticker, attempt + 1, exc)

            raise last_exc or ValueError("Claude response did not include required RSI/support/resistance numeric citations.")
        except Exception as exc:
            logger.exception("Claude reasoning failed for %s: %s", ticker, exc)
            heuristic = self._heuristic_analysis(ticker, signal_payload)
            heuristic["risk_flags"].append(f"Claude call failed; fallback analysis used ({exc.__class__.__name__}: {exc}).")
            return heuristic

    @staticmethod
    def _build_user_prompt(ticker: str, signal_payload: dict[str, Any], strict: bool) -> str:
        compact_payload = {
            "indicators": signal_payload.get("indicators"),
            "patterns": signal_payload.get("patterns"),
            "flow_data": signal_payload.get("flow_data"),
            "context_pack": signal_payload.get("context_pack"),
            "market_context": signal_payload.get("market_context"),
            "key_stats": signal_payload.get("key_stats"),
            "ohlcv_tail": (signal_payload.get("ohlcv") or [])[-5:],
        }
        compact_payload = TradeAnalyzer._compact_payload(compact_payload)
        strict_clause = ""
        if strict:
            strict_clause = (
                "\n\nHARD REQUIREMENT: Every bullet in both bull_case and bear_case must quote a payload number. "
                "At least one bullet must quote RSI exactly, and at least one bullish/bearish bullet must quote concrete "
                "support prices from payload.patterns (and resistance prices when provided in payload.patterns). "
                "All scenario levels must come from payload.patterns support_levels/resistance_levels. "
                "If days_to_earnings <= 7 you MUST mark earnings_warning=true and cite earnings timing as major risk."
            )

        return (
            "Analyze this market snapshot and output JSON only.\n\n"
            f"Ticker: {ticker}\n"
            f"Payload:\n{json.dumps(compact_payload, default=str)}\n\n"
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
            '  "risk_flags": ["flag 1", "flag 2"],\n'
            '  "scenarios": {\n'
            '    "bull_trigger": "specific if/then upside trigger using payload levels",\n'
            '    "bear_trigger": "specific if/then downside trigger using payload levels",\n'
            '    "invalidation": "the condition/level that invalidates current lean"\n'
            "  },\n"
            '  "context_factors": ["factor 1", "factor 2"],\n'
            '  "earnings_warning": false\n'
            "}\n"
            f"{strict_clause}\n"
        )

    @staticmethod
    def _compact_payload(value: Any) -> Any:
        if isinstance(value, dict):
            compact = {}
            for key, item in value.items():
                nested = TradeAnalyzer._compact_payload(item)
                if nested is None:
                    continue
                if nested == {} or nested == []:
                    continue
                compact[key] = nested
            return compact
        if isinstance(value, list):
            compact_list = [TradeAnalyzer._compact_payload(item) for item in value]
            compact_list = [item for item in compact_list if item not in (None, {}, [])]
            return compact_list
        return value

    @staticmethod
    def _extract_response_text(content_blocks: Any) -> str:
        if not isinstance(content_blocks, list):
            return str(content_blocks or "").strip()

        text_blocks = [str(getattr(block, "text", "")).strip() for block in content_blocks if getattr(block, "text", None)]
        if text_blocks:
            return text_blocks[-1]

        return str(content_blocks).strip()

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

        scenario_values = self._numbers_in_text(" ".join(str(v) for v in (normalized.get("scenarios") or {}).values()))
        level_pool = [float(level) for level in [*support_levels, *resistance_levels] if level is not None]
        has_scenario_level = not level_pool or any(
            any(abs(value - level) <= 0.05 for level in level_pool) for value in scenario_values
        )

        catalysts = (signal_payload.get("context_pack") or {}).get("catalysts") or {}
        days_to_earnings = catalysts.get("days_to_earnings")
        needs_earnings_warning = isinstance(days_to_earnings, int) and days_to_earnings <= 7
        earnings_warning = bool(normalized.get("earnings_warning"))

        return has_rsi and has_support and has_resistance and has_scenario_level and (
            not needs_earnings_warning or earnings_warning
        )

    @staticmethod
    def _load_json(text: str) -> dict[str, Any]:
        cleaned = text.strip()
        if not cleaned:
            raise ValueError("Model returned empty response text.")
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
            cleaned = re.sub(r"```$", "", cleaned).strip()
        try:
            loaded = json.loads(cleaned)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", cleaned, re.DOTALL)
            if not match:
                raise
            loaded = json.loads(match.group(0))
        if not isinstance(loaded, dict):
            raise ValueError("Expected object JSON from model")
        return loaded

    def _normalize_output(self, raw: dict[str, Any], ticker: str, signal_payload: dict[str, Any]) -> dict[str, Any]:
        patterns = signal_payload.get("patterns") or {}
        fallback_scenarios = self._fallback_scenarios(
            patterns=patterns,
            direction_hint=str(raw.get("confidence_direction") or "neutral").lower().strip(),
        )
        fallback_context_factors = self._fallback_context_factors(signal_payload)
        computed_earnings_warning = self._earnings_warning_from_payload(signal_payload)

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

        scenarios_raw = raw.get("scenarios") if isinstance(raw.get("scenarios"), dict) else {}
        scenarios = {
            "bull_trigger": str(scenarios_raw.get("bull_trigger") or fallback_scenarios["bull_trigger"]).strip(),
            "bear_trigger": str(scenarios_raw.get("bear_trigger") or fallback_scenarios["bear_trigger"]).strip(),
            "invalidation": str(scenarios_raw.get("invalidation") or fallback_scenarios["invalidation"]).strip(),
        }
        if not self._scenario_references_known_levels(scenarios, patterns):
            scenarios = fallback_scenarios

        raw_context_factors = [str(item).strip() for item in (raw.get("context_factors") or []) if str(item).strip()]
        context_factors: list[str] = []
        for factor in [*raw_context_factors, *fallback_context_factors]:
            if factor and factor not in context_factors:
                context_factors.append(factor)
        if len(context_factors) < 2:
            context_factors.extend(
                [
                    "Flow and macro context are mixed; position sizing should stay conservative.",
                    "Signal quality is constrained by noisy short-term data.",
                ][: 2 - len(context_factors)]
            )
        context_factors = context_factors[:4]

        raw_earnings_warning = raw.get("earnings_warning")
        earnings_warning = (
            raw_earnings_warning if isinstance(raw_earnings_warning, bool) else computed_earnings_warning
        ) or computed_earnings_warning

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
            "scenarios": scenarios,
            "context_factors": context_factors,
            "earnings_warning": earnings_warning,
            "reasoning_source": "claude",
        }

    @staticmethod
    def _fallback_pattern_summary(patterns: dict[str, Any]) -> str:
        trend = patterns.get("trend_direction", "unknown")
        flags = patterns.get("flags") or []
        if flags:
            return f"Trend: {trend}. Notable chart flags: {', '.join(str(flag) for flag in flags[:3])}."
        return f"Trend: {trend}. No strong breakout/breakdown flag detected."

    @staticmethod
    def _earnings_warning_from_payload(signal_payload: dict[str, Any]) -> bool:
        context_pack = signal_payload.get("context_pack") or {}
        catalysts = context_pack.get("catalysts") or {}
        days_to_earnings = catalysts.get("days_to_earnings")
        return isinstance(days_to_earnings, int) and days_to_earnings <= 7

    @staticmethod
    def _scenario_references_known_levels(scenarios: dict[str, str], patterns: dict[str, Any]) -> bool:
        levels = [float(level) for level in [*(patterns.get("support_levels") or []), *(patterns.get("resistance_levels") or [])] if level is not None]
        if not levels:
            return True
        text = " ".join(str(value) for value in scenarios.values())
        numbers = [float(token) for token in re.findall(r"-?\d+(?:\.\d+)?", text)]
        return any(any(abs(value - level) <= 0.05 for level in levels) for value in numbers)

    @staticmethod
    def _fallback_scenarios(patterns: dict[str, Any], direction_hint: str) -> dict[str, str]:
        support_levels = [float(level) for level in (patterns.get("support_levels") or []) if level is not None]
        resistance_levels = [float(level) for level in (patterns.get("resistance_levels") or []) if level is not None]
        nearest_support = support_levels[0] if support_levels else None
        nearest_resistance = resistance_levels[0] if resistance_levels else None
        second_resistance = resistance_levels[1] if len(resistance_levels) > 1 else None
        second_support = support_levels[1] if len(support_levels) > 1 else None

        if nearest_resistance is not None:
            bull_target = f"{second_resistance:.2f}" if second_resistance is not None else "higher resistance"
            bull_trigger = (
                f"If price breaks above {nearest_resistance:.2f} on volume above its 20-day average, "
                f"upside can extend toward {bull_target}."
            )
        elif nearest_support is not None:
            bull_trigger = (
                f"If price holds above support {nearest_support:.2f} and buying pressure improves, "
                "the trend can continue to new highs."
            )
        else:
            bull_trigger = "If buyers reclaim momentum and volume confirms, upside continuation remains possible."

        if nearest_support is not None:
            bear_target = f"{second_support:.2f}" if second_support is not None else "lower support"
            bear_trigger = (
                f"If price loses support at {nearest_support:.2f}, downside can accelerate toward {bear_target}."
            )
        elif nearest_resistance is not None:
            bear_trigger = (
                f"If price fails to hold above {nearest_resistance:.2f} after a test, a pullback scenario strengthens."
            )
        else:
            bear_trigger = "If momentum deteriorates and buyers fail to defend dips, downside risk increases."

        if direction_hint == "bullish" and nearest_support is not None:
            invalidation = f"Current bullish lean is invalid if price closes below support {nearest_support:.2f}."
        elif direction_hint == "bearish" and nearest_resistance is not None:
            invalidation = f"Current bearish lean is invalid if price reclaims resistance {nearest_resistance:.2f}."
        elif nearest_support is not None and nearest_resistance is not None:
            invalidation = (
                f"Current lean is invalid if price breaks outside the {nearest_support:.2f} to "
                f"{nearest_resistance:.2f} decision zone."
            )
        else:
            invalidation = "Current lean is invalid if momentum flips and confirmation volume contradicts this setup."

        return {
            "bull_trigger": bull_trigger,
            "bear_trigger": bear_trigger,
            "invalidation": invalidation,
        }

    @staticmethod
    def _fallback_context_factors(signal_payload: dict[str, Any]) -> list[str]:
        context_pack = signal_payload.get("context_pack") or {}
        fundamentals = context_pack.get("fundamentals") or {}
        catalysts = context_pack.get("catalysts") or {}
        regime = context_pack.get("market_regime") or {}
        factors: list[str] = []

        days_to_earnings = catalysts.get("days_to_earnings")
        if isinstance(days_to_earnings, int):
            if days_to_earnings <= 7:
                factors.append(f"Earnings in {days_to_earnings} day(s) elevates event risk materially.")
            elif days_to_earnings <= 21:
                factors.append(f"Earnings in {days_to_earnings} day(s) can cap conviction.")

        forward_pe = fundamentals.get("pe_forward")
        revenue_growth = fundamentals.get("revenue_growth_yoy")
        profit_margin = fundamentals.get("profit_margin")
        short_float = fundamentals.get("short_percent_float")
        if isinstance(forward_pe, (int, float)):
            if forward_pe >= 30:
                factors.append(f"Forward P/E near {forward_pe:.1f} implies rich valuation sensitivity.")
            elif forward_pe <= 15:
                factors.append(f"Forward P/E near {forward_pe:.1f} suggests less demanding valuation.")
        if isinstance(revenue_growth, (int, float)):
            factors.append(f"Revenue growth YoY is {revenue_growth * 100:.1f}%.")
        if isinstance(profit_margin, (int, float)):
            factors.append(f"Profit margin is {profit_margin * 100:.1f}%.")
        if isinstance(short_float, (int, float)) and short_float >= 0.08:
            factors.append(f"Short interest near {short_float * 100:.1f}% of float can amplify volatility.")

        spy = regime.get("spy") or {}
        vix = regime.get("vix") or {}
        sector_etf = regime.get("sector_etf") or {}
        if spy.get("trend"):
            factors.append(f"SPY sits {spy['trend']} its 50-day EMA regime filter.")
        if vix.get("bucket") and isinstance(vix.get("last_close"), (int, float)):
            factors.append(f"VIX is {vix['last_close']:.1f} ({vix['bucket']}) for broader risk tone.")
        if sector_etf.get("symbol") and isinstance(sector_etf.get("performance_1mo_pct"), (int, float)):
            factors.append(
                f"{sector_etf['symbol']} is {sector_etf['performance_1mo_pct']:+.1f}% over 1 month."
            )

        recent_news = catalysts.get("recent_news") or []
        if isinstance(recent_news, list) and recent_news:
            title = str(recent_news[0].get("title") or "").strip()
            if title:
                factors.append(f"Recent headline catalyst: {title[:120]}.")

        deduped: list[str] = []
        for factor in factors:
            if factor and factor not in deduped:
                deduped.append(factor)
        return deduped[:4]

    def _heuristic_analysis(self, ticker: str, signal_payload: dict[str, Any]) -> dict[str, Any]:
        indicators = signal_payload.get("indicators", {})
        patterns = signal_payload.get("patterns", {})
        flow = signal_payload.get("flow_data", {})
        context = signal_payload.get("market_context", {})
        context_pack = signal_payload.get("context_pack", {})
        catalysts = context_pack.get("catalysts", {}) or {}
        market_regime = context_pack.get("market_regime", {}) or {}

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

        days_to_earnings = catalysts.get("days_to_earnings")
        earnings_warning = isinstance(days_to_earnings, int) and days_to_earnings <= 7
        if earnings_warning:
            bear_score += 1
            risk_flags.append(f"Earnings are in {days_to_earnings} day(s), which can overwhelm technical setups.")

        vix_bucket = ((market_regime.get("vix") or {}).get("bucket") or "").lower()
        spy_trend = ((market_regime.get("spy") or {}).get("trend") or "").lower()
        if vix_bucket == "stressed" or spy_trend == "below":
            bear_score += 1
            risk_flags.append("Market regime is risk-off (VIX stressed and/or SPY below trend).")

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
        scenarios = self._fallback_scenarios(patterns=patterns, direction_hint=direction)
        context_factors = self._fallback_context_factors(signal_payload)
        if len(context_factors) < 2:
            context_factors.extend(
                [
                    "Macro and event risk remain significant drivers of outcome variance.",
                    "Signal confidence depends on confirmation at nearby technical levels.",
                ][: 2 - len(context_factors)]
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
            "scenarios": scenarios,
            "context_factors": context_factors[:4],
            "earnings_warning": earnings_warning,
            "reasoning_source": "fallback",
        }


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
