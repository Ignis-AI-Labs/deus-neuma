// site-reads — reading the sites of one audience's gathered companies, and keeping what was read.
//
// The sales seat's act (sales/read-sites) and the operator's press (READ THE SITES on an audience's
// companies) are this one function: the next companies of the audience that were gathered, not yet
// scored and not yet read — the shortlisted first (the pipeline's VERIFY follows its FILTER), the
// seat's act reading only those — read by company-reader.js and kept with the
// candidate (sales-store.js). A company that could not be read is kept as that, with why, so it
// is never read twice and is shown as a dead end. impure — network and the revenue office's files.

import { readCandidates, noteSites } from './sales-store.js';
import { readSites, READ_MAX } from './company-reader.js';

/**
 * @param {string} wallet
 * @param {string} segmentId
 * @param {{count?: number, by: string, fetchPage?: Function, signal?: AbortSignal, onProgress?: (words: string) => void}} opts
 * @returns {Promise<{ok: true, read: Array<{domain: string, site: object}>, left: number} | {ok: false, reason: string}>}
 */
export const readAudienceSites = async (wallet, segmentId, { count = 30, by, fetchPage, signal, onProgress, shortlistOnly = false } = {}) => {
  const want = Math.min(Math.max(parseInt(count, 10) || 30, 1), READ_MAX);
  const all = (await readCandidates(wallet)).filter((c) => c.segmentId === segmentId && c.state === 'waiting' && !c.siteRead && c.shortlist !== 'passed');
  // THE PIPELINE (lead-pipeline.js): VERIFY reads what FILTER kept — the shortlist, the most addresses at Hunter first.
  // The seat reads only that; the operator's press reads the shortlist first, then the rest, most visited first.
  const kept = all.filter((c) => c.shortlist === 'kept').sort((a, b) => (Number(b.hunterEmails?.total) || 0) - (Number(a.hunterEmails?.total) || 0));
  const rest = shortlistOnly ? [] : all.filter((c) => c.shortlist !== 'kept').sort((a, b) => Number(!a.trafficRank) - Number(!b.trafficRank) || (a.trafficRank ?? 0) - (b.trafficRank ?? 0));
  const unread = [...kept, ...rest];
  if (!unread.length) return { ok: false, reason: shortlistOnly && all.length ? 'THE PIPELINE: filter first — nothing on this audience\'s shortlist is unread. Narrow the pool to the most reasonable prospects with sales/shortlist, then read their sites' : 'every company gathered for this audience and not yet scored has already been read' };
  const read = await readSites(unread.slice(0, want).map((c) => c.domain), { ...(fetchPage ? { fetchPage } : {}), ...(onProgress ? { onProgress } : {}), signal });
  await noteSites(wallet, read, by);
  return { ok: true, read, left: Math.max(0, unread.length - read.length) };
};
