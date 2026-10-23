// tiktok-account-view.js — the pure reading of the TIKTOK window's account
// view (TikTokAccount.jsx): counts in the short form TikTok's own app uses,
// dates and lengths, the relay path a TikTok picture travels, and each
// video's share of the most-watched one. A reading TikTok did not give is a
// dash, never a drawn zero (SHINKEI).

const RELAY = '/api/v1/social-channels/tiktok/image';

const STEPS = Object.freeze([[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]);

/**
 * 1234 → "1.2K", 12345 → "12K", 1500000 → "1.5M"; below 1000 the number
 * itself; null → "—". One decimal under ten of a unit, none above. Pure.
 * @param {number|null|undefined} n
 * @returns {string}
 */
export const formatCount = (n) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const step = STEPS.find(([size]) => Math.abs(v) >= size);
  if (!step) return String(Math.round(v));
  const [size, unit] = step;
  const scaled = v / size;
  const shown = Math.abs(scaled) < 10 ? Math.floor(scaled * 10) / 10 : Math.floor(scaled);
  return `${String(shown).replace(/\.0$/, '')}${unit}`;
};

/**
 * The full number for a tooltip: "12,345 followers"; null → "not readable". Pure.
 * @param {number|null} n
 * @param {string} noun
 */
export const exactCount = (n, noun) => (n === null || n === undefined ? `${noun}: not readable yet` : `${Number(n).toLocaleString('en-US')} ${noun}`);

/**
 * A video's length: 75 → "1:15"; null → "—". Pure.
 * @param {number|null} sec
 */
export const durationLabel = (sec) => {
  if (sec === null || sec === undefined || !Number.isFinite(Number(sec))) return '—';
  const s = Math.max(0, Math.round(Number(sec)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * When a video went up, as a calendar date in the reader's locale; null → "—". Pure.
 * @param {string|null} iso
 */
export const postedLabel = (iso) => {
  const at = Date.parse(iso || '');
  return Number.isFinite(at) ? new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
};

/**
 * The desk path a TikTok picture is fetched through, or null when there is
 * no picture. Pure.
 * @param {string|null} url
 */
export const relayedImage = (url) => (url ? `${RELAY}?src=${encodeURIComponent(url)}` : null);

/**
 * Each video's views as a share of the most-watched video in the list
 * (0..1), or null when TikTok gave no view count. Pure.
 * @param {Array<{counts: {views: number|null}}>} videos
 * @returns {Array<number|null>}
 */
export const viewShares = (videos) => {
  const max = Math.max(0, ...videos.map((v) => v.counts.views ?? 0));
  return videos.map((v) => (v.counts.views === null ? null : max > 0 ? v.counts.views / max : 0));
};
