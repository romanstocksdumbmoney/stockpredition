import type { AnalysisResult, TickerQuote } from "../lib/types";
import { QuoteAsOfIndicator } from "./QuoteAsOfIndicator";
import { PriceChart } from "./PriceChart";

type Props = {
  analysis: AnalysisResult;
  quote?: TickerQuote;
  quoteStatus: "idle" | "ok" | "error";
  quotePulse: number;
  isWatched: boolean;
  watchUpdating: boolean;
  onAddToWatchlist: (symbol: string) => Promise<void>;
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

function formatLargeNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return value.toFixed(0);
}

function formatDecimal(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatSignedPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function fallbackScenarios(analysis: AnalysisResult): { bull_trigger: string; bear_trigger: string; invalidation: string } {
  const support = analysis.chart.support_levels?.[0];
  const resistance = analysis.chart.resistance_levels?.[0];
  if (support !== undefined && resistance !== undefined) {
    return {
      bull_trigger: `Break above ${resistance.toFixed(2)} with confirmation volume supports continuation.`,
      bear_trigger: `Loss of ${support.toFixed(2)} shifts momentum toward downside follow-through.`,
      invalidation: `Current lean is invalid if price breaks outside ${support.toFixed(2)}-${resistance.toFixed(2)}.`,
    };
  }
  return {
    bull_trigger: "Upside confirmation requires breakout with stronger volume.",
    bear_trigger: "Downside confirmation requires support failure with momentum expansion.",
    invalidation: "Current lean is invalid if price action and momentum materially diverge from this setup.",
  };
}

function relativeDate(value: string | null | undefined): string {
  if (!value) return "date unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "date unknown";
  const deltaMs = Date.now() - parsed.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (deltaMs < hour) return `${Math.max(1, Math.floor(deltaMs / minute))}m ago`;
  if (deltaMs < day) return `${Math.floor(deltaMs / hour)}h ago`;
  return `${Math.floor(deltaMs / day)}d ago`;
}

function vixClass(bucket: string | null | undefined): string {
  if (bucket === "calm") return "text-bull";
  if (bucket === "elevated") return "text-warn";
  if (bucket === "stressed") return "text-bear";
  return "text-textMuted";
}

export function AnalysisView({ analysis, quote, quoteStatus, quotePulse, isWatched, watchUpdating, onAddToWatchlist }: Props) {
  const flowData = analysis.flow_data ?? {};
  const flowAvailable = flowData.available === true;
  const fallbackPrice = Number(analysis.market_context?.last_price ?? 0);
  const fallbackChange = Number(analysis.market_context?.day_change_pct ?? 0);
  const lastPrice = quote?.price ?? fallbackPrice;
  const dayChangeRaw = quote?.change_pct ?? fallbackChange;
  const dayChange = Number.isFinite(dayChangeRaw) ? dayChangeRaw : 0;
  const marketState = quote?.market_state;
  const contextPack = analysis.context_pack ?? {};
  const fundamentals = contextPack.fundamentals ?? {};
  const catalysts = contextPack.catalysts ?? {};
  const marketRegime = contextPack.market_regime ?? {};
  const scenarios = analysis.scenarios ?? fallbackScenarios(analysis);
  const contextFactors = analysis.context_factors ?? [];
  const daysToEarnings =
    typeof catalysts.days_to_earnings === "number" ? catalysts.days_to_earnings : null;
  const nextEarningsDate = catalysts.next_earnings_date ? new Date(catalysts.next_earnings_date) : null;
  const recentNews = catalysts.recent_news ?? [];
  const vix = marketRegime.vix ?? null;
  const spy = marketRegime.spy ?? null;
  const sectorEtf = marketRegime.sector_etf ?? null;
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
              {analysis.earnings_warning && daysToEarnings !== null && daysToEarnings <= 7 && (
                <span className="rounded-full border border-warn px-3 py-1 text-xs text-warn">
                  ⚠ EARNINGS IN {daysToEarnings} DAYS
                </span>
              )}
              {daysToEarnings !== null &&
                daysToEarnings >= 8 &&
                daysToEarnings <= 21 && (
                  <span className="rounded-full border border-hairline px-3 py-1 text-xs text-textMuted">
                    Earnings {nextEarningsDate ? nextEarningsDate.toLocaleDateString() : "soon"}
                  </span>
                )}
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end">
            <span className={`mono-numeric rounded-full border px-3 py-1 text-xs uppercase tracking-[0.16em] ${verdictColor}`}>
              {verdictLabel} · {analysis.confidence_pct}%
            </span>
            {!isWatched && (
              <button
                type="button"
                disabled={watchUpdating}
                onClick={() => onAddToWatchlist(analysis.ticker)}
                className="rounded-full border border-hairline px-3 py-1 text-xs text-textSecondary transition-colors duration-150 hover:border-bull hover:text-bull disabled:cursor-not-allowed disabled:opacity-50"
              >
                + Watch
              </button>
            )}
            {analysis.reasoning_source === "claude" ? (
              <span className="rounded-full border border-bull px-3 py-1 text-xs text-bull">Claude reasoning</span>
            ) : (
              <span className="rounded-full border border-warn px-3 py-1 text-xs text-warn">Fallback — AI unavailable</span>
            )}
          </div>
        </div>
        <p className="mt-4 text-sm text-textSecondary">{analysis.summary}</p>
      </div>

      <div className="terminal-panel rounded-md px-4 py-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <div>
            <p className="terminal-label">MKT CAP</p>
            <p className="mono-numeric mt-1 text-sm text-textPrimary">{formatLargeNumber(fundamentals.market_cap)}</p>
          </div>
          <div>
            <p className="terminal-label">FWD P/E</p>
            <p className="mono-numeric mt-1 text-sm text-textPrimary">{formatDecimal(fundamentals.pe_forward, 1)}</p>
          </div>
          <div>
            <p className="terminal-label">REV GROWTH</p>
            <p className="mono-numeric mt-1 text-sm text-textPrimary">{formatPercent(fundamentals.revenue_growth_yoy)}</p>
          </div>
          <div>
            <p className="terminal-label">MARGIN</p>
            <p className="mono-numeric mt-1 text-sm text-textPrimary">{formatPercent(fundamentals.profit_margin)}</p>
          </div>
          <div>
            <p className="terminal-label">SHORT %</p>
            <p className="mono-numeric mt-1 text-sm text-textPrimary">{formatPercent(fundamentals.short_percent_float)}</p>
          </div>
          <div>
            <p className="terminal-label">BETA</p>
            <p className="mono-numeric mt-1 text-sm text-textPrimary">{formatDecimal(fundamentals.beta, 2)}</p>
          </div>
        </div>
      </div>

      <div className="terminal-panel rounded-md px-4 py-3 text-sm text-textSecondary">
        <p>
          {spy?.trend ? (
            <>
              SPY <span className={spy.trend === "above" ? "text-bull" : "text-bear"}>{spy.trend}</span> trend
            </>
          ) : (
            <>SPY trend unavailable</>
          )}
          {" · "}
          {typeof vix?.last_close === "number" ? (
            <>
              VIX {vix.last_close.toFixed(1)}{" "}
              <span className={vixClass(vix.bucket ?? null)}>{vix.bucket ?? "unknown"}</span>
            </>
          ) : (
            <>VIX unavailable</>
          )}
          {" · "}
          {sectorEtf?.symbol && typeof sectorEtf.performance_1mo_pct === "number" ? (
            <span className={sectorEtf.performance_1mo_pct >= 0 ? "text-bull" : "text-bear"}>
              {sectorEtf.symbol} {formatSignedPercent(sectorEtf.performance_1mo_pct)} (1mo)
            </span>
          ) : (
            <>Sector ETF unavailable</>
          )}
        </p>
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
        {contextFactors.length > 0 && (
          <>
            <p className="terminal-label mb-2 mt-4">Context factors</p>
            <div className="flex flex-wrap gap-2">
              {contextFactors.map((factor, idx) => (
                <span
                  key={`context-${idx}`}
                  className="rounded-full border border-hairline bg-inset px-3 py-1 text-xs text-textSecondary"
                >
                  {factor}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="terminal-panel rounded-md p-4">
        <p className="terminal-label mb-3">Scenarios</p>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="mt-1 h-2.5 w-2.5 rounded-full bg-bull" aria-hidden />
            <p className="text-sm text-textSecondary">{scenarios.bull_trigger}</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="mt-1 h-2.5 w-2.5 rounded-full bg-bear" aria-hidden />
            <p className="text-sm text-textSecondary">{scenarios.bear_trigger}</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="mt-1 h-2.5 w-2.5 rounded-full bg-warn" aria-hidden />
            <p className="text-sm text-textSecondary">{scenarios.invalidation}</p>
          </div>
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

      {recentNews.length > 0 && (
        <details className="terminal-panel rounded-md p-4">
          <summary className="terminal-label cursor-pointer select-none">Recent headlines</summary>
          <ul className="mt-3 space-y-3">
            {recentNews.map((item, idx) => (
              <li key={`headline-${idx}`} className="border-b border-hairline/60 pb-2 last:border-none last:pb-0">
                <a
                  className="text-sm text-textPrimary transition-colors duration-150 hover:text-bull"
                  href={item.url ?? `https://finance.yahoo.com/quote/${analysis.ticker}/news`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.title}
                </a>
                <p className="mt-1 text-xs text-textMuted">
                  {item.publisher ?? "Unknown publisher"} · {relativeDate(item.published_at)}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
