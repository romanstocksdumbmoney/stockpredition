export type ConfidenceDirection = "bullish" | "bearish" | "neutral";

export type OhlcvPoint = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type AnalysisResult = {
  analysis_id?: number;
  ticker: string;
  bull_case: string[];
  bear_case: string[];
  scenarios?: {
    bull_trigger: string;
    bear_trigger: string;
    invalidation: string;
  };
  context_factors?: string[];
  earnings_warning?: boolean;
  key_flow_signal: string | null;
  pattern_summary: string;
  confidence_pct: number;
  confidence_direction: ConfidenceDirection;
  reasoning_source: "claude" | "fallback";
  summary: string;
  risk_flags: string[];
  disclaimer: string;
  generated_at: string;
  chart: {
    ohlcv: OhlcvPoint[];
    support_levels: number[];
    resistance_levels: number[];
  };
  indicators: Record<string, unknown>;
  patterns: {
    support_levels?: number[];
    resistance_levels?: number[];
    price_at_highs?: boolean;
    [key: string]: unknown;
  };
  flow_data: {
    available?: boolean;
    message?: string;
    [key: string]: unknown;
  };
  context_pack?: {
    fundamentals?: {
      market_cap?: number | null;
      pe_trailing?: number | null;
      pe_forward?: number | null;
      price_to_sales?: number | null;
      revenue_growth_yoy?: number | null;
      profit_margin?: number | null;
      short_percent_float?: number | null;
      beta?: number | null;
      dividend_yield?: number | null;
      sector?: string | null;
      industry?: string | null;
    };
    catalysts?: {
      next_earnings_date?: string | null;
      days_to_earnings?: number | null;
      recent_news?: Array<{
        title: string;
        publisher?: string | null;
        published_at?: string | null;
        url?: string | null;
      }> | null;
    };
    market_regime?: {
      spy?: {
        last_close?: number | null;
        pct_vs_ema50?: number | null;
        trend?: "above" | "below" | null;
      } | null;
      vix?: {
        last_close?: number | null;
        bucket?: "calm" | "normal" | "elevated" | "stressed" | null;
      } | null;
      sector_etf?: {
        symbol?: string | null;
        performance_1mo_pct?: number | null;
      } | null;
    };
  };
  market_context: {
    last_price?: number;
    day_change_pct?: number;
    [key: string]: unknown;
  };
};

export type MarketState = "open" | "closed" | "pre" | "post";

export type TickerQuote = {
  price: number;
  change_pct: number | null;
  volume: number | null;
  as_of: string;
  market_state: MarketState;
};

export type WatchlistItem = {
  symbol: string;
  added_at: string;
};

export type BriefingItem = {
  symbol: string;
  note: string;
  severity: "action" | "watch" | "quiet";
  analysis_id?: number | null;
  scan_failed?: boolean;
};

export type BriefingPayload = {
  headline: string;
  market_note: string;
  items: BriefingItem[];
  quiet_tickers: string[];
};

export type BriefingRecord = {
  date: string;
  created_at: string;
  briefing: BriefingPayload;
};

export type HistoryItem = {
  id: number;
  ticker: string;
  query_text: string | null;
  created_at: string;
  outcome: "right" | "wrong" | "mixed" | null;
  result: AnalysisResult;
};
