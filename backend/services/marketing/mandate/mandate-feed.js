// mandate-feed — DONE FOR YOU: every act the CMO's mandate made, where, when,
// and where it stands now (a link when it is live, CANCEL while it has not
// left), beside the mandate's own events (granted, paused, withdrawn…). The
// journal says what was done; the queue says what became of it.
//
// feedRows is pure; readMandateView is the desk's one call (impure).

import { houseEntries } from '../../social/queue-house.js';
import { listAccounts } from '../../social/account-store.js';
import { listCompanies } from '../companies.js';
import { cmoDesignation } from '../cmo-designation.js';
import { laneName } from '../../house-titles.js';
import { houseKey } from '../../staff/cos-designation.js';
import { mandateStanding, NEVER_MARKS, HOLD_WORDS, PER_POST_CONSENT_CHANNELS, TRIPS, MAX_DAYS } from './mandate-shape.js';
import { readMandateRecord, readMandateJournal } from './mandate-store.js';
import { readHolds } from './mandate-hold-store.js';
import { pauseSource, holdSource } from './mandate-sources.js';

const ACT_WORDS = Object.freeze({ post: 'Posted', reply: 'Answered a reply', image: 'Made an image', video: 'Made a video' });
const EVENT_WORDS = Object.freeze({
  granted: 'You granted the mandate',
  withdrawn: 'You withdrew the mandate',
  resumed: 'You resumed the mandate',
  renewed: 'You renewed the mandate',
  tripped: 'The mandate paused',
  held: 'Hostile text held — what is drawn from it waits on you',
  cleared: 'You cleared a hold',
});

// pure — where a live post can be opened, when the record knows.
const linkOf = (entry) => {
  if (!entry || entry.status !== 'sent') return null;
  if (entry.permalink || entry.url) return entry.permalink || entry.url;
  if (entry.channelId === 'x' && entry.postId) return `https://x.com/i/web/status/${entry.postId}`;
  return null;
};

/**
 * The feed, newest first: one row per act (joined to its queue entry) and
 * one per mandate event. Send outcomes fold into their act's row. Pure.
 * @param {object[]} journal - newest first
 * @param {object[]} entries - the house's queue
 */
export const feedRows = (journal, entries) => {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const rows = [];
  for (const line of journal) {
    if (line.kind === 'act') {
      const entry = line.queueId ? byId.get(line.queueId) : null;
      rows.push({
        id: `${line.at}:${line.queueId || line.act}`,
        at: line.at,
        kind: 'act',
        what: ACT_WORDS[line.act] || line.act,
        where: line.accountId ? `${line.channelId} · ${line.accountId}` : null,
        text: line.text || '',
        status: entry ? entry.status : (line.queueId ? 'gone' : 'done'),
        link: linkOf(entry),
        queueId: line.queueId || null,
        canCancel: entry?.status === 'approved',
        error: entry?.status === 'failed' ? entry.error || null : null,
      });
    } else if (EVENT_WORDS[line.kind]) {
      const detail = line.kind === 'tripped' ? (line.reason || TRIPS[line.trip] || '')
        : line.kind === 'held' || line.kind === 'cleared' ? `from ${line.origin || 'what the CMO read'}`
        : line.kind === 'withdrawn' ? `${(line.cancelled || []).length} queued post(s) cancelled${(line.inFlight || []).length ? `, ${line.inFlight.length} already leaving` : ''}`
          : '';
      rows.push({ id: `${line.at}:${line.kind}`, at: line.at, kind: 'event', what: EVENT_WORDS[line.kind], text: detail, status: line.kind });
    }
  }
  return rows;
};

/**
 * Everything the desk shows about the house's mandate, in one read: where
 * it stands, the accounts and companies a grant may name, and
 * the DONE FOR YOU feed. impure.
 * @param {string} wallet
 */
export const readMandateView = async (wallet) => {
  const house = houseKey(wallet);
  if (!house) return { standing: 'none', mandate: null, seat: null, accounts: [], companies: [], feed: [], holds: [], never: NEVER_MARKS, trips: TRIPS, holdWords: HOLD_WORDS };
  const [record, officer, accounts, companies, journal, entries, holds] = await Promise.all([
    readMandateRecord(house),
    cmoDesignation.getOfficer(house).catch(() => null),
    listAccounts(house).catch(() => []),
    listCompanies(house).catch(() => []),
    readMandateJournal(house),
    houseEntries(house).catch(() => []),
    readHolds(house, { pending: false }),
  ]);
  const seatName = officer?.laneId ? await laneName(officer.laneId).catch(() => officer.laneId) : null;
  const mandate = record.current;
  return {
    standing: mandateStanding(mandate),
    mandate,
    seat: officer?.laneId ? { laneId: officer.laneId, name: seatName } : null,
    accounts: accounts.map((a) => ({
      id: a.id, channelId: a.channelId, channelName: a.channelName, companyId: a.companyId, label: a.label,
      configured: a.configured, perPostConsent: PER_POST_CONSENT_CHANNELS.includes(a.channelId),
    })),
    companies: companies.map((c) => ({ id: c.id, name: c.name })),
    feed: feedRows(journal, entries),
    // Each with its door to what tripped it or what it holds (mandate-sources.js), from this house's own queue.
    pauseDoor: pauseSource(mandate, entries),
    holds: holds.filter((h) => h.status === 'open').map((h) => ({ id: h.id, at: h.at, origin: h.origin, source: h.source, door: holdSource(h, entries) })),
    maxDays: MAX_DAYS,
    // The screen draws these as marks, each named on hover (show-dont-tell-audit.md findings 4, 6).
    never: NEVER_MARKS,
    trips: TRIPS,
    holdWords: HOLD_WORDS,
  };
};
