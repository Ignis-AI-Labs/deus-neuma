// overview-words.js — how the MARKETING overview says its numbers. Pure.
// SHINKEI: a value nobody reported is "—", never a drawn zero. A status is
// named by the one table every surface reads (post-status-marks.js).

import { statusMark } from '../post-status-marks.js';

/** A count, compact (4.1K, 2.3M), or "—" when unreported. */
export const num = (v) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)}K`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
};

/** A part of a whole as a percentage, or "—". */
export const pct = (r) => (r === null || r === undefined || !Number.isFinite(r) ? '—' : `${Math.round(r * 100)}%`);

/** The mark one account draws on the grid, and the words its title carries. */
export const MARK = Object.freeze({
  clear: Object.freeze({ glyph: '●', words: 'in use and clear' }),
  failing: Object.freeze({ glyph: '◐', words: 'in use and failing the house check' }),
  idle: Object.freeze({ glyph: '○', words: 'not in use (no keys, holder or active campaign)' }),
});

/** The filter a view is showing, in words (JŌHŌ SEKKEI: the view says what it shows). */
export const filterWords = (filter) => [
  filter.status ? statusMark(filter.status).name : null,
  filter.group ? 'IN A GROUP' : null,
  filter.legal ? 'LEGAL MARK' : null,
  filter.accountIds ? `${filter.accountIds.length} ACCOUNT${filter.accountIds.length === 1 ? '' : 'S'}` : null,
  filter.angle ? `ANGLE ${String(filter.angle).toUpperCase()}` : null,
].filter(Boolean).join(' · ');

/** Why a metric is "—" for a post: the account's own reason, else the platform's. */
export const whyAbsent = (entry, results) => {
  const accountId = entry.accountId || `${entry.channelId}-1`;
  const own = results?.unavailable?.[accountId]?.reason;
  if (own) return own;
  if (entry.status !== 'sent') return 'not sent yet';
  if (!results?.posts?.[entry.id]) return 'not read yet — the sweep reads new posts every 6 hours';
  return results?.capability?.[entry.channelId]?.why || 'the platform did not report it';
};
