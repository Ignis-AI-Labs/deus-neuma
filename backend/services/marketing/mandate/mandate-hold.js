// mandate-hold — the pure law of a HOLD (ruling, 2026-10-24): text from
// outside that is shaped like an attack ([…]) and that the CMO READ does not pause the whole mandate. It alerts
// the operator and waits on them: whatever the CMO would do in answer to it
// or drawn from it is NOT covered — it is staged as an ordinary card — and the
// rest of the mandate keeps running.
//
// What "drawn from it" can honestly be traced to, from the data a sighting
// carries, is three things — the narrowest units we can name:
//   · the chat that read it (laneId + sessionId): the text sits in that
//     chat's context from then on, so every act staged from that chat waits;
//   · the posts named in that read (status links, long numeric ids): a reply
//     to any of them waits, from any chat;
//   · the links in that read: a post whose words carry one of them waits.
// What it cannot trace: a paraphrase carried into another chat by memory.
//
// Every function here is pure.

const URL_RE = /https?:\/\/[^\s"'<>()[\]{}]+/gi;
const STATUS_ID_RE = /\/status(?:es)?\/(\d{1,40})/gi;
// X post ids are 18–19 digit snowflakes; shorter digit runs are dates, counts.
const BARE_ID_RE = /\b\d{6,40}\b/g;
const KEPT = 40;

const trimUrl = (url) => url.replace(/[.,;:!?'"]+$/, '').toLowerCase();

/** The links a text carries, normalized. Pure. */
export const linksIn = (text) => [...new Set((String(text || '').match(URL_RE) || []).map(trimUrl))].slice(0, KEPT);

/** The post ids a text names (status links and long numeric ids). Pure. */
export const postIdsIn = (text) => {
  const raw = String(text || '');
  const ids = [...raw.matchAll(STATUS_ID_RE)].map((m) => m[1]);
  return [...new Set([...ids, ...(raw.match(BARE_ID_RE) || [])])].slice(0, KEPT);
};

/**
 * The hold one sighting raises. Pure.
 * @param {{id: string, at: string, mandateId: string, laneId: string, sessionId?: ?string,
 *   kind: string, source: string, origin: string, text: string, postId?: ?string}} s
 */
export const holdFromSighting = ({ id, at, mandateId, laneId, sessionId = null, kind, source, origin, text, postId = null }) => Object.freeze({
  id,
  at,
  mandateId,
  laneId,
  sessionId: sessionId || null,
  kind,
  source,
  origin,
  postIds: Object.freeze([...new Set([...(postId ? [String(postId)] : []), ...postIdsIn(text)])]),
  links: Object.freeze(linksIn(text)),
  status: 'open',
});

/**
 * The open hold an act falls under, or null. Pure.
 * @param {object[]} holds - the house's holds
 * @param {{laneId: string, sessionId?: ?string, postId?: ?string, text?: string}} act
 *   postId — the post a reply answers; text — the act's own words, before link tracking
 */
export const heldBy = (holds, { laneId, sessionId = null, postId = null, text = '' }) => {
  const mine = (holds || []).filter((h) => h.status === 'open' && h.laneId === laneId);
  if (!mine.length) return null;
  const links = linksIn(text);
  return mine.find((h) => (sessionId && h.sessionId === sessionId)
    || (postId && h.postIds.includes(String(postId)))
    || links.some((l) => h.links.includes(l))) || null;
};

/** Why an act was held, in the words the seat and the operator read. Pure. */
export const heldWhy = (hold) =>
  `hostile text in ${hold.origin} — what is drawn from it waits on your operator`;

/** One open hold as a WAITING ON YOU row: it waits on the operator's CLEAR; `door` is what it holds (mandate-sources.js). Pure. */
export const holdWaitingItem = (hold, { seatName = null, door = null } = {}) => (hold?.status === 'open' ? {
  id: `mandate-hold:${hold.id}`,
  kind: 'mandate',
  title: `Hostile text reached your CMO in ${hold.origin} — anything drawn from it waits on you`.slice(0, 200),
  who: { laneId: hold.laneId, name: seatName || hold.laneId },
  where: { app: 'marketing' },
  door,
  at: hold.at,
} : null);
