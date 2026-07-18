import type { BriefingRecord } from "../lib/types";

type Props = {
  briefing: BriefingRecord | null;
  loading: boolean;
  running: boolean;
  onRunScan: () => Promise<void>;
  onOpenTicker: (symbol: string) => void;
  onDiscussTicker: (symbol: string) => void;
};

function formatBriefingDate(value: string): string {
  const parsed = new Date(`${value}T08:30:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed
    .toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric"
    })
    .toUpperCase();
}

export function BriefingTab({ briefing, loading, running, onRunScan, onOpenTicker, onDiscussTicker }: Props) {
  async function triggerRun() {
    const confirmed = window.confirm(
      "Re-run morning scan? This re-runs analysis on all watched tickers and can consume Claude usage."
    );
    if (!confirmed) return;
    await onRunScan();
  }

  if (loading) {
    return <div className="terminal-panel rounded-md p-4 text-sm text-textSecondary">Loading briefing...</div>;
  }

  if (!briefing) {
    return (
      <div className="terminal-panel rounded-md p-4 text-sm text-textSecondary">
        <p className="text-textPrimary">No briefing yet for today.</p>
        <p className="mt-2">
          TradeBot scans watched tickers every weekday at 8:30 AM America/New_York. You can run it now to generate the
          first briefing.
        </p>
        <button
          type="button"
          onClick={triggerRun}
          disabled={running}
          className="mt-4 rounded-md border border-hairline px-3 py-2 text-xs text-textSecondary transition-colors duration-150 hover:border-bull hover:text-bull disabled:cursor-not-allowed disabled:opacity-50"
        >
          Re-run scan (re-runs analysis on all watched tickers)
        </button>
      </div>
    );
  }

  const actionItems = briefing.briefing.items.filter((item) => item.severity === "action");
  const watchItems = briefing.briefing.items.filter((item) => item.severity === "watch");

  return (
    <section className="space-y-4">
      <div className="terminal-panel rounded-md p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="terminal-label">{formatBriefingDate(briefing.date)} · PRE-MARKET</p>
          <button
            type="button"
            onClick={triggerRun}
            disabled={running}
            className="rounded-md border border-hairline px-3 py-2 text-xs text-textSecondary transition-colors duration-150 hover:border-bull hover:text-bull disabled:cursor-not-allowed disabled:opacity-50"
          >
            Re-run scan (re-runs analysis on all watched tickers)
          </button>
        </div>
        <p className="mt-3 text-xl text-textPrimary">{briefing.briefing.headline}</p>
        <p className="mt-2 text-sm text-textSecondary">{briefing.briefing.market_note}</p>
      </div>

      {actionItems.map((item) => (
        <article key={`action-${item.symbol}`} className="terminal-panel rounded-md border-l-[3px] border-l-warn p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onOpenTicker(item.symbol)}
              className="mono-numeric text-sm text-textPrimary transition-colors duration-150 hover:text-bull"
            >
              ${item.symbol}
            </button>
            <button
              type="button"
              onClick={() => onDiscussTicker(item.symbol)}
              className="text-xs text-textSecondary transition-colors duration-150 hover:text-bull"
            >
              Discuss →
            </button>
          </div>
          <p className="mt-2 text-sm text-textSecondary">{item.note}</p>
        </article>
      ))}

      {watchItems.map((item) => (
        <article key={`watch-${item.symbol}`} className="terminal-panel rounded-md border-l-[3px] border-l-bull p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onOpenTicker(item.symbol)}
              className="mono-numeric text-sm text-textPrimary transition-colors duration-150 hover:text-bull"
            >
              ${item.symbol}
            </button>
            <button
              type="button"
              onClick={() => onDiscussTicker(item.symbol)}
              className="text-xs text-textSecondary transition-colors duration-150 hover:text-bull"
            >
              Discuss →
            </button>
          </div>
          <p className="mt-2 text-sm text-textSecondary">{item.note}</p>
        </article>
      ))}

      {briefing.briefing.quiet_tickers.length > 0 && (
        <div className="terminal-panel rounded-md p-4 text-sm text-textMuted">
          Quiet tickers: {briefing.briefing.quiet_tickers.join(", ")}
        </div>
      )}
    </section>
  );
}
