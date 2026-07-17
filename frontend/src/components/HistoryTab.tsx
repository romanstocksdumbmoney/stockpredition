import type { HistoryItem } from "../lib/types";

type Outcome = "right" | "wrong" | "mixed";

type Props = {
  items: HistoryItem[];
  onMarkOutcome: (id: number, outcome: Outcome) => Promise<void>;
  busyId: number | null;
};

const outcomeClass: Record<string, string> = {
  right: "border-bull text-bull",
  wrong: "border-bear text-bear",
  mixed: "border-hairline text-textSecondary"
};

const outcomes: Outcome[] = ["right", "wrong", "mixed"];

export function HistoryTab({ items, onMarkOutcome, busyId }: Props) {
  if (!items.length) {
    return (
      <div className="terminal-panel rounded-md p-4 text-sm text-textSecondary">
        No analyses saved yet. Run an analysis to build your personal track record.
      </div>
    );
  }

  return (
    <div className="terminal-panel overflow-x-auto rounded-md">
      <table className="min-w-[980px] w-full border-collapse">
        <thead>
          <tr className="border-b border-hairline">
            <th className="terminal-label px-4 py-3 text-left">Ticker</th>
            <th className="terminal-label px-4 py-3 text-left">Verdict</th>
            <th className="terminal-label px-4 py-3 text-left">Summary</th>
            <th className="terminal-label px-4 py-3 text-left">Outcome</th>
            <th className="terminal-label px-4 py-3 text-left">Marked</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const directionClass =
              item.result.confidence_direction === "bullish"
                ? "text-bull"
                : item.result.confidence_direction === "bearish"
                  ? "text-bear"
                  : "text-textSecondary";
            return (
              <tr key={item.id} className="border-b border-hairline/70">
                <td className="px-4 py-3 align-top">
                  <p className="mono-numeric text-sm text-textPrimary">${item.ticker}</p>
                  <p className="text-xs text-textMuted">{new Date(item.created_at).toLocaleString()}</p>
                </td>
                <td className="px-4 py-3 align-top">
                  <p className={`mono-numeric text-sm ${directionClass}`}>
                    {item.result.confidence_direction.toUpperCase()} · {item.result.confidence_pct}%
                  </p>
                </td>
                <td className="px-4 py-3 align-top text-sm text-textSecondary">{item.result.summary}</td>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-wrap gap-2">
                    {outcomes.map((outcome) => (
                      <button
                        key={`${item.id}-${outcome}`}
                        disabled={busyId === item.id}
                        onClick={() => onMarkOutcome(item.id, outcome)}
                        className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${
                          outcomeClass[outcome]
                        }`}
                      >
                        {outcome}
                      </button>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  {item.outcome ? (
                    <span className={`rounded-full border px-3 py-1 text-xs capitalize ${outcomeClass[item.outcome]}`}>
                      {item.outcome}
                    </span>
                  ) : (
                    <span className="rounded-full border border-hairline px-3 py-1 text-xs text-textMuted">unmarked</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
