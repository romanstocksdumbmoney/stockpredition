import { FormEvent, useState } from "react";

type Props = {
  onSubmit: (query: string) => Promise<void>;
  loading: boolean;
};

export function SearchBar({ onSubmit, loading }: Props) {
  const [query, setQuery] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value) {
      return;
    }
    await onSubmit(value);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full rounded-xl border border-slate-700 bg-slate-900/70 p-4 shadow-lg">
      <label htmlFor="tradebot-query" className="mb-2 block text-sm font-medium text-slate-300">
        TradeBot, look at this...
      </label>
      <div className="flex flex-col gap-3 md:flex-row">
        <input
          id="tradebot-query"
          type="text"
          placeholder="Try: TradeBot, look at $AAPL or paste a flow alert"
          className="flex-1 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-accent focus:outline-none"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-accent px-5 py-2 font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
        >
          {loading ? "Analyzing..." : "Analyze"}
        </button>
      </div>
    </form>
  );
}
