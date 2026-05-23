export type User = {
  id: string;
  email: string;
  display_name: string | null;
};

export type Receipt = {
  id: string;
  user_id: string;
  image_path: string;
  image_filename: string;
  uploaded_at: string | null;
  scanned_at: string | null;
  scan_status: "pending" | "processing" | "complete" | "failed";
  merchant_name: string | null;
  merchant_address: string | null;
  transaction_date: string | null;
  transaction_time: string | null;
  total_amount: number | null;
  subtotal: number | null;
  tax_amount: number | null;
  tip_amount: number | null;
  payment_method: string | null;
  category: string | null;
  description: string | null;
  currency: string;
  confidence_score: number | null;
  raw_scan_text: string | null;
  manually_edited: boolean;
  line_items: Array<{ description: string; amount: number }>;
};

export type Category = {
  id: string;
  user_id: string | null;
  name: string;
  icon: string;
  color: string;
  is_default: boolean;
};

export type ReportCategory = {
  category: string;
  amount: number;
  count: number;
  percentage: number;
};

export type ReportMerchant = {
  name: string;
  amount: number;
  count: number;
};

export type ReportPoint = {
  date: string;
  amount: number;
  count: number;
};

export type ReportData = {
  period_start: string;
  period_end: string;
  total_amount: number;
  receipt_count: number;
  daily_average: number;
  by_category: ReportCategory[];
  by_day?: ReportPoint[];
  by_week?: ReportPoint[];
  top_merchants: ReportMerchant[];
  receipts: Receipt[];
  vs_last_week?: { amount: number; percentage_change: number };
  vs_last_month?: { amount: number; percentage_change: number };
};
