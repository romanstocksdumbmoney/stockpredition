"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { Receipt } from "@/lib/types";

type QueueItem = {
  localId: string;
  file: File;
  previewUrl: string;
  receiptId?: string;
  status: "waiting" | "uploading" | "pending" | "processing" | "complete" | "failed";
  message: string;
  data?: Receipt;
};

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadPage() {
  const searchParams = useSearchParams();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completeSummary, setCompleteSummary] = useState<{ count: number; total: number; categories: string[] } | null>(
    null,
  );
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const welcome = searchParams.get("welcome");

  const activeUploads = useMemo(
    () => queue.filter((item) => item.receiptId && ["pending", "processing"].includes(item.status)),
    [queue],
  );

  useEffect(() => {
    if (activeUploads.length === 0) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    async function poll() {
      await Promise.all(
        activeUploads.map(async (item) => {
          if (!item.receiptId) return;
          try {
            const status = await apiFetch<{ scan_status: Receipt["scan_status"]; data: Receipt | null }>(
              `/api/receipts/${item.receiptId}/status`,
            );
            setQueue((prev) =>
              prev.map((row) => {
                if (row.localId !== item.localId) return row;
                if (status.scan_status === "complete" && status.data) {
                  return {
                    ...row,
                    status: "complete",
                    message: `Done — ${formatMoney(status.data.total_amount)} at ${status.data.merchant_name || "Unknown"}`,
                    data: status.data,
                  };
                }
                if (status.scan_status === "failed") {
                  return { ...row, status: "failed", message: "Could not read — Retry available" };
                }
                return {
                  ...row,
                  status: status.scan_status,
                  message: status.scan_status === "processing" ? "AI scanning your receipt..." : "Waiting to upload",
                };
              }),
            );
          } catch {
            setQueue((prev) =>
              prev.map((row) => (row.localId === item.localId ? { ...row, status: "failed", message: "Status check failed" } : row)),
            );
          }
        }),
      );
    }

    void poll();
    timerRef.current = setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [activeUploads]);

  useEffect(() => {
    const complete = queue.filter((item) => item.status === "complete" && item.data);
    if (queue.length > 0 && complete.length === queue.length) {
      const total = complete.reduce((sum, item) => sum + (item.data?.total_amount || 0), 0);
      const categories = Array.from(new Set(complete.map((item) => item.data?.category || "Other")));
      setCompleteSummary({ count: complete.length, total, categories });
    }
  }, [queue]);

  function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const picked = Array.from(fileList).slice(0, 10);
    const newItems = picked.map((file) => ({
      localId: `${Date.now()}-${Math.random()}`,
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
      status: "waiting" as const,
      message: "Waiting to upload",
    }));
    setQueue((prev) => [...prev, ...newItems]);
    setError(null);
    setCompleteSummary(null);
  }

  async function uploadAll() {
    if (queue.length === 0) return;
    setUploading(true);
    setError(null);
    setQueue((prev) => prev.map((item) => ({ ...item, status: "uploading", message: "Uploading..." })));

    const form = new FormData();
    queue.forEach((item) => form.append("files", item.file));

    try {
      const response = await apiFetch<{ receipts: Array<{ id: string; scan_status: Receipt["scan_status"] }> }>(
        "/api/receipts/upload",
        { method: "POST", body: form },
      );

      setQueue((prev) =>
        prev.map((item, index) => ({
          ...item,
          receiptId: response.receipts[index]?.id,
          status: response.receipts[index]?.scan_status || "failed",
          message:
            response.receipts[index]?.scan_status === "pending" ? "Waiting to upload" : "AI scanning your receipt...",
        })),
      );
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
      setQueue((prev) => prev.map((item) => ({ ...item, status: "failed", message: "Upload failed" })));
    } finally {
      setUploading(false);
    }
  }

  async function retryItem(item: QueueItem) {
    if (!item.receiptId) return;
    await apiFetch(`/api/receipts/${item.receiptId}/rescan`, { method: "POST" });
    setQueue((prev) =>
      prev.map((row) => (row.localId === item.localId ? { ...row, status: "pending", message: "Waiting to upload" } : row)),
    );
  }

  function removeItem(localId: string) {
    setQueue((prev) => prev.filter((item) => item.localId !== localId));
  }

  return (
    <div className="stack gap-24">
      {welcome ? <div className="success-banner">Welcome! Upload your first receipt.</div> : null}
      <header>
        <h1>Upload Receipt</h1>
      </header>

      <div className="mobile-priority-buttons">
        <label className="btn-primary mobile-upload-btn">
          📷 Take a Photo
          <input type="file" accept="image/*" capture="environment" onChange={(event) => addFiles(event.target.files)} />
        </label>
        <label className="btn-outline mobile-upload-btn">
          🖼 Choose from Library
          <input type="file" accept="image/*,.pdf" onChange={(event) => addFiles(event.target.files)} />
        </label>
      </div>

      {uploading ? <div className="progress-indeterminate" /> : null}

      <div
        className={`upload-hero ${dragOver ? "drag-over" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          addFiles(event.dataTransfer.files);
        }}
      >
        <div className="hero-center">
          <div className="big-icon">📸</div>
          <h2>{dragOver ? "Drop to add!" : "Drop receipt photos here"}</h2>
          <p>or click to browse your files</p>
          <small>JPG PNG HEIC PDF — up to 10 files, 20MB each</small>
          <label className="btn-primary choose-files-btn">
            Choose Files
            <input
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.heic,.webp,.pdf"
              onChange={(event) => addFiles(event.target.files)}
            />
          </label>
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <section className="queue-section">
        {queue.map((item) => (
          <article key={item.localId} className="upload-item">
            <div className="preview-wrap">
              {item.previewUrl ? <img src={item.previewUrl} alt={item.file.name} /> : <div className="preview-placeholder">📄</div>}
            </div>
            <div className="upload-item-main">
              <h4>{item.file.name}</h4>
              <small>{fileSize(item.file.size)}</small>
              <p className={`status-${item.status}`}>
                {item.status === "waiting" && "⏳ "}
                {item.status === "uploading" && "🔄 "}
                {item.status === "processing" && "🤖 "}
                {item.status === "complete" && "✅ "}
                {item.status === "failed" && "❌ "}
                {item.message}
              </p>
              {item.status === "failed" && item.receiptId ? (
                <button className="text-link" onClick={() => void retryItem(item)}>
                  Retry
                </button>
              ) : null}
            </div>
            <button className="icon-btn" onClick={() => removeItem(item.localId)} disabled={uploading}>
              ✕
            </button>
          </article>
        ))}
      </section>

      <button className="btn-primary" onClick={() => void uploadAll()} disabled={queue.length === 0 || uploading}>
        Upload {queue.length} Receipts
      </button>

      {completeSummary ? (
        <section className="success-card">
          <h3>✅ {completeSummary.count} receipts scanned!</h3>
          <p>Total found: {formatMoney(completeSummary.total)}</p>
          <div className="pill-row">
            {completeSummary.categories.map((category) => (
              <span className="pill" key={category}>
                {category}
              </span>
            ))}
          </div>
          <div className="row gap-12">
            <Link href="/receipts" className="btn-primary">
              View My Receipts
            </Link>
            <button className="btn-outline" onClick={() => setQueue([])}>
              Upload More
            </button>
          </div>
        </section>
      ) : null}

      <section className="card tips">
        <h3>Tips for best results:</h3>
        <ul>
          <li>📷 Make sure the receipt is fully in frame</li>
          <li>💡 Good lighting, avoid shadows</li>
          <li>📄 Flatten crumpled receipts before photographing</li>
          <li>🔍 Higher resolution photos work better</li>
        </ul>
      </section>
    </div>
  );
}
