// money-in-view.js — the MONEY IN panel's pure display law: what the house
// received this week, this month and ever, per asset and per member, with
// every receipt that has no price COUNTED apart (never silently left out of a
// total), the latest receipts, and who is not watched and why.
//
// Receive-only by construction: nothing here can describe a send.
//
// Pure — no React, no DOM, no fetch.

import { formatAddress, formatDateTime } from '../../../utils/format.js';

const DAY_MS = 86_400_000;

/**
 * The starts of this week (Monday, UTC) and this month (UTC) — the same
 * buckets the server's totalsByPeriod uses, so the two never disagree. Pure.
 * @param {number} now - epoch ms
 * @returns {{week: string, month: string}} ISO instants
 */
export const periodStarts = (now) => {
  const d = new Date(now);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return {
    week: new Date(day - ((d.getUTCDay() + 6) % 7) * DAY_MS).toISOString(),
    month: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(),
  };
};

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A dollar figure. Pure. */
export const formatUsd = (n) => USD.format(Number.isFinite(n) ? n : 0);

const NETWORKS = Object.freeze({ ethereum: 'ETHEREUM', base: 'BASE' });
const networkWord = (id) => NETWORKS[id] || String(id || '').toUpperCase();

/**
 * One period's total as one line: dollars, how many receipts, and how many of
 * them have no price (counted, never dropped). Pure.
 * @param {?{usdTotal: number, count: number, unpriced: number, internalExcluded?: number}} summary
 */
export const totalLine = (summary) => {
  if (!summary) return '—';
  const count = `${summary.count} RECEIPT${summary.count === 1 ? '' : 'S'}`;
  const unpriced = summary.unpriced ? ` · ${summary.unpriced} UNPRICED (NOT IN THE $)` : '';
  return `${formatUsd(summary.usdTotal)} · ${count}${unpriced}`;
};

/**
 * The per-asset rows of a summary. Pure.
 * @param {?{perAsset: Object}} summary
 * @returns {Array<{key: string, words: string, usd: string}>}
 */
export const assetLines = (summary) => Object.entries(summary?.perAsset ?? {}).map(([key, a]) => ({
  key,
  words: `${a.amount} ${a.asset} ON ${networkWord(a.network)} · ${a.count} RECEIPT${a.count === 1 ? '' : 'S'}`,
  usd: a.unpriced ? `${formatUsd(a.usd)} + ${a.unpriced} UNPRICED` : formatUsd(a.usd),
}));

/**
 * The per-member rows of a summary: which being (or declared address) it came to. Pure.
 * @param {?{perMember: Object}} summary
 * @param {Object<string,string>} names - lane id → display name
 */
export const memberLines = (summary, names) => Object.entries(summary?.perMember ?? {}).map(([key, m]) => ({
  key,
  who: (m.member && names?.[m.member]) || m.label || m.member || formatAddress(key.replace(/^address:/, '')),
  words: `${formatUsd(m.usd)} · ${m.count} RECEIPT${m.count === 1 ? '' : 'S'}`,
}));

/**
 * One receipt as one line. Pure.
 * @param {Object} r - a money-in ledger row
 * @param {Object<string,string>} names
 */
export const receiptLine = (r, names) => ({
  key: r.key,
  amount: `${r.amount} ${r.asset}`,
  usd: typeof r.usd === 'number' ? formatUsd(r.usd) : 'UNPRICED',
  detail: [
    networkWord(r.network),
    `TO ${(r.member && names?.[r.member]) || r.memberLabel || formatAddress(r.to)}`,
    `FROM ${formatAddress(r.from)}`,
    formatDateTime(r.timestamp),
    ...(r.internal ? ['HOUSE TO HOUSE — NOT COUNTED'] : []),
  ].join(' · '),
});

const SKIP_WORDS = Object.freeze({ unconfigured: 'NO RPC SET', 'rpc-unavailable': 'RPC UNREACHABLE' });

/**
 * The networks a scan did not fully read, and why, so a skipped network is
 * never mistaken for one that was read and held nothing. Pure.
 * @param {?Array<{network: string, skipped?: string, errors?: string[]}>} networks - per-network scan results
 * @returns {string[]} e.g. ['ETHEREUM — NO RPC SET', 'BASE — READ ERRORS']
 */
export const unreadNetworks = (networks) => (networks ?? []).flatMap((n) => {
  if (n.skipped) return [`${networkWord(n.network)} — ${SKIP_WORDS[n.skipped] || String(n.skipped).toUpperCase()}`];
  return n.errors?.length ? [`${networkWord(n.network)} — READ ERRORS`] : [];
});

const unreadClause = (networks) => {
  const unread = unreadNetworks(networks);
  return unread.length ? ` · NOT READ: ${unread.join(' · ')}` : '';
};

/**
 * What one scan-now did: which networks it read and how many new receipts —
 * never "scanned" when no network was read. Pure.
 * @param {{appended: number, watched?: number, networks?: Array<{network: string, skipped?: string, errors?: string[]}>}} result
 */
export const scanNote = (result) => {
  const networks = result?.networks ?? [];
  const read = networks.filter((n) => !n.skipped).map((n) => networkWord(n.network));
  if (!read.length) {
    return result?.watched === 0 ? 'NOTHING SCANNED — NO ADDRESS IS WATCHED' : `NOTHING SCANNED${unreadClause(networks)}`;
  }
  const count = `${result.appended} NEW RECEIPT${result.appended === 1 ? '' : 'S'}`;
  return `SCANNED ${read.join(' + ')} — ${count}${unreadClause(networks)}`;
};

/**
 * The watch set's summary line, naming any network the last scan did not read. Pure.
 * @param {?{watched: Object[], unwatched: Object[], lastScan: ?{at: string, networks?: Object[]}}} watch
 */
export const watchLine = (watch) => {
  if (!watch) return '—';
  const last = watch.lastScan?.at ? `LAST SCAN ${formatDateTime(watch.lastScan.at)}${unreadClause(watch.lastScan.networks)}` : 'NEVER SCANNED';
  return `${watch.watched?.length ?? 0} WATCHED · ${watch.unwatched?.length ?? 0} NOT WATCHED · ${last}`;
};

/** Where a watched address came from, in words. Pure. */
export const sourceWords = (source) => {
  if (source === 'soul-anchor') return 'its public soul address';
  if (source === 'operator') return 'declared by you';
  if (String(source || '').startsWith('founding-record')) return 'the house founding record';
  return String(source || '');
};
