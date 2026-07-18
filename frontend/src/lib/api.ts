import type {
  AnalysisResult,
  BriefingRecord,
  HistoryItem,
  TickerQuote,
  WatchlistItem,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const fallback = `Request failed with ${response.status}`;
    let detail = fallback;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") {
        detail = body.detail;
      }
    } catch {
      // Keep fallback if response is not JSON.
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export async function analyze(query: string): Promise<AnalysisResult> {
  const response = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  return parseResponse<AnalysisResult>(response);
}

export async function getHistory(): Promise<HistoryItem[]> {
  const response = await fetch(`${API_BASE}/api/history`);
  return parseResponse<HistoryItem[]>(response);
}

export async function markOutcome(id: number, outcome: "right" | "wrong" | "mixed"): Promise<HistoryItem> {
  const response = await fetch(`${API_BASE}/api/history/${id}/outcome`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outcome })
  });
  return parseResponse<HistoryItem>(response);
}

export async function getTickerQuote(symbol: string): Promise<TickerQuote> {
  const response = await fetch(`${API_BASE}/api/ticker/${encodeURIComponent(symbol)}/quote`);
  return parseResponse<TickerQuote>(response);
}

export async function getWatchlist(): Promise<WatchlistItem[]> {
  const response = await fetch(`${API_BASE}/api/watchlist`);
  return parseResponse<WatchlistItem[]>(response);
}

export async function addWatchlistSymbol(symbol: string): Promise<WatchlistItem> {
  const response = await fetch(`${API_BASE}/api/watchlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol })
  });
  return parseResponse<WatchlistItem>(response);
}

export async function removeWatchlistSymbol(symbol: string): Promise<WatchlistItem> {
  const response = await fetch(`${API_BASE}/api/watchlist/${encodeURIComponent(symbol)}`, {
    method: "DELETE"
  });
  return parseResponse<WatchlistItem>(response);
}

export async function getLatestBriefing(): Promise<BriefingRecord> {
  const response = await fetch(`${API_BASE}/api/briefing/latest`);
  return parseResponse<BriefingRecord>(response);
}

export async function getBriefingByDate(date: string): Promise<BriefingRecord> {
  const response = await fetch(`${API_BASE}/api/briefing/${encodeURIComponent(date)}`);
  return parseResponse<BriefingRecord>(response);
}

export async function runBriefingScan(): Promise<BriefingRecord> {
  const response = await fetch(`${API_BASE}/api/briefing/run`, {
    method: "POST"
  });
  return parseResponse<BriefingRecord>(response);
}
