import { useEffect, useMemo, useState } from "react";

import { AnalysisView } from "./components/AnalysisView";
import { HistoryTab } from "./components/HistoryTab";
import { SearchBar } from "./components/SearchBar";
import { TerminalBrand } from "./components/TerminalBrand";
import { WatchlistDesk } from "./components/WatchlistDesk";
import { analyze, getHistory, markOutcome } from "./lib/api";
import type { AnalysisResult, HistoryItem } from "./lib/types";

type Tab = "analyze" | "watchlist" | "history";

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

  async function refreshHistory() {
    const rows = await getHistory();
    setHistory(rows);
  }

  useEffect(() => {
    refreshHistory().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load history.");
    });
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
            <AnalysisView analysis={analysis} />
          </section>
        )}

        {activeTab === "watchlist" && (
          <WatchlistDesk
            items={history}
            busyId={historyBusyId}
            onMarkOutcome={onMarkOutcome}
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
