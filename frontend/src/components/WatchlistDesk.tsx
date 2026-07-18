import { type FormEvent, useMemo, useState } from "react";

import type { AnalysisResult, HistoryItem, TickerQuote, WatchlistItem } from "../lib/types";
import { QuoteAsOfIndicator } from "./QuoteAsOfIndicator";

type Outcome = "right" | "wrong" | "mixed";

type Props = {
  items: HistoryItem[];
  watchlist: WatchlistItem[];
  onOpenAnalysis: (analysis: AnalysisResult) => void;
  onMarkOutcome: (id: number, outcome: Outcome) => Promise<void>;
  onAddWatchlistSymbol: (symbol: string) => Promise<void>;
  onRemoveWatchlistSymbol: (symbol: string) => Promise<void>;
  busyId: number | null;
  watchlistBusySymbol: string | null;
  watchlistUpdating: boolean;
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
  watchlist,
  onOpenAnalysis,
  onMarkOutcome,
  onAddWatchlistSymbol,
  onRemoveWatchlistSymbol,
  busyId,
  watchlistBusySymbol,
  watchlistUpdating,
  quoteBySymbol,
  quoteStatusBySymbol,
  quotePulseBySymbol,
}: Props) {
  const [draftSymbol, setDraftSymbol] = useState("");

  const latestByTicker = useMemo(() => {
    const map: Record<string, HistoryItem | undefined> = {};
    for (const item of items) {
      const symbol = item.ticker.toUpperCase();
      if (!map[symbol]) {
        map[symbol] = item;
      }
    }
    return map;
  }, [items]);

  const rows = useMemo(
    () => watchlist.map((entry) => ({ symbol: entry.symbol.toUpperCase(), latest: latestByTicker[entry.symbol.toUpperCase()] })),
    [watchlist, latestByTicker]
  );

  const freshest = rows.find((row) => row.latest)?.latest;

  async function onAddSubmit(event: FormEvent) {
    event.preventDefault();
    const symbol = draftSymbol.trim().toUpperCase();
    if (!symbol) return;
    await onAddWatchlistSymbol(symbol);
    setDraftSymbol("");
  }

  if (!watchlist.length) {
    return (
      <section className="space-y-4">
        <form className="terminal-panel rounded-md p-3" onSubmit={onAddSubmit}>
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={draftSymbol}
              onChange={(event) => setDraftSymbol(event.target.value)}
              placeholder="Add symbol (e.g. AAPL)"
              className="mono-numeric h-10 flex-1 rounded-md border border-hairline bg-inset px-3 text-sm text-textPrimary placeholder:text-textMuted focus:border-bull focus:outline-none transition-colors duration-150"
            />
            <button
              type="submit"
              disabled={watchlistUpdating}
              className="rounded-md border border-bull px-3 py-2 text-xs text-bull transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              + Add to watchlist
            </button>
          </div>
          <p className="mt-2 text-xs text-textMuted">Watchlist cap: 10 tickers.</p>
        </form>
        <div className="terminal-panel rounded-md p-4 text-sm text-textSecondary">
          Watchlist is empty. Add up to 10 symbols to enable morning scans and Flow Desk tracking.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <form className="terminal-panel rounded-md p-3" onSubmit={onAddSubmit}>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={draftSymbol}
            onChange={(event) => setDraftSymbol(event.target.value)}
            placeholder="Add symbol (e.g. AAPL)"
            className="mono-numeric h-10 flex-1 rounded-md border border-hairline bg-inset px-3 text-sm text-textPrimary placeholder:text-textMuted focus:border-bull focus:outline-none transition-colors duration-150"
          />
          <button
            type="submit"
            disabled={watchlistUpdating}
            className="rounded-md border border-bull px-3 py-2 text-xs text-bull transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            + Add to watchlist
          </button>
        </div>
        <p className="mt-2 text-xs text-textMuted">
          {watchlist.length}/10 watched. Morning scan runs once across all watched symbols.
        </p>
      </form>

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
            {rows.map(({ symbol, latest }) => {
              const direction = latest?.result.confidence_direction ?? "neutral";
              const confidence = Math.max(0, Math.min(100, latest?.result.confidence_pct ?? 0));
              const quote = quoteBySymbol[symbol];
              const quoteStatus = quoteStatusBySymbol[symbol] ?? "idle";
              const quotePulse = quotePulseBySymbol[symbol] ?? 0;
              const fallbackPrice = Number(latest?.result.market_context?.last_price ?? 0);
              const fallbackChange = Number(latest?.result.market_context?.day_change_pct ?? 0);
              const livePrice = quote?.price ?? fallbackPrice;
              const liveChangeRaw = quote?.change_pct ?? fallbackChange;
              const liveChange = Number.isFinite(liveChangeRaw) ? liveChangeRaw : 0;
              return (
                <tr
                  key={symbol}
                  className={`group border-b border-hairline/70 transition-colors duration-150 hover:bg-inset ${
                    latest ? "cursor-pointer" : ""
                  }`}
                  onClick={() => {
                    if (latest) onOpenAnalysis(latest.result);
                  }}
                >
                  <td className="px-4 py-3 align-top">
                    <p className="mono-numeric flex items-center gap-1.5 text-sm text-textPrimary">
                      {latest?.result.earnings_warning && <span className="h-2 w-2 rounded-full bg-warn" aria-hidden />}
                      <span>${symbol}</span>
                      <button
                        type="button"
                        disabled={watchlistBusySymbol === symbol}
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemoveWatchlistSymbol(symbol).catch(() => undefined);
                        }}
                        className="ml-1 rounded px-1 text-xs text-textMuted opacity-0 transition-opacity duration-150 hover:text-bear group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Remove ${symbol} from watchlist`}
                      >
                        ×
                      </button>
                    </p>
                    <p className="text-xs text-textMuted">
                      {latest ? new Date(latest.created_at).toLocaleDateString() : "No analysis yet"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <p className={`mono-numeric text-xs ${liveChange >= 0 ? "text-bull" : "text-bear"} ${latest ? "" : "text-textMuted"}`}>
                        {latest ? (livePrice ? `${livePrice.toFixed(2)} · ${liveChange >= 0 ? "+" : ""}${liveChange.toFixed(2)}%` : "—") : "—"}
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
                    {latest ? direction.toUpperCase() : "—"}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="mb-2 h-1.5 w-44 rounded-full bg-inset">
                      <div className={`h-1.5 rounded-full ${railClass(direction)}`} style={{ width: `${latest ? confidence : 0}%` }} />
                    </div>
                    <p className={`mono-numeric text-xs ${verdictClass(direction)}`}>{latest ? `${confidence}%` : "—"}</p>
                  </td>
                  <td className="px-4 py-3 align-top text-sm text-warn">{latest?.result.risk_flags[0] ?? "No analysis yet"}</td>
                  <td className="px-4 py-3 align-top">
                    {latest ? (
                      <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
                        {outcomes.map((outcome) => (
                          <button
                            key={`${latest.id}-${outcome}`}
                            disabled={busyId === latest.id}
                            onClick={() => onMarkOutcome(latest.id, outcome)}
                            className={`rounded-full border px-2.5 py-1 text-xs capitalize transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${outcomeClass(
                              outcome
                            )}`}
                          >
                            {outcome}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-textMuted">—</span>
                    )}
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
