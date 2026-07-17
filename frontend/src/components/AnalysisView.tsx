import type { AnalysisResult, TickerQuote } from "../lib/types";
import { QuoteAsOfIndicator } from "./QuoteAsOfIndicator";
import { PriceChart } from "./PriceChart";

type Props = {
  analysis: AnalysisResult;
  quote?: TickerQuote;
  quoteStatus: "idle" | "ok" | "error";
  quotePulse: number;
};

function caseColumn(title: string, points: string[], theme: "bull" | "bear") {
  const isBull = theme === "bull";
  return (
    <div
      className={`rounded-md border border-hairline p-4 ${
        isBull ? "bg-bullTint border-l-[3px] border-l-bull" : "bg-bearTint border-l-[3px] border-l-bear"
      }`}
    >
      <h3 className={`mb-3 text-xs uppercase tracking-[0.22em] ${isBull ? "text-bull" : "text-bear"}`}>{title}</h3>
      <ul className={`space-y-2 text-sm ${isBull ? "text-textSecondary" : "text-bearText"}`}>
        {points.map((point, idx) => (
          <li key={`${title}-${idx}`} className="flex gap-2 leading-6">
            <span className={isBull ? "text-bull" : "text-bear"}>•</span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnalysisView({ analysis, quote, quoteStatus, quotePulse }: Props) {
  const flowData = analysis.flow_data ?? {};
  const flowAvailable = flowData.available === true;
  const fallbackPrice = Number(analysis.market_context?.last_price ?? 0);
  const fallbackChange = Number(analysis.market_context?.day_change_pct ?? 0);
  const lastPrice = quote?.price ?? fallbackPrice;
  const dayChangeRaw = quote?.change_pct ?? fallbackChange;
  const dayChange = Number.isFinite(dayChangeRaw) ? dayChangeRaw : 0;
  const marketState = quote?.market_state;
  const verdictColor =
    analysis.confidence_direction === "bullish"
      ? "border-bull text-bull"
      : analysis.confidence_direction === "bearish"
        ? "border-bear text-bear"
        : "border-hairline text-textSecondary";
  const verdictLabel =
    analysis.confidence_direction === "bullish"
      ? "Bullish lean"
      : analysis.confidence_direction === "bearish"
        ? "Bearish lean"
        : "Neutral lean";

  return (
    <section className="space-y-4">
      <div className="terminal-panel rounded-md p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="terminal-label">War room</p>
            <div className="mt-1 flex flex-wrap items-end gap-3">
              <h2 className="mono-numeric text-[28px] font-semibold text-textPrimary">${analysis.ticker}</h2>
              <p className={`mono-numeric text-lg ${dayChange >= 0 ? "text-bull" : "text-bear"}`}>
                {lastPrice ? `${lastPrice.toFixed(2)} · ${dayChange >= 0 ? "+" : ""}${dayChange.toFixed(2)}%` : "—"}
              </p>
              {marketState === "closed" && (
                <span className="rounded-full border border-hairline px-2 py-1 text-[10px] tracking-[0.14em] text-textMuted">
                  MARKET CLOSED
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <QuoteAsOfIndicator asOf={quote?.as_of} status={quoteStatus} pulse={quotePulse} />
              <span className="text-[11px] text-textMuted">Quotes may be delayed up to 15 minutes.</span>
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end">
            <span className={`mono-numeric rounded-full border px-3 py-1 text-xs uppercase tracking-[0.16em] ${verdictColor}`}>
              {verdictLabel} · {analysis.confidence_pct}%
            </span>
            {analysis.reasoning_source === "claude" ? (
              <span className="rounded-full border border-bull px-3 py-1 text-xs text-bull">Claude reasoning</span>
            ) : (
              <span className="rounded-full border border-warn px-3 py-1 text-xs text-warn">Fallback — AI unavailable</span>
            )}
          </div>
        </div>
        <p className="mt-4 text-sm text-textSecondary">{analysis.summary}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {caseColumn("Bull case", analysis.bull_case, "bull")}
        {caseColumn("Bear case", analysis.bear_case, "bear")}
      </div>

      <div className="terminal-panel rounded-md p-3">
        <p className="terminal-label mb-2">Risk flags</p>
        <div className="flex flex-wrap gap-2">
          {analysis.risk_flags.map((flag, idx) => (
            <span key={`risk-${idx}`} className="rounded-full border border-warn px-3 py-1 text-xs text-warn">
              {flag}
            </span>
          ))}
        </div>
      </div>

      <PriceChart
        data={analysis.chart.ohlcv}
        supportLevels={analysis.chart.support_levels}
        resistanceLevels={analysis.chart.resistance_levels}
        priceAtHighs={analysis.patterns?.price_at_highs === true}
      />

      <div className="terminal-panel rounded-md p-4">
        <p className="terminal-label">Pattern summary</p>
        <p className="mt-1 text-sm text-textSecondary">{analysis.pattern_summary}</p>
        {flowAvailable && analysis.key_flow_signal && (
          <>
            <p className="terminal-label mt-4">Options flow</p>
            <p className="mt-1 text-sm text-textSecondary">{analysis.key_flow_signal}</p>
          </>
        )}
        {!flowAvailable && (
          <div className="terminal-inset mt-4 rounded-md px-3 py-2 text-xs text-textMuted">
            Options flow offline — analysis is chart-only.
          </div>
        )}
      </div>
    </section>
  );
}
