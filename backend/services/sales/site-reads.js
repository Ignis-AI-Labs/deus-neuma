// site-reads — reading the sites of one audience's gathered companies, and keeping what was read.
//
// The sales seat's act (sales/read-sites) and the operator's press (READ THE SITES on an audience's
// companies) are this one function: the next companies of the audience that were gathered, not yet
// scored and not yet read, the most visited first, read by company-reader.js and kept with the
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
export const readAudienceSites = async (wallet, segmentId, { count = 30, by, fetchPage, signal, onProgress } = {}) => {
  const want = Math.min(Math.max(parseInt(count, 10) || 30, 1), READ_MAX);
  const unread = (await readCandidates(wallet)).filter((c) => c.segmentId === segmentId && c.state === 'waiting' && !c.site)
    .sort((a, b) => Number(!a.trafficRank) - Number(!b.trafficRank) || (a.trafficRank ?? 0) - (b.trafficRank ?? 0));
  if (!unread.length) return { ok: false, reason: 'every company gathered for this audience and not yet scored has already been read' };
  const read = await readSites(unread.slice(0, want).map((c) => c.domain), { ...(fetchPage ? { fetchPage } : {}), ...(onProgress ? { onProgress } : {}), signal });
  await noteSites(wallet, read, by);
  return { ok: true, read, left: Math.max(0, unread.length - read.length) };
};
