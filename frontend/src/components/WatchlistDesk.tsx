import { useMemo } from "react";

import type { AnalysisResult, HistoryItem, TickerQuote } from "../lib/types";
import { QuoteAsOfIndicator } from "./QuoteAsOfIndicator";

type Outcome = "right" | "wrong" | "mixed";

type Props = {
  items: HistoryItem[];
  onOpenAnalysis: (analysis: AnalysisResult) => void;
  onMarkOutcome: (id: number, outcome: Outcome) => Promise<void>;
  busyId: number | null;
  quoteBySymbol: Record<string, TickerQuote | undefined>;
  quoteStatusBySymbol: Record<string, "idle" | "ok" | "error">;
  quotePulseBySymbol: Record<string, number>;
};

const outcomes: Outcome[] = ["right", "wrong", "mixed"];

function verdictClass(direction: string): string {
  if (direction === "bullish") return "text-bull";
  if (direction === "bearish") return "text-bear";
  return "text-textSecondary";
}

function railClass(direction: string): string {
  if (direction === "bullish") return "bg-bull";
  if (direction === "bearish") return "bg-bear";
  return "bg-textMuted";
}

function outcomeClass(outcome: Outcome): string {
  if (outcome === "right") return "border-bull text-bull";
  if (outcome === "wrong") return "border-bear text-bear";
  return "border-hairline text-textSecondary";
}

export function WatchlistDesk({
  items,
  onOpenAnalysis,
  onMarkOutcome,
  busyId,
  quoteBySymbol,
  quoteStatusBySymbol,
  quotePulseBySymbol,
}: Props) {
  const latestByTicker = useMemo(() => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = item.ticker.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [items]);

  const freshest = latestByTicker[0];

  if (!latestByTicker.length) {
    return (
      <div className="terminal-panel rounded-md p-4 text-sm text-textSecondary">
        Run your first analysis to populate the Flow Desk watchlist.
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="terminal-panel overflow-x-auto rounded-md">
        <table className="min-w-[980px] w-full border-collapse">
          <thead>
            <tr className="border-b border-hairline">
              <th className="terminal-label px-4 py-3 text-left">Ticker</th>
              <th className="terminal-label px-4 py-3 text-left">Verdict</th>
              <th className="terminal-label px-4 py-3 text-left">Conf</th>
              <th className="terminal-label px-4 py-3 text-left">Key risk</th>
              <th className="terminal-label px-4 py-3 text-left">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {latestByTicker.map((item) => {
              const direction = item.result.confidence_direction;
              const confidence = Math.max(0, Math.min(100, item.result.confidence_pct));
              const symbol = item.ticker.toUpperCase();
              const quote = quoteBySymbol[symbol];
              const quoteStatus = quoteStatusBySymbol[symbol] ?? "idle";
              const quotePulse = quotePulseBySymbol[symbol] ?? 0;
              const fallbackPrice = Number(item.result.market_context?.last_price ?? 0);
              const fallbackChange = Number(item.result.market_context?.day_change_pct ?? 0);
              const livePrice = quote?.price ?? fallbackPrice;
              const liveChangeRaw = quote?.change_pct ?? fallbackChange;
              const liveChange = Number.isFinite(liveChangeRaw) ? liveChangeRaw : 0;
              return (
                <tr
                  key={item.id}
                  className="cursor-pointer border-b border-hairline/70 transition-colors duration-150 hover:bg-inset"
                  onClick={() => onOpenAnalysis(item.result)}
                >
                  <td className="px-4 py-3 align-top">
                    <p className="mono-numeric text-sm text-textPrimary">${item.ticker}</p>
                    <p className="text-xs text-textMuted">{new Date(item.created_at).toLocaleDateString()}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <p className={`mono-numeric text-xs ${liveChange >= 0 ? "text-bull" : "text-bear"}`}>
                        {livePrice ? `${livePrice.toFixed(2)} · ${liveChange >= 0 ? "+" : ""}${liveChange.toFixed(2)}%` : "—"}
                      </p>
                      {quote?.market_state === "closed" && (
                        <span className="rounded-full border border-hairline px-1.5 py-0.5 text-[10px] tracking-[0.14em] text-textMuted">
                          MARKET CLOSED
                        </span>
                      )}
                    </div>
                    <div className="mt-1">
                      <QuoteAsOfIndicator asOf={quote?.as_of} status={quoteStatus} pulse={quotePulse} />
                    </div>
                  </td>
                  <td className={`px-4 py-3 align-top mono-numeric text-sm ${verdictClass(direction)}`}>
                    {direction.toUpperCase()}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="mb-2 h-1.5 w-44 rounded-full bg-inset">
                      <div className={`h-1.5 rounded-full ${railClass(direction)}`} style={{ width: `${confidence}%` }} />
                    </div>
                    <p className={`mono-numeric text-xs ${verdictClass(direction)}`}>{confidence}%</p>
                  </td>
                  <td className="px-4 py-3 align-top text-sm text-warn">{item.result.risk_flags[0] ?? "No immediate risk flag"}</td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
                      {outcomes.map((outcome) => (
                        <button
                          key={`${item.id}-${outcome}`}
                          disabled={busyId === item.id}
                          onClick={() => onMarkOutcome(item.id, outcome)}
                          className={`rounded-full border px-2.5 py-1 text-xs capitalize transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${outcomeClass(
                            outcome
                          )}`}
                        >
                          {outcome}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {freshest && (
        <div className="rounded-md border border-bull bg-bullTint px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-bull" aria-hidden />
            <p className="text-sm text-textSecondary">
              {freshest.ticker}: {freshest.result.summary}{" "}
              <button
                className="mono-numeric text-bull transition-opacity duration-150 hover:opacity-80"
                onClick={() => onOpenAnalysis(freshest.result)}
              >
                Full breakdown →
              </button>
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
