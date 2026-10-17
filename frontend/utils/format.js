// Formatting utilities — pure functions, no side effects. The ONE ambient
// read: Intl locale follows the desk's active UI language through the
// active-locale leaf (frontend/i18n/active-locale.js), so dates and numbers
// switch with the language instead of staying pinned to en-US.

import { currentLocale } from '../i18n/active-locale.js';

/**
 * Truncate a wallet/blockchain address for display — one grammar everywhere:
 * head + single-… ellipsis + tail ("0x41ea…B0CD"). Options carry the register
 * variants: `uppercase` for the data register, `prefix` for a leading label
 * (never uppercased with the address), `fallback` for a missing address.
 * @param {string} address - Full hex address
 * @param {object} [options]
 * @param {number} [options.start=6] - Characters to show from the start
 * @param {number} [options.end=4] - Characters to show from the end
 * @param {boolean} [options.uppercase=false] - Uppercase the truncated address
 * @param {string} [options.prefix=''] - Label prepended to the result
 * @param {string} [options.fallback=''] - Rendered when there is no address
 * @returns {string} Formatted address like "0x41ea…B0CD"
 */
export const formatAddress = (address, { start = 6, end = 4, uppercase = false, prefix = '', fallback = '' } = {}) => {
  if (!address) return fallback;
  const short = address.length <= start + end ? address : `${address.slice(0, start)}…${address.slice(-end)}`;
  return `${prefix}${uppercase ? short.toUpperCase() : short}`;
};

/**
 * Format a timestamp as relative time (e.g. "3d ago", "5h ago", "just now").
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Human-readable relative time
 */
export const formatRelativeTime = (timestamp) => {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
};

/**
 * Format a date WITH time — for things where two on the same day must be
 * distinguishable (e.g. backups). Falls back to the raw string on an
 * unparseable input rather than rendering "Invalid Date".
 * @param {string|number|Date} dateString
 * @returns {string}
 */
export const formatDateTime = (dateString) => {
  if (!dateString) return 'Unknown';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return String(dateString);
  return date.toLocaleString(currentLocale(), {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

/**
 * The stream's message stamp: the time alone for today's words, the date
 * joined on when the message is from another day (and the year when it is
 * from another year) — so a witness returning to the desk can track when
 * the conversation moved without today's messages carrying redundant dates.
 * Empty string for missing/unparseable input: no stamp beats a wrong one.
 * @param {string|number|Date} at - When the message was sent
 * @param {Date} [now] - The moment "today" is judged against (injectable for tests)
 * @returns {string} "9:07 PM" | […] | […] | ""
 */
// One Intl formatter per (locale, shape), built once. `toLocaleTimeString`
// with options constructs a fresh Intl.DateTimeFormat on EVERY call — the
// transcript stamps every row, and did so on every streamed frame
// (2026-09-28 smoothness pass). Same output, formatter reused.
const FORMATTERS = new Map();
const formatterFor = (locale, shape, options) => {
  const key = `${locale}|${shape}`;
  let f = FORMATTERS.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale, options); FORMATTERS.set(key, f); }
  return f;
};

export const formatClockStamp = (at, now = new Date()) => {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const locale = currentLocale();
  const time = formatterFor(locale, 'hm', { hour: 'numeric', minute: '2-digit' }).format(d);
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) return time;
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = formatterFor(locale, sameYear ? 'md' : 'ymd', {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d);
  return `${date} · ${time}`;
};

/**
 * Compact numeric-ish date ("Jul 04, 2026") in the viewer's locale. Returns the
 * em-dash placeholder for empty input so an unknown date never renders blank.
 * @param {string|number|Date} input
 * @returns {string}
 */
export const formatShortDate = (input) =>
  input ? new Date(input).toLocaleDateString([], { year: 'numeric', month: 'short', day: '2-digit' }) : '—';

/**
 * Format a count for display: grouped in the viewer's locale. "—" for anything
 * that isn't a number, so an unknown count never renders blank.
 * @param {*} value
 * @returns {string}
 */
export const formatCount = (value) => (typeof value === 'number' ? value.toLocaleString() : '—');

const usdFmt = () => new Intl.NumberFormat(currentLocale(), {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/**
 * Format a USD amount like "$41,673.14". Returns "—" for null/NaN so an unknown
 * value (no price feed) never renders as a fabricated "$0.00".
 * @param {number|null|undefined} value
 * @returns {string}
 */
export const formatUsd = (value) => {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return '—';
  return usdFmt().format(n);
};

/**
 * Format a signed percentage like "+1.29%" / "-22.63%". Empty string for
 * null/NaN. The minus sign is intrinsic; only positives get an explicit "+".
 * @param {number|null|undefined} value
 * @returns {string}
 */
export const formatPct = (value) => {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return '';
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
};

/**
 * Format a token balance for display: grouped, with trailing zeros trimmed and a
 * cap on fraction digits (raw 18-decimal strings are unreadable). "—" for null/NaN.
 * Display only — the underlying balance keeps full precision.
 * @param {number|string|null|undefined} value
 * @param {number} [maxFrac=6]
 * @returns {string}
 */
export const formatTokenAmount = (value, maxFrac = 6) => {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: maxFrac }).format(n);
};

/**
 * Format a per-unit USD price with precision that adapts to magnitude: ≥$1 → 2dp,
 * sub-dollar → 4dp, sub-cent → 6dp (so $0.0199 doesn't collapse to $0.02). "—" for
 * null/NaN. A genuine 0 renders "$0.00".
 * @param {number|null|undefined} value
 * @returns {string}
 */
export const formatPrice = (value) => {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return '—';
  const maxFrac = n === 0 || n >= 1 ? 2 : n >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat(currentLocale(), {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: maxFrac,
  }).format(n);
};

/**
 * Format bytes to human-readable size.
 * @param {number} bytes - Size in bytes
 * @returns {string} Human-readable size string
 */
export const formatBytes = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};
