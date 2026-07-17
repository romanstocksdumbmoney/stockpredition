import type { HistoryItem } from "../lib/types";

type Outcome = "right" | "wrong" | "mixed";

type Props = {
  items: HistoryItem[];
  onMarkOutcome: (id: number, outcome: Outcome) => Promise<void>;
  busyId: number | null;
};

const outcomeClass: Record<string, string> = {
  right: "bg-bull/20 text-bull border-bull/40",
  wrong: "bg-bear/20 text-bear border-bear/40",
  mixed: "bg-amber-500/20 text-amber-200 border-amber-300/40"
};

const outcomes: Outcome[] = ["right", "wrong", "mixed"];

export function HistoryTab({ items, onMarkOutcome, busyId }: Props) {
  if (!items.length) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300">
        No analyses saved yet. Run an analysis to build your personal track record.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <article key={item.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold text-slate-100">{item.ticker}</h3>
              <p className="text-xs text-slate-400">{new Date(item.created_at).toLocaleString()}</p>
            </div>
            {item.outcome ? (
              <span className={`rounded-full border px-2 py-1 text-xs capitalize ${outcomeClass[item.outcome]}`}>
                {item.outcome}
              </span>
            ) : (
              <span className="rounded-full border border-slate-600 px-2 py-1 text-xs text-slate-400">Unmarked</span>
            )}
          </div>

          <p className="mb-3 text-sm text-slate-300">{item.result.summary}</p>
          <div className="flex flex-wrap gap-2">
            {outcomes.map((outcome) => (
              <button
                key={`${item.id}-${outcome}`}
                disabled={busyId === item.id}
                onClick={() => onMarkOutcome(item.id, outcome)}
                className="rounded-md border border-slate-600 px-3 py-1 text-xs capitalize text-slate-200 transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                Mark {outcome}
              </button>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
