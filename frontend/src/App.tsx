import { useEffect, useMemo, useState } from "react";

import { AnalysisView } from "./components/AnalysisView";
import { HistoryTab } from "./components/HistoryTab";
import { SearchBar } from "./components/SearchBar";
import { TerminalBrand } from "./components/TerminalBrand";
import { WatchlistDesk } from "./components/WatchlistDesk";
import { analyze, getHistory, getTickerQuote, markOutcome } from "./lib/api";
import type { AnalysisResult, HistoryItem, TickerQuote } from "./lib/types";

type Tab = "analyze" | "watchlist" | "history";
type QuoteStatus = "idle" | "ok" | "error";

const QUOTE_POLL_MS = 20_000;
const MIN_QUOTE_POLL_MS = 10_000;
const CLOSED_MARKET_POLL_MS = 5 * 60_000;
const EFFECTIVE_QUOTE_POLL_MS = Math.max(QUOTE_POLL_MS, MIN_QUOTE_POLL_MS);

function landingStats(history: HistoryItem[]) {
  const latest = history[0]?.result;
  const marked = history.filter((item) => item.outcome !== null);
  const right = marked.filter((item) => item.outcome === "right");
  return {
    latestLabel: latest ? `${latest.confidence_direction.toUpperCase()} ${latest.confidence_pct}%` : "N/A",
    total: history.length,
    rightPct: marked.length ? `${Math.round((right.length / marked.length) * 100)}%` : "N/A"
  };
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("analyze");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyBusyId, setHistoryBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quoteBySymbol, setQuoteBySymbol] = useState<Record<string, TickerQuote | undefined>>({});
  const [quoteStatusBySymbol, setQuoteStatusBySymbol] = useState<Record<string, QuoteStatus>>({});
  const [quotePulseBySymbol, setQuotePulseBySymbol] = useState<Record<string, number>>({});
  const [isPageVisible, setIsPageVisible] = useState<boolean>(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible"
  );

  async function refreshHistory() {
    const rows = await getHistory();
    setHistory(rows);
  }

  useEffect(() => {
    refreshHistory().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load history.");
    });
  }, []);

  useEffect(() => {
    const onVisibility = () => setIsPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  async function onAnalyze(query: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await analyze(query);
      setAnalysis(result);
      await refreshHistory();
      setActiveTab("analyze");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  async function onMarkOutcome(id: number, outcome: "right" | "wrong" | "mixed") {
    setHistoryBusyId(id);
    setError(null);
    try {
      await markOutcome(id, outcome);
      await refreshHistory();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save outcome.");
    } finally {
      setHistoryBusyId(null);
    }
  }

  const disclaimer = useMemo(
    () =>
      analysis?.disclaimer ??
      "TradeBot weighs signals but doesn't predict the future. This is not financial advice.",
    [analysis]
  );
  const stats = useMemo(() => landingStats(history), [history]);
  const watchlistSymbols = useMemo(() => {
    const seen = new Set<string>();
    const symbols: string[] = [];
    for (const item of history) {
      const symbol = item.ticker.toUpperCase();
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      symbols.push(symbol);
    }
    return symbols;
  }, [history]);

  const visibleSymbols = useMemo(() => {
    if (!isPageVisible) return [];
    if (activeTab === "analyze" && analysis) return [analysis.ticker.toUpperCase()];
    if (activeTab === "watchlist") return watchlistSymbols;
    return [];
  }, [activeTab, analysis, isPageVisible, watchlistSymbols]);
  const visibleSymbolsKey = useMemo(() => visibleSymbols.join(","), [visibleSymbols]);
  const allVisibleClosed = useMemo(
    () =>
      visibleSymbols.length > 0 &&
      visibleSymbols.every((symbol) => quoteBySymbol[symbol]?.market_state === "closed"),
    [visibleSymbols, quoteBySymbol]
  );
  const quotePollDelay = allVisibleClosed ? CLOSED_MARKET_POLL_MS : EFFECTIVE_QUOTE_POLL_MS;

  useEffect(() => {
    if (!visibleSymbolsKey || !isPageVisible) return;

    const symbols = visibleSymbolsKey.split(",").filter(Boolean);
    if (!symbols.length) return;

    let cancelled = false;
    let timerId: number | undefined;

    const updateQuotes = async () => {
      await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const quote = await getTickerQuote(symbol);
            if (cancelled) return;
            setQuoteBySymbol((prev) => ({ ...prev, [symbol]: quote }));
            setQuoteStatusBySymbol((prev) => ({ ...prev, [symbol]: "ok" }));
            setQuotePulseBySymbol((prev) => ({ ...prev, [symbol]: (prev[symbol] ?? 0) + 1 }));
          } catch {
            if (cancelled) return;
            setQuoteStatusBySymbol((prev) => ({ ...prev, [symbol]: "error" }));
          }
        })
      );

      if (cancelled) return;
      timerId = window.setTimeout(updateQuotes, quotePollDelay);
    };

    updateQuotes();
    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [visibleSymbolsKey, isPageVisible, quotePollDelay]);

  const linkClass = (tab: Tab) =>
    `mono-numeric text-sm transition-colors duration-150 ${activeTab === tab ? "text-bull" : "text-textMuted hover:text-textSecondary"}`;

  return (
    <div className="min-h-screen bg-page text-textPrimary">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 pb-24 md:px-6">
        <header className="terminal-panel rounded-md px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TerminalBrand compact />
            <nav className="flex items-center gap-5">
              <button onClick={() => setActiveTab("analyze")} className={linkClass("analyze")}>
                Analyze
              </button>
              <button onClick={() => setActiveTab("watchlist")} className={linkClass("watchlist")}>
                Watchlist
              </button>
              <button onClick={() => setActiveTab("history")} className={linkClass("history")}>
                History
              </button>
            </nav>
          </div>
        </header>

        {error && (
          <div className="rounded-md border border-bear px-4 py-3 text-sm text-bear">
            <strong>Error:</strong> {error}
          </div>
        )}

        {activeTab === "analyze" && !analysis && (
          <section className="mx-auto flex w-full max-w-4xl flex-col items-center justify-center gap-8 py-10 text-center">
            <TerminalBrand />
            <p className="text-sm text-textSecondary">Both sides of every trade. Weighed, scored, cited.</p>
            <SearchBar onSubmit={onAnalyze} loading={loading} centered />

            <div className="terminal-panel mt-2 w-full rounded-md">
              <div className="grid grid-cols-1 divide-y divide-hairline md:grid-cols-3 md:divide-x md:divide-y-0">
                <div className="px-4 py-3">
                  <p className="terminal-label">Last verdict %</p>
                  <p className="mono-numeric mt-1 text-lg text-textPrimary">{stats.latestLabel}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="terminal-label">Total analyses run</p>
                  <p className="mono-numeric mt-1 text-lg text-textPrimary">{stats.total}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="terminal-label">% calls marked right</p>
                  <p className="mono-numeric mt-1 text-lg text-textPrimary">{stats.rightPct}</p>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "analyze" && analysis && (
          <section className="space-y-4">
            <SearchBar onSubmit={onAnalyze} loading={loading} />
            <AnalysisView
              analysis={analysis}
              quote={quoteBySymbol[analysis.ticker.toUpperCase()]}
              quoteStatus={quoteStatusBySymbol[analysis.ticker.toUpperCase()] ?? "idle"}
              quotePulse={quotePulseBySymbol[analysis.ticker.toUpperCase()] ?? 0}
            />
          </section>
        )}

        {activeTab === "watchlist" && (
          <WatchlistDesk
            items={history}
            busyId={historyBusyId}
            onMarkOutcome={onMarkOutcome}
            quoteBySymbol={quoteBySymbol}
            quoteStatusBySymbol={quoteStatusBySymbol}
            quotePulseBySymbol={quotePulseBySymbol}
            onOpenAnalysis={(itemAnalysis) => {
              setAnalysis(itemAnalysis);
              setActiveTab("analyze");
            }}
          />
        )}

        {activeTab === "history" && <HistoryTab items={history} onMarkOutcome={onMarkOutcome} busyId={historyBusyId} />}
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-hairline bg-page px-4 py-3 text-center text-xs text-textMuted">
        {disclaimer} Confidence percentages are scenario weights, not guarantees.
      </footer>
    </div>
  );
}

export default App;
