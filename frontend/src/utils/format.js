export function formatINR(paise) {
  if (paise == null || Number.isNaN(Number(paise))) {
    return "₹0";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(paise) / 100);
}

export function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "0%";
  }

  return `${Number(value)}%`;
}

export function parseApiDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  let raw = String(value).trim();
  if (!raw) return null;

  // Python isoformat() often has 6-digit microseconds. Browsers can
  // mis-parse that and show a wrong clock time.
  raw = raw.replace(/(\.\d{3})\d+/, "$1");
  raw = raw.replace(" ", "T");

  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && !hasZone) {
    raw = `${raw}Z`;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value) {
  const date = parseApiDate(value);
  if (!date) return "—";

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value) {
  const date = parseApiDate(value);
  if (!date) return "—";

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

const PAYMENT_URL_PATTERN = /https?:\/\/[^\s<>"']+/i;

export function extractPaymentLink(text) {
  if (!text) return null;
  const match = String(text).match(PAYMENT_URL_PATTERN);
  if (!match) return null;
  return match[0].replace(/[.,)]+$/, "");
}

export function formatRelativeTime(value) {
  const date = parseApiDate(value);
  if (!date) return "—";

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHour = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHour / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return formatDate(value);
}
