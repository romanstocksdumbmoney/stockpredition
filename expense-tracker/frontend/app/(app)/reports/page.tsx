"use client";

import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { apiFetch } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import type { ReportData } from "@/lib/types";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#84cc16", "#ec4899"];

type PeriodMode = "week" | "month" | "last_month" | "custom";

export default function ReportsPage() {
  const [mode, setMode] = useState<PeriodMode>("week");
  const [customFrom, setCustomFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      let data: ReportData;
      if (mode === "week") {
        data = await apiFetch<ReportData>("/api/reports/weekly");
      } else if (mode === "month") {
        data = await apiFetch<ReportData>("/api/reports/monthly");
      } else if (mode === "last_month") {
        const previousMonth = subMonths(new Date(), 1);
        data = await apiFetch<ReportData>(`/api/reports/monthly?month=${format(previousMonth, "yyyy-MM")}`);
      } else {
        data = await apiFetch<ReportData>(`/api/reports/custom?date_from=${customFrom}&date_to=${customTo}`);
      }
      setReport(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReport();
  }, [mode]);

  const chartPoints = useMemo(() => {
    if (!report) return [];
    if (mode === "month" || mode === "last_month") {
      return report.by_week || [];
    }
    return report.by_day || [];
  }, [mode, report]);

  const topCategory = report?.by_category[0];
  const changeValue = mode === "week" ? report?.vs_last_week?.percentage_change : report?.vs_last_month?.percentage_change;

  async function exportPdf() {
    if (!report) return;
    const response = await apiFetch<Response>("/api/reports/export/pdf", {
      method: "POST",
      body: {
        report_type: mode,
        period_start: report.period_start,
        period_end: report.period_end,
      },
      rawResponse: true,
    });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `expense-report-${report.period_start}-${report.period_end}.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function exportCsv() {
    if (!report) return;
    const response = await apiFetch<Response>("/api/reports/export/csv", {
      method: "POST",
      body: { date_from: report.period_start, date_to: report.period_end },
      rawResponse: true,
    });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `expense-report-${report.period_start}-${report.period_end}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack gap-24">
      <div className="row space-between wrap">
        <h1>Reports</h1>
        <div className="row gap-8">
          <button className="btn-outline" onClick={() => void exportPdf()} disabled={!report}>
            📄 Export PDF
          </button>
          <button className="btn-outline" onClick={() => void exportCsv()} disabled={!report}>
            📊 Export CSV
          </button>
        </div>
      </div>

      <section className="period-toggle">
        <button className={mode === "week" ? "active" : ""} onClick={() => setMode("week")}>
          This Week
        </button>
        <button className={mode === "month" ? "active" : ""} onClick={() => setMode("month")}>
          This Month
        </button>
        <button className={mode === "last_month" ? "active" : ""} onClick={() => setMode("last_month")}>
          Last Month
        </button>
        <button className={mode === "custom" ? "active" : ""} onClick={() => setMode("custom")}>
          Custom
        </button>
      </section>

      {mode === "custom" ? (
        <section className="custom-range">
          <label>
            From
            <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
          </label>
          <button className="btn-primary" onClick={() => void loadReport()}>
            Generate Report
          </button>
        </section>
      ) : null}

      {loading ? (
        <div className="center-card">
          <div className="loader" />
          <p>Loading report...</p>
        </div>
      ) : error || !report ? (
        <div className="center-card">
          <p>{error || "No report data available."}</p>
        </div>
      ) : (
        <>
          <section className="stats-grid">
            <article className="stat-card">
              <h3>TOTAL SPENT</h3>
              <p className="value">{formatMoney(report.total_amount)}</p>
              <small>{changeValue ? `${changeValue >= 0 ? "⬆" : "⬇"} ${Math.abs(changeValue).toFixed(1)}%` : "No comparison data"}</small>
            </article>
            <article className="stat-card">
              <h3>RECEIPTS</h3>
              <p className="value">{report.receipt_count}</p>
              <small>in this period</small>
            </article>
            <article className="stat-card">
              <h3>DAILY AVERAGE</h3>
              <p className="value">{formatMoney(report.daily_average)}</p>
              <small>for this period</small>
            </article>
            <article className="stat-card">
              <h3>TOP CATEGORY</h3>
              <p className="value">{topCategory?.category || "None"}</p>
              <small>{formatMoney(topCategory?.amount || 0)} total</small>
            </article>
          </section>

          <section className="chart-grid">
            <div className="card">
              <h2>Spending by Category</h2>
              <div style={{ height: 280 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={report.by_category} dataKey="amount" nameKey="category" innerRadius={70} outerRadius={100}>
                      {report.by_category.map((entry, index) => (
                        <Cell key={entry.category} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatMoney(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="legend-list">
                {report.by_category.map((entry, index) => (
                  <div key={entry.category} className="legend-row clickable">
                    <span className="dot" style={{ background: COLORS[index % COLORS.length] }} />
                    <span>{entry.category}</span>
                    <span>{formatMoney(entry.amount)}</span>
                    <span>{entry.percentage.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h2>Spending Over Time</h2>
              <div style={{ height: 300 }}>
                <ResponsiveContainer>
                  {mode === "week" || mode === "custom" ? (
                    <BarChart data={chartPoints}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} />
                      <YAxis />
                      <Tooltip formatter={(value: number) => formatMoney(value)} />
                      <Bar dataKey="amount" fill="#6366f1" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  ) : (
                    <LineChart data={chartPoints}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} />
                      <YAxis />
                      <Tooltip formatter={(value: number) => formatMoney(value)} />
                      <Line type="monotone" dataKey="amount" stroke="#6366f1" strokeWidth={3} />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section className="card">
            <h2>Top Merchants</h2>
            <table className="compact-table">
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Receipts</th>
                  <th>Total Spent</th>
                  <th>Average</th>
                </tr>
              </thead>
              <tbody>
                {report.top_merchants.map((merchant) => (
                  <tr key={merchant.name}>
                    <td>{merchant.name}</td>
                    <td>{merchant.count}</td>
                    <td>{formatMoney(merchant.amount)}</td>
                    <td>{formatMoney(merchant.amount / Math.max(merchant.count, 1))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h2>Receipts in Period</h2>
            <table className="compact-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Merchant</th>
                  <th>Category</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {report.receipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td>{formatDate(receipt.transaction_date)}</td>
                    <td>{receipt.merchant_name || "Unknown Merchant"}</td>
                    <td>{receipt.category || "Other"}</td>
                    <td>{formatMoney(receipt.total_amount)}</td>
                    <td>{receipt.scan_status}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td colSpan={3}>TOTAL</td>
                  <td>{formatMoney(report.total_amount)}</td>
                  <td>{report.receipt_count} receipts</td>
                </tr>
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
