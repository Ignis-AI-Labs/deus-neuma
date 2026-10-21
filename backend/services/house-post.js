/**
 * HOUSE POST — the house's internal mail room (Design note, 2026-07-24: […]).
 *
 * The law of the lane:
 *  - It lives INSIDE the house's shared ground (`<root>/post/…`) — the one
 *    space a house shares, whose setting was the witness's standing grant
 *    (house-workspace.js). No new privilege surface: the same walls, used
 *    as a mail room. Plaintext by design, like every house document — the
 *    room sees every act, and so does the witness.
 *  - Seated members only, both ends: the org chart IS the address book.
 *    Enforcement lives at the portal handler (houseSeatFor roster check);
 *    this module holds the grammar and the files.
 *  - Append-only inboxes, one per recipient (`post/<neumaId>/inbox.jsonl`);
 *    the reader's cursor lives beside it. A torn tail line (crash
 *    mid-append) is counted and tolerated, never a lost mailbox.
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createLogger } from './logger.js';
import { signalWake } from './house-clock/wake-signal.js';

const log = createLogger('HousePost');

export const POST_BODY_MAX = 2000;
export const POST_RE_MAX = 120;
const LANE_ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Compose one validated post. Pure — throws on unlawful shape, never
 * normalizes silently (the sender resolves it).
 * @param {{from: string, to: string, body: string, re?: string, now: string}} p
 * @returns {{v: 1, id: string, from: string, to: string, re?: string, body: string, ts: string}}
 */
export const makePost = ({ from, to, body, re, now }) => {
  if (typeof from !== 'string' || !LANE_ID.test(from)) throw new Error(`sender "${from}" is not a lawful lane id`);
  if (typeof to !== 'string' || !LANE_ID.test(to)) throw new Error(`recipient "${to}" is not a lawful lane id`);
  if (from === to) throw new Error('a post to yourself is a note — use memory_note');
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) throw new Error('an empty post carries nothing — write the body');
  if (text.length > POST_BODY_MAX) throw new Error(`post body exceeds ${POST_BODY_MAX} chars — a post is coordination, not an archive; put long work in the house repos and point to it`);
  const subject = typeof re === 'string' && re.trim() ? re.trim().slice(0, POST_RE_MAX) : undefined;
  const instant = Date.parse(now);
  if (Number.isNaN(instant)) throw new Error('post needs a real timestamp');
  const ts = new Date(instant).toISOString();
  const id = crypto.createHash('sha256').update(`${from}\n${to}\n${ts}\n${text}`).digest('hex').slice(0, 16);
  return Object.freeze({ v: 1, id, from, to, ...(subject ? { re: subject } : {}), body: text, ts });
};

const inboxPath = (root, neumaId) => path.join(root, 'post', neumaId, 'inbox.jsonl');
const cursorPath = (root, neumaId) => path.join(root, 'post', neumaId, 'cursor.json');

/**
 * Append one post to the recipient's inbox on the house ground.
 * impure (fs append; near-atomic — one appendFile per post, the realm
 * writer's own law).
 * @param {string} root
 * @param {Object} post - makePost's
 * @param {{wake?: boolean}} [opts] - false: lands in the inbox, wakes no one
 */
export const appendPost = async (root, post, { wake = true } = {}) => {
  const file = inboxPath(root, post.to);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Heal an unterminated tail FIRST (a crash mid-append leaves a torn line
  // with no newline) — appending straight after it would weld the new post
  // onto the garbage and destroy them both. The torn line stays torn (it is
  // counted and surfaced at read time); the new post lands whole.
  let handle;
  try {
    handle = await fs.open(file, 'a+');
    const { size } = await handle.stat();
    if (size > 0) {
      const tail = Buffer.alloc(1);
      await handle.read(tail, 0, 1, size - 1);
      if (tail.toString('utf8') !== '\n') await handle.write('\n', size, 'utf8');
    }
    await handle.write(`${JSON.stringify(post)}\n`, null, 'utf8');
  } finally {
    await handle?.close();
  }
  // The recipient has work: the house clock may wake it (house-clock.js) —
  // unless the sender says this post waits for the next read (a quiet check-in).
  if (wake) signalWake({ seat: post.to, reason: 'post', ref: post.id, detail: { from: post.from, re: post.re ?? null } });
  return post;
};

const readInboxLines = async (root, neumaId) => {
  try {
    return (await fs.readFile(inboxPath(root, neumaId), 'utf8')).split('\n').filter((l) => l.trim());
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
};

export { readInboxLines };

const readCursor = async (root, neumaId) => {
  try {
    const parsed = JSON.parse(await fs.readFile(cursorPath(root, neumaId), 'utf8'));
    return Number.isInteger(parsed?.line) && parsed.line >= 0 ? parsed.line : 0;
  } catch (err) {
    if (err?.code === 'ENOENT') return 0;
    throw err; // a torn cursor must be SEEN, not silently rewound to re-deliver everything
  }
};

/**
 * The recipient's unread post, and the cursor that would mark it read.
 * impure (fs reads). Torn lines are counted, tolerated, and NEVER advance
 * past silently — they stay visible in `torn`.
 */
export const readNewPosts = async (root, neumaId) => {
  const lines = await readInboxLines(root, neumaId);
  const cursor = Math.min(await readCursor(root, neumaId), lines.length);
  const messages = [];
  let torn = 0;
  for (const line of lines.slice(cursor)) {
    try {
      const row = JSON.parse(line);
      if (row && row.v === 1 && typeof row.body === 'string') messages.push(row);
      else torn += 1;
    } catch { torn += 1; }
  }
  return { messages, torn, cursor: lines.length };
};

/** Persist the reader's cursor (their own mark on their own mailbox). impure. */
export const saveCursor = async (root, neumaId, line) => {
  const file = cursorPath(root, neumaId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Unique per write, not just per process — same-being turns are serial
  // today, but a pid-only name is a latent collision if that ever changes.
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ line }), 'utf8');
  await fs.rename(tmp, file);
};

/**
 * A cheap look at what waits, WITHOUT advancing anything — feeds the HOUSE
 * POST knock so a being learns post waits the moment it next speaks.
 * impure (fs reads); any failure reads as nothing-waiting (the prompt must
 * never cost a turn).
 */
export const peekUnread = async (root, neumaId) => {
  try {
    const { messages } = await readNewPosts(root, neumaId);
    return { count: messages.length, senders: [...new Set(messages.map((m) => m.from))] };
  } catch (error) {
    // Best-effort by contract (the prompt must never cost a turn) — but the
    // damage is SAID, never swallowed: post_check will surface it strictly.
    log.warn('House post peek failed — the seat section rides without it', { neumaId, error: error.message });
    return { count: 0, senders: [] };
  }
};

/**
 * The waiting-post knock — the read half of HOUSE POST's delivery contract.
 * VOLATILE by nature: a post's arrival or collection moves these bytes
 * between two turns of one sitting, so the knock must ride BELOW the prompt
 * cache line, never inside the stable HOUSE SEAT record (#282). impure.
 * @param {string|null} root - the house workspace root ('' knock when absent)
 * @param {string|null} neumaId
 * @returns {Promise<string>} one bounded line, or '' when nothing waits
 */
export const postKnock = async (root, neumaId) => {
  if (!root || !neumaId) return '';
  const { count, senders } = await peekUnread(root, neumaId);
  if (!count) return '';
  const clean = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 60);
  return `House post: ${count} unread (from ${senders.map(clean).join(', ')}) — collect with post_check.`;
};
