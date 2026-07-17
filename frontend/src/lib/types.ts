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
  market_context: {
    last_price?: number;
    day_change_pct?: number;
    [key: string]: unknown;
  };
};

export type HistoryItem = {
  id: number;
  ticker: string;
  query_text: string | null;
  created_at: string;
  outcome: "right" | "wrong" | "mixed" | null;
  result: AnalysisResult;
};
