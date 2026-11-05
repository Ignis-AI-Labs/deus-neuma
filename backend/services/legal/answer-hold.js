// THE HOLD — every legal answer the seated CLO gives, chat included, is held
// at the end of its turn if it carries what the app did not confirm (Founder,
// 2026-10-31): a citation no confirmed record covers, quotation marks around
// words no confirmed record quotes, or an unresolved [verify].
//
// The answer that taught the citation law was a chat answer: nothing stood
// between it and the operator. The answer has already streamed when its turn
// ends, so the hold cannot un-say it; it does three honest things instead:
//   1. a HELD chip in the stream, naming what is unconfirmed;
//   2. the CLO is sent back ONCE (platform-follow-up.js) to run
//      legal_cite_check and give the answer again;
//   3. if that answer still fails, an UNCHECKED chip with the failures, and a
//      card in the operator's tray. A passing re-answer earns a CHECKED chip.
//
// "Confirmed" means: a record the app re-read and found verified in THIS CHAT
// — through legal_cite_check, or a legal act that landed (act-review.js). A
// long working chat is not made to re-check, turn after turn, what the
// platform already read in it (Design note, 2026-11-04: the per-turn hold […]). Quotation marks around words the operator said in
// the chat quote the operator, not the law: they are not held.
// An answer with no citation, no section sign and no mark is not a legal
// answer to hold. A wake turn (the house clock) is not held: no chat waits on it.

import { squeeze, unresolvedMarks, unboundQuotes, quoteSegments, holdsInOrder } from './citation-record.js';
import { cloDesignation } from './clo-designation.js';
import { sendToolEvent } from '../portal-tools/tool-events.js';
import { queuePlatformFollowUp } from '../platform-follow-up.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { createLogger } from '../logger.js';

const log = createLogger('Legal.AnswerHold');

export const HOLD_ORIGIN = 'hold';
export const HOLD_HEAD = '[HELD BY THE CITATION LAW — the platform, not your operator]';
const HOLD_TOOL = 'legal/citation_hold';
const CHATS_KEPT = 20;
const RECORDS_KEPT = 200;

// Citation shapes the hold reads, each keyed the way a record's authority and
// pin cite squeeze, so a mention is covered by the record that confirms it.
const MENTIONS = Object.freeze([
  [/\b(\d{1,2})\s*U\.?\s?S\.?\s?C\.?\s*(?:§+\s*)?(\d+[a-z]{0,2}(?:-\d+)?)/gi, (m) => `${m[1]}usc${m[2]}`],
  [/\b(\d{1,2})\s*C\.?\s?F\.?\s?R\.?\s*(?:§+\s*|Part\s+)?(\d+(?:\.[0-9a-z-]+)?)/gi, (m) => `${m[1]}cfr${m[2]}`],
  [/\bRel(?:ease)?\.?\s*(?:Nos?\.?\s*)?(\d{2,3}-\d{3,6})/gi, (m) => m[1]],
  [/\b(\d{2,3})\s*FR\s*(\d{3,6})\b/g, (m) => `${m[1]}fr${m[2]}`],
  [/\bFINRA\s+Rule\s+(\d{4})/gi, (m) => `finrarule${m[1]}`],
  [/\b(?:Regulation|Directive|Reg\.)\s*\((?:EU|EC|EEC)\)\s*(?:No\.?\s*)?(\d{2,4}\/\d{1,4})/gi, (m) => m[1]],
  [/\bS\.?\s?I\.?\s*(\d{4}\/\d{1,4})/g, (m) => m[1]],
  [/\b([A-Z][\w.&'-]*)\s+v\.\s+([A-Z][\w.&'-]*)/g, (m) => `${m[1]}v${m[2]}`],
]);
const LEGAL_SIGNS = /§|\bArt\.\s*\d/;

/** Every citation the text makes that the hold can key. Pure. */
export const citationMentions = (text) => {
  const seen = new Map();
  for (const [re, key] of MENTIONS) {
    for (const m of String(text ?? '').matchAll(re)) {
      const k = squeeze(key(m));
      if (k && !seen.has(k)) seen.set(k, { text: m[0].trim(), key: k });
    }
  }
  return [...seen.values()];
};

// A code's title in an authority ([…] → "16 CFR"), so a
// section pin under it ("§ 255.5") keys as "16 CFR 255.5".
const CODE_TITLE = /\b\d{1,2}\s*(?:U\.?\s?S\.?\s?C|C\.?\s?F\.?\s?R)\b\.?/i;

// pure — what a record covers: its squeezed authority and pin cite, and the
// same citation keyed the way a mention is — […] covers
// "16 CFR 255", its pin "§ 255.5" covers "16 CFR 255.5".
const coverKeys = (record) => {
  const authority = String(record?.authority ?? '');
  const pin = String(record?.pinCite ?? '');
  const title = authority.match(CODE_TITLE)?.[0];
  const cited = [`${authority} ${pin}`, ...(title ? [`${title} ${pin}`] : [])];
  return [squeeze(cited[0]), ...cited.flatMap((t) => citationMentions(t).map((m) => m.key))];
};

/**
 * The words people said to the CLO in this chat: the operator's own turns —
 * never a turn the platform wrote (a hold, a watch, a wake: those rows carry
 * an origin) nor a compaction summary. Pure.
 * @param {Array<Object>} recent the chat's rows
 * @param {string|null} thought this turn's message
 * @param {string|null} origin this turn's mark
 * @returns {string[]}
 */
