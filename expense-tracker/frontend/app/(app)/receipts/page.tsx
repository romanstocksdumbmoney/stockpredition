"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiFetch, apiBaseUrl } from "@/lib/api";
import { formatDate, formatMoney, relativeTime } from "@/lib/format";
import type { Category, Receipt } from "@/lib/types";

type ReceiptsResponse = {
  items: Receipt[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
};

type EditableReceipt = Receipt & {
  line_items: Array<{ description: string; amount: number }>;
};

function emptyReceipt(receipt: Receipt): EditableReceipt {
  return {
    ...receipt,
    line_items: receipt.line_items || [],
  };
}

export default function ReceiptsPage() {
  const params = useSearchParams();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [category, setCategory] = useState(params.get("category") || "");
  const [sort, setSort] = useState("Newest");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditableReceipt | null>(null);
  const [saving, setSaving] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const filtersActive = Boolean(search || dateFrom || dateTo || category);

  const sortConfig = useMemo(() => {
    switch (sort) {
      case "Oldest":
        return { sort_by: "date", sort_order: "asc" };
      case "Highest":
        return { sort_by: "amount", sort_order: "desc" };
      case "Lowest":
        return { sort_by: "amount", sort_order: "asc" };
      case "Merchant A-Z":
        return { sort_by: "merchant", sort_order: "asc" };
      default:
        return { sort_by: "date", sort_order: "desc" };
    }
  }, [sort]);

  async function fetchCategories() {
    const response = await apiFetch<{ categories: Category[] }>("/api/categories");
    setCategories(response.categories || []);
  }

  async function fetchReceipts(page = pagination.page) {
    setLoading(true);
    const query = new URLSearchParams({
      page: String(page),
      limit: String(pagination.limit),
      sort_by: sortConfig.sort_by,
      sort_order: sortConfig.sort_order,
    });
    if (search) query.set("search", search);
    if (dateFrom) query.set("date_from", dateFrom);
    if (dateTo) query.set("date_to", dateTo);
    if (category) query.set("category", category);

    try {
      const response = await apiFetch<ReceiptsResponse>(`/api/receipts?${query.toString()}`);
      setReceipts(response.items || []);
      setPagination(response.pagination || pagination);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchCategories();
  }, []);

  useEffect(() => {
    void fetchReceipts(1);
  }, [search, dateFrom, dateTo, category, sort]);

  useEffect(() => {
    const pending = receipts.filter((item) => item.scan_status === "pending" || item.scan_status === "processing");
    if (pending.length === 0) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    async function poll() {
      await Promise.all(
        pending.map(async (item) => {
          const status = await apiFetch<{ scan_status: Receipt["scan_status"]; data: Receipt | null }>(
            `/api/receipts/${item.id}/status`,
          );
          if (status.scan_status === "complete" && status.data) {
            setReceipts((prev) => prev.map((row) => (row.id === item.id ? status.data! : row)));
          }
          if (status.scan_status === "failed") {
            setReceipts((prev) => prev.map((row) => (row.id === item.id ? { ...row, scan_status: "failed" } : row)));
          }
        }),
      );
    }

    pollRef.current = setInterval(() => void poll(), 2000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [receipts]);

  function openModal(index: number) {
    setModalIndex(index);
    setEditing(emptyReceipt(receipts[index]));
  }

  function closeModal() {
    setModalIndex(null);
    setEditing(null);
  }

  async function saveChanges() {
    if (!editing) return;
    setSaving(true);
    try {
      const payload = {
        merchant_name: editing.merchant_name,
        merchant_address: editing.merchant_address,
        transaction_date: editing.transaction_date,
        transaction_time: editing.transaction_time,
        category: editing.category,
        total_amount: editing.total_amount,
        subtotal: editing.subtotal,
        tax_amount: editing.tax_amount,
        tip_amount: editing.tip_amount,
        payment_method: editing.payment_method,
        description: editing.description,
        line_items: editing.line_items,
      };
      const response = await apiFetch<{ receipt: Receipt }>(`/api/receipts/${editing.id}`, {
        method: "PATCH",
        body: payload,
      });
      setReceipts((prev) => prev.map((row) => (row.id === editing.id ? response.receipt : row)));
      closeModal();
    } finally {
      setSaving(false);
    }
  }

  async function deleteReceipt(id: string) {
    await apiFetch(`/api/receipts/${id}`, { method: "DELETE" });
    setReceipts((prev) => prev.filter((row) => row.id !== id));
    setSelectedIds((prev) => prev.filter((row) => row !== id));
  }

  async function rescanReceipt(id: string) {
    await apiFetch(`/api/receipts/${id}/rescan`, { method: "POST" });
    setReceipts((prev) => prev.map((row) => (row.id === id ? { ...row, scan_status: "pending" } : row)));
  }

  async function deleteSelected() {
    await Promise.all(selectedIds.map(async (id) => apiFetch(`/api/receipts/${id}`, { method: "DELETE" })));
    setReceipts((prev) => prev.filter((row) => !selectedIds.includes(row.id)));
    setSelectedIds([]);
  }

  async function recategorizeSelected() {
    const newCategory = window.prompt("Enter category to assign to selected receipts:");
    if (!newCategory) return;
    await Promise.all(
      selectedIds.map(async (id) => apiFetch(`/api/receipts/${id}`, { method: "PATCH", body: { category: newCategory } })),
    );
    setReceipts((prev) =>
      prev.map((row) => (selectedIds.includes(row.id) ? { ...row, category: newCategory, manually_edited: true } : row)),
    );
    setSelectedIds([]);
  }

  function exportSelected() {
    const selected = receipts.filter((row) => selectedIds.includes(row.id));
    const header = ["Date", "Merchant", "Category", "Amount"];
    const rows = selected.map((row) => [
      row.transaction_date || "",
      row.merchant_name || "",
      row.category || "Other",
      String(row.total_amount || 0),
    ]);
    const csvText = [header, ...rows].map((line) => line.join(",")).join("\n");
    const blob = new Blob([csvText], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "selected-receipts.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack gap-20">
      <h1>All Receipts</h1>

      <section className="filters sticky-card">
        <input
          placeholder="Search merchant, category, notes..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All Categories</option>
          {categories.map((item) => (
            <option key={item.id} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option>Newest</option>
          <option>Oldest</option>
          <option>Highest</option>
          <option>Lowest</option>
          <option>Merchant A-Z</option>
        </select>
        <div className="view-toggle">
          <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>
            ⊞ Grid
          </button>
          <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
            ≡ List
          </button>
        </div>
        {filtersActive ? (
          <button
            className="text-link"
            onClick={() => {
              setSearch("");
              setDateFrom("");
              setDateTo("");
              setCategory("");
            }}
          >
            Clear Filters
          </button>
        ) : null}
      </section>

      <p className="muted">
        Showing {receipts.length} of {pagination.total} receipts total
      </p>

      {selectedIds.length > 0 ? (
        <section className="bulk-bar">
          <button className="btn-danger" onClick={() => void deleteSelected()}>
            🗑 Delete {selectedIds.length}
          </button>
          <button className="btn-outline" onClick={exportSelected}>
            📤 Export {selectedIds.length}
          </button>
          <button className="btn-outline" onClick={() => void recategorizeSelected()}>
            🏷 Recategorize {selectedIds.length}
          </button>
        </section>
      ) : null}

      {loading ? (
        <div className="center-card">
          <div className="loader" />
        </div>
      ) : receipts.length === 0 ? (
        <div className="empty-card">
          <div className="empty-icon">📄</div>
          <h3>No receipts yet</h3>
          <p>Upload your first receipt to get started</p>
          <a className="btn-primary" href="/upload">
            📸 Upload Receipt
          </a>
        </div>
      ) : view === "grid" ? (
        <section className="receipts-grid">
          {receipts.map((receipt, index) => (
            <article key={receipt.id} className={`receipt-card status-${receipt.scan_status}`}>
              <button
                className="select-checkbox"
                onClick={() =>
                  setSelectedIds((prev) =>
                    prev.includes(receipt.id) ? prev.filter((id) => id !== receipt.id) : [...prev, receipt.id],
                  )
                }
              >
                {selectedIds.includes(receipt.id) ? "☑" : "☐"}
              </button>
              <div className="image-wrap" onClick={() => openModal(index)}>
                <img src={`${apiBaseUrl()}/api/receipts/${receipt.id}/image`} alt={receipt.image_filename} />
                {receipt.scan_status === "processing" ? (
                  <div className="scan-overlay">AI reading receipt...</div>
                ) : receipt.scan_status === "pending" ? (
                  <div className="scan-overlay shimmer">Pending scan...</div>
                ) : receipt.scan_status === "failed" ? (
                  <div className="scan-overlay failed">Tap to retry</div>
                ) : null}
              </div>
              <div className="receipt-body">
                <div className="row space-between">
                  <h4>{receipt.merchant_name || "Unknown Merchant"}</h4>
                  <span
                    className={`confidence-dot ${
                      (receipt.confidence_score || 0) > 0.8 ? "good" : (receipt.confidence_score || 0) > 0.5 ? "medium" : "low"
                    }`}
                  />
                </div>
                <p>{formatDate(receipt.transaction_date)}</p>
                <div className="row space-between">
                  <span className="pill">{receipt.category || "Other"}</span>
                  <strong>{formatMoney(receipt.total_amount)}</strong>
                </div>
                <div className="row gap-8 wrap">
                  <button className="text-link" onClick={() => openModal(index)}>
                    ✏ Edit details
                  </button>
                  <button className="text-link" onClick={() => void rescanReceipt(receipt.id)}>
                    🔄 Re-scan
                  </button>
                  <button className="text-link danger" onClick={() => void deleteReceipt(receipt.id)}>
                    🗑 Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="table-card">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={selectedIds.length === receipts.length}
                    onChange={(event) =>
                      setSelectedIds(event.target.checked ? receipts.map((receipt) => receipt.id) : [])
                    }
                  />
                </th>
                <th>Thumbnail</th>
                <th>Date</th>
                <th>Merchant</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Status</th>
                <th>⋯</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((receipt, index) => (
                <tr key={receipt.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(receipt.id)}
                      onChange={(event) =>
                        setSelectedIds((prev) =>
                          event.target.checked ? [...prev, receipt.id] : prev.filter((id) => id !== receipt.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <img
                      className="table-thumb"
                      src={`${apiBaseUrl()}/api/receipts/${receipt.id}/image`}
                      alt={receipt.image_filename}
                      onClick={() => openModal(index)}
                    />
                  </td>
                  <td>{formatDate(receipt.transaction_date)}</td>
                  <td>{receipt.merchant_name || "Unknown Merchant"}</td>
                  <td>{receipt.category || "Other"}</td>
                  <td>{formatMoney(receipt.total_amount)}</td>
                  <td>{receipt.scan_status}</td>
                  <td>
                    <button className="text-link" onClick={() => openModal(index)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="pagination">
        <button disabled={pagination.page <= 1} onClick={() => void fetchReceipts(pagination.page - 1)}>
          ◀ Prev
        </button>
        {Array.from({ length: pagination.pages }, (_, i) => i + 1).map((pageNumber) => (
          <button
            key={pageNumber}
            className={pageNumber === pagination.page ? "active" : ""}
            onClick={() => void fetchReceipts(pageNumber)}
          >
            {pageNumber}
          </button>
        ))}
        <button disabled={pagination.page >= pagination.pages} onClick={() => void fetchReceipts(pagination.page + 1)}>
          ▶ Next
        </button>
      </section>
      <p className="muted">
        Showing {(pagination.page - 1) * pagination.limit + 1}-{Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
        {pagination.total} receipts
      </p>

      {editing && modalIndex !== null ? (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="receipt-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-left">
              <img src={`${apiBaseUrl()}/api/receipts/${editing.id}/image`} alt={editing.image_filename} className="modal-image" />
              <div className="row space-between">
                <button
                  disabled={modalIndex <= 0}
                  onClick={() => openModal(Math.max(modalIndex - 1, 0))}
                >
                  ◀
                </button>
                <button
                  disabled={modalIndex >= receipts.length - 1}
                  onClick={() => openModal(Math.min(modalIndex + 1, receipts.length - 1))}
                >
                  ▶
                </button>
              </div>
              <a className="btn-outline" href={`${apiBaseUrl()}/api/receipts/${editing.id}/image`} target="_blank">
                Download original image
              </a>
            </div>
            <div className="modal-right">
              <h3>Extracted data</h3>
              <label>
                Merchant Name
                <input
                  value={editing.merchant_name || ""}
                  onChange={(event) => setEditing({ ...editing, merchant_name: event.target.value })}
                />
              </label>
              <label>
                Date
                <input
                  type="date"
                  value={editing.transaction_date || ""}
                  onChange={(event) => setEditing({ ...editing, transaction_date: event.target.value })}
                />
              </label>
              <label>
                Time
                <input
                  type="time"
                  value={editing.transaction_time || ""}
                  onChange={(event) => setEditing({ ...editing, transaction_time: event.target.value })}
                />
              </label>
              <label>
                Category
                <select
                  value={editing.category || "Other"}
                  onChange={(event) => setEditing({ ...editing, category: event.target.value })}
                >
                  {categories.map((item) => (
                    <option key={item.id} value={item.name}>
                      {item.icon} {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Total Amount
                <input
                  type="number"
                  value={editing.total_amount || 0}
                  onChange={(event) => setEditing({ ...editing, total_amount: Number(event.target.value) })}
                />
              </label>
              <label>
                Subtotal
                <input
                  type="number"
                  value={editing.subtotal || 0}
                  onChange={(event) => setEditing({ ...editing, subtotal: Number(event.target.value) })}
                />
              </label>
              <label>
                Tax
                <input
                  type="number"
                  value={editing.tax_amount || 0}
                  onChange={(event) => setEditing({ ...editing, tax_amount: Number(event.target.value) })}
                />
              </label>
              <label>
                Tip
                <input
                  type="number"
                  value={editing.tip_amount || 0}
                  onChange={(event) => setEditing({ ...editing, tip_amount: Number(event.target.value) })}
                />
              </label>
              <label>
                Payment Method
                <select
                  value={editing.payment_method || "Other"}
                  onChange={(event) => setEditing({ ...editing, payment_method: event.target.value })}
                >
                  <option>Cash</option>
                  <option>Visa</option>
                  <option>Mastercard</option>
                  <option>Amex</option>
                  <option>Other</option>
                </select>
              </label>
              <label>
                Notes
                <textarea
                  value={editing.description || ""}
                  onChange={(event) => setEditing({ ...editing, description: event.target.value })}
                />
              </label>

              <section className="line-items">
                <h4>Line Items</h4>
                {editing.line_items.map((item, index) => (
                  <div key={`${item.description}-${index}`} className="line-item-row">
                    <input
                      value={item.description}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          line_items: editing.line_items.map((line, lineIndex) =>
                            lineIndex === index ? { ...line, description: event.target.value } : line,
                          ),
                        })
                      }
                    />
                    <input
                      type="number"
                      value={item.amount}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          line_items: editing.line_items.map((line, lineIndex) =>
                            lineIndex === index ? { ...line, amount: Number(event.target.value) } : line,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
                <button
                  className="text-link"
                  onClick={() => setEditing({ ...editing, line_items: [...editing.line_items, { description: "", amount: 0 }] })}
                >
                  + Add Item
                </button>
              </section>

              <section className="card ai-info">
                <h4>AI Info</h4>
                <p>
                  Confidence: {Math.round((editing.confidence_score || 0) * 100)}%
                  <span className="progress">
                    <span style={{ width: `${Math.max(5, (editing.confidence_score || 0) * 100)}%` }} />
                  </span>
                </p>
                <p>Scanned: {relativeTime(editing.scanned_at)}</p>
                {(editing.confidence_score || 0) < 0.5 ? (
                  <p className="warning-text">⚠ Low confidence — please review these details</p>
                ) : null}
              </section>

              <div className="row gap-8">
                <button className="btn-primary" onClick={() => void saveChanges()} disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </button>
                <button className="btn-outline" onClick={() => void rescanReceipt(editing.id)}>
                  Re-scan
                </button>
                <button
                  className="btn-danger"
                  onClick={async () => {
                    await deleteReceipt(editing.id);
                    closeModal();
                  }}
                >
                  Delete
                </button>
                <button className="btn-outline" onClick={closeModal}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
