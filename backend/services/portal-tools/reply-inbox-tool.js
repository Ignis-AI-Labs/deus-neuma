/**
 * replies_list — the being's read of the house's REPLY INBOX (ruling, 2026-10-13).
 *
 * read_x {what:'mentions'} reads X live and hands back only its newest window, so a being
 * asked to work 340 replies saw five and could not page back ([…]). This reads the house's own record of every reply
 * — the store the listener lands — sorted into the buckets the desk shows (core/social/
 * reply-inbox.js): unanswered by default, newest first, paged, each row whole.
 *
 * A local read of the house's own record: no egress, no change to anything.
 */
import { houseEntries } from '../social/queue-house.js';
import { replyCandidatesOf, replyInboxRows, REPLY_CATEGORIES } from '../social/reply-candidates.js';
import { selectReplyInbox, REPLY_BUCKETS, INBOX_PAGE } from '../../../core/social/reply-inbox.js';
import { frameUntrustedSections } from '../untrusted-content.js';
import { TOOL_RESULT_MAX_CHARS } from '../tool-exchange.js';

// The listing fits itself in WHOLE replies (the read-window law social-read-tools keeps).
const READ_WINDOW = TOOL_RESULT_MAX_CHARS - 120;
const TEXT_BOUND = 1000;

export const REPLIES_LIST_TOOL = Object.freeze({
  name: 'replies_list',
  server: 'social',
  description: `Work the house's reply inbox — every reply to the house's posts on X that the house has on record, sorted so you never wade through what is already dealt with. Every arg optional: {bucket?, order?, category?, substance?, q?, offset?, limit?}. bucket: unanswered (default — nobody has answered or set it aside) | staged (an answer waits for your operator) | answered (the answer went out) | bin (set aside — never knocks again) | all, or several comma-separated. order: newest (default) | oldest. category: ${REPLY_CATEGORIES.join(' | ')}. substance: substantive | low-effort. q searches the words and the handle. Each reply comes whole with its post id, who wrote it, which house post it answers, and the house's answer to it if one stands. Every page that has more names the exact next call. Answer one with queue_reply_to_x; put one in the bin with reply_dismiss_to_x.`,
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      bucket: Object.freeze({ type: 'string', description: `${REPLY_BUCKETS.join(' | ')} | all — or several, comma-separated (default unanswered)` }),
      order: Object.freeze({ type: 'string', enum: Object.freeze(['newest', 'oldest']), description: 'newest (default) | oldest' }),
      category: Object.freeze({ type: 'string', description: `Only replies the escalation read marked: ${REPLY_CATEGORIES.join(' | ')} (comma-separated for several)` }),
      substance: Object.freeze({ type: 'string', enum: Object.freeze(['substantive', 'low-effort']), description: 'substantive | low-effort' }),
      q: Object.freeze({ type: 'string', description: 'Only replies whose words or handle contain this (case-insensitive)' }),
      offset: Object.freeze({ type: 'number', description: 'Skip this many — how you page' }),
      limit: Object.freeze({ type: 'number', description: `How many to ask for (default ${INBOX_PAGE.default}, max ${INBOX_PAGE.max}); the answer holds as many WHOLE replies as fit your window` }),
    }),
  }),
});

const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const STANDING = Object.freeze({ none: 'UNANSWERED', staged: 'ANSWER STAGED', approved: 'ANSWER APPROVED', sent: 'ANSWERED', dismissed: 'IN THE BIN' });

// One reply's identifiers and the house's own record of it — ours, so outside the frame.
const leadOf = (r) => [
  `reply ${r.postId}`,
  r.username ? `@${r.username}` : null,
  `verified ${r.verifiedType && r.verifiedType !== 'none' ? r.verifiedType : (r.verified ? 'yes' : 'no')}`,
  r.postCreatedAt || r.firstSeenAt || 'no-time',
  `https://x.com/i/status/${r.postId}`,
  r.inReplyToPostId ? `answering house post ${r.inReplyToPostId}` : null,
  r.substance || null,
  r.category && r.category !== 'ordinary' ? `NEEDS CARE: ${r.category}` : null,
  STANDING[r.disposition] || 'UNANSWERED',
  ...(r.answers || []).map((a) => `the house's answer [${a.id}] ${a.status}: "${flat(a.text)}"`),
  r.dismissed ? `set aside${r.dismissedBy ? ` by ${r.dismissedBy}` : ''}${r.reason ? ` (${flat(r.reason)})` : ''}` : null,
].filter(Boolean).join(' · ');

// The call that reads the next page, with every filter the being asked for carried along.
const nextCall = (args, offset) => {
  const keep = ['bucket', 'order', 'category', 'substance', 'q']
    .filter((k) => typeof args?.[k] === 'string' && args[k].trim())
    .map((k) => `${k}:${JSON.stringify(args[k].trim())}`);
  return `replies_list {${[...keep, `offset:${offset}`].join(', ')}}`;
};

/**
 * Render one page for the being's window. Pure given `token`.
 * @param {ReturnType<typeof selectReplyInbox>} page - an ok selection
 * @param {object} args - the being's ask (for the next-call line)
 * @param {{ budget?: number, token?: string }} [opts]
 * @returns {{ text: string, shown: number }}
 */
export const renderReplyInbox = (page, args, { budget = READ_WINDOW, token } = {}) => {
  const { counts, buckets, order, matched, offset, rows } = page;
  const tally = `Reply inbox: ${counts.unanswered} unanswered · ${counts.staged} staged · ${counts.answered} answered · ${counts.bin} in the bin (${counts.total} in all).`;
  const which = buckets.length === REPLY_BUCKETS.length ? 'in every bucket' : buckets.join(' + ');
  if (!rows.length) {
    return {
      text: `${tally}\n\n${matched ? `Nothing past ${offset} — ${matched} ${which} in all.` : `Nothing ${which} matches.`}`,
      shown: 0,
    };
  }
  const sections = rows.map((r) => {
    const raw = String(r.text || '');
    return { lead: leadOf(r), text: raw.length > TEXT_BOUND ? `${raw.slice(0, TEXT_BOUND)} …[truncated]` : raw };
  });
  const draw = (n) => {
    const end = offset + n;
    return [
      tally,
      `${which}, ${order} first — ${offset + 1}–${end} of ${matched}:`,
      frameUntrustedSections('replies to the house on X, from the house\'s own record', sections.slice(0, n), token),
      end < matched ? `…${matched - end} more. Next: ${nextCall(args, end)}` : `That is all ${matched}.`,
    ].join('\n\n');
  };
  let shown = rows.length;
  while (shown > 1 && draw(shown).length > budget) shown -= 1;
  return { text: draw(shown), shown };
};

/**
 * Read the record and answer the being. impure (the stores).
 * @param {Object} args
 * @param {?string} house - the being's house (its lane's owner): only its own replies are read
 * @returns {Promise<{ ok: true, text: string, summary: string } | { ok: false, error: string }>}
 */
export const readReplyInbox = async (args, house) => {
  const [candidates, queue] = await Promise.all([replyCandidatesOf(house).load(), houseEntries(house)]);
  const page = selectReplyInbox(replyInboxRows(candidates, queue), args || {}, { categories: REPLY_CATEGORIES });
  if (!page.ok) return page;
  const drawn = renderReplyInbox(page, args);
  return {
    ok: true,
    text: drawn.text,
    summary: `${drawn.shown} of ${page.matched}${page.buckets.length === REPLY_BUCKETS.length ? '' : ` ${page.buckets.join('+')}`} replies`,
  };
};
