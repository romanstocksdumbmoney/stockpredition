import { useEffect, useMemo, useState } from "react";

import { AnalysisView } from "./components/AnalysisView";
import { HistoryTab } from "./components/HistoryTab";
import { SearchBar } from "./components/SearchBar";
import { analyze, getHistory, markOutcome } from "./lib/api";
import type { AnalysisResult, HistoryItem } from "./lib/types";

type Tab = "analyze" | "history";

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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 pb-24 md:px-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">TradeBot</h1>
          <p className="max-w-3xl text-sm text-slate-300">
            AI trading copilot that weighs both sides before landing on a confidence-weighted view. It is built for
            decision support, not automated trading.
          </p>
        </header>

        <SearchBar onSubmit={onAnalyze} loading={loading} />

        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("analyze")}
            className={`rounded-md px-3 py-2 text-sm font-medium transition ${
              activeTab === "analyze" ? "bg-accent text-slate-950" : "bg-slate-900 text-slate-300 hover:bg-slate-800"
            }`}
          >
            Analysis
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`rounded-md px-3 py-2 text-sm font-medium transition ${
              activeTab === "history" ? "bg-accent text-slate-950" : "bg-slate-900 text-slate-300 hover:bg-slate-800"
            }`}
          >
            History
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">
            <strong>Error:</strong> {error}
          </div>
        )}

        {activeTab === "analyze" ? (
          analysis ? (
            <AnalysisView analysis={analysis} />
          ) : (
            <div className="rounded-xl border border-slate-700 bg-slate-900 p-6 text-slate-300">
              Enter a ticker prompt above to run your first analysis.
            </div>
          )
        ) : (
          <HistoryTab items={history} onMarkOutcome={onMarkOutcome} busyId={historyBusyId} />
        )}
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-slate-700 bg-slate-950/95 px-4 py-3 text-center text-xs text-slate-300 backdrop-blur">
        {disclaimer} Confidence percentages are scenario weights, not guarantees.
      </footer>
    </div>
  );
}

export default App;
