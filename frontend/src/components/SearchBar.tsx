import { FormEvent, useState } from "react";

type Props = {
  onSubmit: (query: string) => Promise<void>;
  loading: boolean;
  centered?: boolean;
};

export function SearchBar({ onSubmit, loading, centered = false }: Props) {
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
    <form
      onSubmit={handleSubmit}
      className={`w-full ${centered ? "mx-auto max-w-3xl" : ""}`}
    >
      <div className={`flex ${centered ? "flex-col gap-4 md:flex-row" : "flex-col gap-3 md:flex-row"}`}>
        <input
          id="tradebot-query"
          type="text"
          placeholder="$TICKER"
          className={`mono-numeric h-12 flex-1 rounded-md border border-hairline bg-inset px-4 text-textPrimary placeholder:text-textMuted focus:border-bull focus:outline-none transition-colors duration-150 ${
            centered ? "text-center text-lg" : "text-base"
          }`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading}
          className="h-12 rounded-md border border-bull bg-bull px-7 font-semibold text-page transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:border-hairline disabled:bg-inset disabled:text-textMuted"
        >
          {loading ? "Analyzing..." : "Analyze"}
        </button>
      </div>
    </form>
  );
}