export const wordsSaidInChat = (recent, thought, origin) => [
  ...(Array.isArray(recent) ? recent : [])
    .filter((m) => m?.role === 'user' && !m.origin && !m.compacted && typeof m.content === 'string')
    .map((m) => m.content),
  ...(!origin && typeof thought === 'string' ? [thought] : []),
];

/**
 * What in an answer the app did not confirm — [] when nothing is, or when it
 * is not a legal answer at all. Pure.
 * @param {string} text the answer
 * @param {Array<Object>} confirmed citation records verified in this chat
 * @param {string[]} [said] the words said to the CLO in this chat — quoting them is not quoting law
 * @returns {string[]}
 */
export const holdProblems = (text, confirmed, said = []) => {
  const marks = unresolvedMarks(text);
  const mentions = citationMentions(text);
  if (!marks.length && !mentions.length && !LEGAL_SIGNS.test(String(text ?? ''))) return [];
  const covers = confirmed.flatMap(coverKeys);
  const uncovered = mentions.filter((m) => !covers.some((c) => c.includes(m.key)));
  const heard = said.map(squeeze).filter(Boolean);
  const unbound = unboundQuotes(text, confirmed)
    .filter((span) => !heard.some((words) => holdsInOrder(words, quoteSegments(span))));
  return [
    marks.length ? `it still carries ${marks.join(', ')}` : null,
    confirmed.length ? null : 'no citation check has passed in this chat, yet it cites law',
    uncovered.length ? `it cites what no confirmed record covers: ${uncovered.slice(0, 8).map((m) => m.text).join('; ')}${uncovered.length > 8 ? ` (+${uncovered.length - 8} more)` : ''}` : null,
    unbound.length ? `quotation marks around words no confirmed record quotes: ${unbound.slice(0, 4).map((s) => `"${s.length > 80 ? `${s.slice(0, 80)}…` : s}"`).join('; ')}` : null,
  ].filter(Boolean);
};

const chatKey = (connection) => String(connection?.sessionId || '(unsessioned)');

/** impure — remember records the app confirmed in this chat; past the cap the oldest chat on the connection is forgotten. */
export const noteVerifiedRecords = (connection, records) => {
  if (!connection || !records?.length) return;
  const chats = connection._citeVerified ??= new Map();
  const key = chatKey(connection);
  const prior = chats.get(key) ?? [];
  chats.delete(key);
  chats.set(key, [...prior, ...records].slice(-RECORDS_KEPT));
  if (chats.size > CHATS_KEPT) chats.delete(chats.keys().next().value);
};

const confirmedInChat = (connection) => connection._citeVerified?.get(chatKey(connection)) ?? [];

/** What the CLO is sent back with. Pure. */
export const holdThought = (problems) => [
  `${HOLD_HEAD} Your last answer cites law the app has not confirmed:`,
  ...problems.map((p) => `- ${p}`),
  'Run legal_cite_check on a record for every citation and quotation in it, fix whatever fails, and give the answer again. If a part cannot be confirmed, say so plainly in the answer instead of citing it. Anything the house will act on goes out as legal/opinion.',
].join('\n');

/**
 * impure — judge the seated CLO's final answer at the end of its turn. Never throws.
 * @param {{connection: Object, text: string, interrupted: boolean, origin: string|null, recent?: Array<Object>, thought?: string}} turn
 *   recent: the chat's rows; thought: this turn's message (the words said to the CLO)
 */
export const settleCitationHold = async ({ connection, text, interrupted, origin, recent = [], thought = null }) => {
  try {
    const { ws, companion, walletAddress } = connection;
    if (interrupted || origin === 'wake' || !companion?.neumaId || !String(text ?? '').trim()) return;
    if (!(await cloDesignation.holds(walletAddress, companion.neumaId))) return;
    const problems = holdProblems(text, confirmedInChat(connection), wordsSaidInChat(recent, thought, origin));
    const second = origin === HOLD_ORIGIN;
    if (!problems.length) {
      if (second) sendToolEvent(ws, companion, { tool: HOLD_TOOL, status: 'ok', summary: 'CHECKED — every citation and quotation in this answer was confirmed by the app' });
      return;
    }
    const detail = problems.join('\n');
    if (!second) {
      sendToolEvent(ws, companion, { tool: HOLD_TOOL, status: 'error', summary: `HELD — the app has not confirmed this legal answer (${problems.length} problem${problems.length === 1 ? '' : 's'}); the CLO is checking it now`, detail });
      const thought = holdThought(problems);
      queuePlatformFollowUp(connection, { origin: HOLD_ORIGIN, thought, frame: { type: 'citation:held', text: thought, at: Date.now() } });
      return;
    }
    sendToolEvent(ws, companion, { tool: HOLD_TOOL, status: 'error', summary: 'UNCHECKED — the app could not confirm this legal answer; do not rely on its citations', detail });
    await notifyOperator({
      wallet: String(walletAddress).toLowerCase(), kind: KIND.legalAlert, standing: STANDING.system,
      title: `${companion.name || 'Your CLO'} gave a legal answer the app could not confirm`,
      detail: `Do not rely on its citations. ${problems.join(' · ')}`.slice(0, 600),
      ref: { neumaId: companion.neumaId },
    });
  } catch (err) {
    log.warn('the citation hold could not judge this answer', { error: err.message });
  }
};
