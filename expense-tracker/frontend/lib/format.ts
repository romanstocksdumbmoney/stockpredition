import { format, parseISO } from "date-fns";

export function formatMoney(value: number | null | undefined, currency = "USD"): string {
  const amount = Number.isFinite(value) ? Number(value) : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(value: string | null | undefined, pattern = "MMM d, yyyy"): string {
  if (!value) {
    return "-";
  }
  try {
    return format(parseISO(value), pattern);
  } catch {
    return value;
  }
}

export function initials(name: string | null | undefined, fallback = "ET"): string {
  if (!name) {
    return fallback;
  }
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return fallback;
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function relativeTime(input: string | null | undefined): string {
  if (!input) {
    return "Not scanned yet";
  }
  const value = new Date(input).getTime();
  if (Number.isNaN(value)) {
    return input;
  }
  const diffMs = Date.now() - value;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
