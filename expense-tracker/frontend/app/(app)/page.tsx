"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useAuth } from "@/components/auth-context";
import { apiFetch, apiBaseUrl } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import type { Receipt, ReportData } from "@/lib/types";

type SummaryData = {
  this_week_total: number;
  this_month_total: number;
  this_year_total: number;
  receipt_count_this_month: number;
  top_category_this_month: string;
  daily_average_this_month: number;
  last_30_days: Array<{ date: string; amount: number }>;
};

type QuickUploadItem = {
  localId: string;
  file: File;
  receiptId?: string;
  status: "waiting" | "uploading" | "pending" | "processing" | "complete" | "failed";
  message: string;
  totalAmount?: number;
  merchantName?: string;
};

const CHART_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#8b5cf6",
  "#84cc16",
  "#ec4899",
  "#3b82f6",
];

function compareLabel(value: number | undefined) {
  const change = value || 0;
  const arrow = change >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(change).toFixed(1)}%`;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [weekly, setWeekly] = useState<ReportData | null>(null);
  const [monthly, setMonthly] = useState<ReportData | null>(null);
  const [recentReceipts, setRecentReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadItems, setUploadItems] = useState<QuickUploadItem[]>([]);
  const pollingTimer = useRef<NodeJS.Timeout | null>(null);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [summaryResponse, weeklyResponse, monthlyResponse, receiptsResponse] = await Promise.all([
        apiFetch<SummaryData>("/api/reports/summary"),
        apiFetch<ReportData>("/api/reports/weekly"),
        apiFetch<ReportData>("/api/reports/monthly"),
        apiFetch<{ items: Receipt[] }>("/api/receipts?limit=5&page=1"),
      ]);
      setSummary(summaryResponse);
      setWeekly(weeklyResponse);
      setMonthly(monthlyResponse);
      setRecentReceipts(receiptsResponse.items || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    const pendingIds = uploadItems.filter((item) => item.receiptId && ["pending", "processing"].includes(item.status));
    if (pendingIds.length === 0) {
      if (pollingTimer.current) {
        clearInterval(pollingTimer.current);
        pollingTimer.current = null;
      }
      return;
    }

    async function pollStatuses() {
      await Promise.all(
        pendingIds.map(async (item) => {
          if (!item.receiptId) return;
          try {
            const status = await apiFetch<{ id: string; scan_status: Receipt["scan_status"]; data: Receipt | null }>(
              `/api/receipts/${item.receiptId}/status`,
            );
            setUploadItems((prev) =>
              prev.map((row) => {
                if (row.localId !== item.localId) {
                  return row;
                }
                if (status.scan_status === "complete" && status.data) {
                  return {
                    ...row,
                    status: "complete",
                    message: `Done — ${formatMoney(status.data.total_amount)} at ${status.data.merchant_name || "Unknown"}`,
                    totalAmount: status.data.total_amount ?? 0,
                    merchantName: status.data.merchant_name || "Unknown",
                  };
                }
                if (status.scan_status === "failed") {
                  return { ...row, status: "failed", message: "Could not read receipt" };
                }
                return {
                  ...row,
                  status: status.scan_status,
                  message: status.scan_status === "processing" ? "AI scanning your receipt..." : "Waiting to scan...",
                };
              }),
            );
          } catch {
            setUploadItems((prev) =>
              prev.map((row) => (row.localId === item.localId ? { ...row, status: "failed", message: "Polling failed" } : row)),
            );
          }
        }),
      );
      void loadData();
    }

    void pollStatuses();
    pollingTimer.current = setInterval(() => {
      void pollStatuses();
    }, 2000);

    return () => {
      if (pollingTimer.current) {
        clearInterval(pollingTimer.current);
        pollingTimer.current = null;
      }
    };
  }, [uploadItems]);

  async function handleQuickUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const selected = Array.from(files).slice(0, 10);
    const initialItems = selected.map((file) => ({
      localId: `${Date.now()}-${file.name}-${Math.random()}`,
      file,
      status: "waiting" as const,
      message: "Waiting to upload",
    }));
    setUploadItems((prev) => [...initialItems, ...prev]);

    const form = new FormData();
    selected.forEach((file) => form.append("files", file));

    setUploadItems((prev) =>
      prev.map((item) => (initialItems.some((candidate) => candidate.localId === item.localId) ? { ...item, status: "uploading", message: "Uploading..." } : item)),
    );

    try {
      const response = await apiFetch<{ success: boolean; receipts: Array<{ id: string; scan_status: Receipt["scan_status"] }> }>(
        "/api/receipts/upload",
        { method: "POST", body: form },
      );
      setUploadItems((prev) =>
        prev.map((item) => {
          const index = initialItems.findIndex((candidate) => candidate.localId === item.localId);
          if (index === -1) return item;
          const created = response.receipts[index];
          return {
            ...item,
            receiptId: created.id,
            status: created.scan_status,
            message: created.scan_status === "pending" ? "Waiting to scan..." : "AI scanning your receipt...",
          };
        }),
      );
    } catch (uploadError) {
      const errorMessage = uploadError instanceof Error ? uploadError.message : "Upload failed.";
      setUploadItems((prev) =>
        prev.map((item) =>
          initialItems.some((candidate) => candidate.localId === item.localId)
            ? { ...item, status: "failed", message: errorMessage }
            : item,
        ),
      );
    }
  }

  if (loading) {
    return (
      <div className="center-card">
        <div className="loader" />
        <p>Loading dashboard...</p>
      </div>
    );
  }

  if (error || !summary || !weekly || !monthly) {
    return (
      <div className="center-card">
        <p>{error || "Dashboard data is unavailable."}</p>
        <button className="btn-primary" onClick={() => void loadData()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="stack gap-24">
      <section className="welcome-banner">
        <h1>
          {greeting}, {user?.display_name || "there"} 👋
        </h1>
        <p>Here&apos;s your spending overview</p>
      </section>

      <section className="stats-grid">
        <article className="stat-card">
          <h3>THIS WEEK</h3>
          <p className="value">{formatMoney(summary.this_week_total)}</p>
          <small>vs last week</small>
          <span className="trend">{compareLabel(weekly.vs_last_week?.percentage_change)}</span>
        </article>
        <article className="stat-card">
          <h3>THIS MONTH</h3>
          <p className="value">{formatMoney(summary.this_month_total)}</p>
          <small>vs last month</small>
          <span className="trend">{compareLabel(monthly.vs_last_month?.percentage_change)}</span>
        </article>
        <article className="stat-card">
          <h3>RECEIPTS</h3>
          <p className="value">{summary.receipt_count_this_month}</p>
          <small>this month</small>
        </article>
        <article className="stat-card">
          <h3>DAILY AVERAGE</h3>
          <p className="value">{formatMoney(summary.daily_average_this_month)}</p>
          <small>this month</small>
        </article>
      </section>

      <section className="chart-grid">
        <div className="card">
          <div className="card-head">
            <h2>Spending by Category</h2>
          </div>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={weekly.by_category} dataKey="amount" nameKey="category" innerRadius={70} outerRadius={100}>
                  {weekly.by_category.map((entry, index) => (
                    <Cell key={entry.category} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatMoney(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="legend-list">
            {weekly.by_category.map((item, index) => (
              <Link key={item.category} href={`/receipts?category=${encodeURIComponent(item.category)}`} className="legend-row">
                <span className="dot" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
                <span>{item.category}</span>
                <span>{formatMoney(item.amount)}</span>
                <span>{item.percentage.toFixed(1)}%</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Spending Last 30 Days</h2>
          </div>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <AreaChart data={summary.last_30_days}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} />
                <YAxis tickFormatter={(value) => `$${value}`} />
                <Tooltip
                  formatter={(value: number) => formatMoney(value)}
                  labelFormatter={(label) => formatDate(String(label))}
                />
                <Area type="monotone" dataKey="amount" stroke="#6366f1" fill="#c7d2fe" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Recent Receipts</h2>
          <Link href="/receipts" className="text-link">
            View All Receipts
          </Link>
        </div>
        <div className="recent-list">
          {recentReceipts.length === 0 ? (
            <p className="muted">No receipts yet. Upload your first one.</p>
          ) : (
            recentReceipts.map((receipt) => (
              <div key={receipt.id} className="recent-item">
                <img
                  src={`${apiBaseUrl()}/api/receipts/${receipt.id}/image`}
                  alt={receipt.image_filename}
                  className="thumb"
                />
                <div>
                  <h4>{receipt.merchant_name || "Unknown Merchant"}</h4>
                  <p>{formatDate(receipt.transaction_date)}</p>
                </div>
                <span className="pill">{receipt.category || "Other"}</span>
                <strong>{formatMoney(receipt.total_amount)}</strong>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="card">
        <h2>Quick Upload Box</h2>
        <div className="upload-inline">
          <input
            type="file"
            id="quick-upload-input"
            multiple
            accept=".jpg,.jpeg,.png,.heic,.webp,.pdf"
            onChange={(event) => void handleQuickUpload(event.target.files)}
          />
          <label htmlFor="quick-upload-input" className="upload-label">
            Drop a receipt here for quick upload or choose file
          </label>
        </div>
        <div className="queue-list">
          {uploadItems.map((item) => (
            <div key={item.localId} className={`queue-item ${item.status}`}>
              <span>{item.file.name}</span>
              <span>{item.message}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
