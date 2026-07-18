import type { MarketHeadline, MarketMoverItem, MarketMoversResponse } from "../lib/types";

type Props = {
  movers: MarketMoversResponse;
  onSelectSymbol: (symbol: string) => void;
};

function formatAsOf(value: string | null): string {
  if (!value) return "as of --";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "as of --";
  return `as of ${parsed.toLocaleTimeString()}`;
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

function formatVolume(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

function moverRow(item: MarketMoverItem, onSelectSymbol: (symbol: string) => void, showVolume: boolean) {
  const isUp = item.change_pct >= 0;
  return (
    <button
      key={`${item.symbol}-${showVolume ? "active" : "mover"}`}
      onClick={() => onSelectSymbol(item.symbol)}
      className="flex w-full items-center justify-between gap-3 rounded-sm border border-transparent px-2 py-2 text-left transition-colors duration-150 hover:border-hairline hover:bg-inset"
    >
      <div className="min-w-0">
        <p className="mono-numeric text-sm text-textPrimary">{item.symbol}</p>
        <p className="truncate text-xs text-textMuted">{item.name}</p>
      </div>
      <div className="text-right">
        <p className="mono-numeric text-sm text-textPrimary">{item.price.toFixed(2)}</p>
        <p className={`mono-numeric text-xs ${isUp ? "text-bull" : "text-bear"}`}>
          {isUp ? "+" : ""}
          {item.change_pct.toFixed(2)}%
          {showVolume ? ` · ${formatVolume(item.volume)}` : ""}
        </p>
      </div>
    </button>
  );
}

function headlineRow(item: MarketHeadline, idx: number) {
  return (
    <li key={`market-headline-${idx}`} className="border-b border-hairline/60 pb-2 last:border-none last:pb-0">
      <a
        className="text-sm text-textPrimary transition-colors duration-150 hover:text-bull"
        href={item.url ?? "https://finance.yahoo.com"}
        target="_blank"
        rel="noreferrer"
      >
        {item.title}
      </a>
      <p className="mt-1 text-xs text-textMuted">
        {item.publisher ?? "Unknown publisher"} · {relativeDate(item.published_at)}
      </p>
    </li>
  );
}

export function TodaysTape({ movers, onSelectSymbol }: Props) {
  const showSection = movers.gainers.length > 0 || movers.losers.length > 0 || movers.most_active.length > 0;
  if (!showSection) return null;

  return (
    <section className="terminal-panel mt-4 w-full rounded-md p-4 text-left">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="terminal-label">Today&apos;s tape</p>
        <div className="flex items-center gap-2">
          {movers.session_label === "LAST SESSION" && (
            <span className="rounded-full border border-hairline px-2 py-1 text-[10px] tracking-[0.14em] text-textMuted">
              LAST SESSION
            </span>
          )}
          <span className="mono-numeric text-[11px] text-textMuted">{formatAsOf(movers.as_of)}</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="terminal-inset rounded-md p-2">
          <p className="terminal-label px-2">Gainers</p>
          <div className="mt-1 space-y-1">{movers.gainers.map((item) => moverRow(item, onSelectSymbol, false))}</div>
        </div>
        <div className="terminal-inset rounded-md p-2">
          <p className="terminal-label px-2">Losers</p>
          <div className="mt-1 space-y-1">{movers.losers.map((item) => moverRow(item, onSelectSymbol, false))}</div>
        </div>
        <div className="terminal-inset rounded-md p-2">
          <p className="terminal-label px-2">Most active</p>
          <div className="mt-1 space-y-1">{movers.most_active.map((item) => moverRow(item, onSelectSymbol, true))}</div>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-textMuted">Quotes may be delayed up to 15 minutes.</p>

      {movers.market_news.length > 0 && (
        <div className="terminal-inset mt-3 rounded-md px-3 py-3">
          <p className="terminal-label">Market headlines</p>
          <ul className="mt-2 space-y-2">{movers.market_news.map(headlineRow)}</ul>
        </div>
      )}
    </section>
  );
}
