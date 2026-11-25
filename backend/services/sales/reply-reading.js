// REPLY READING — what a reply SAYS, so the house organises itself around it
// (Design note, 2026-11-20: […]).
//
// Fixed rules, no model (reply-rules.js: fixed rules first): nothing in a
// reply's words can steer a being here. Only their OWN words are read — the
// email of ours quoted under them is ours. Five readings:
//
//   wants  they asked for something: the deck, a call, more. Answer first.
//   open   a person wrote and it is none of the others: read it.
//   auto   a machine wrote (out of office, […]).
//   gone   the person has left; the notice may name who to write to instead.
//   no     they declined. The house stops writing. The contact is KEPT — a no
//          is not a request to be forgotten (that is asksToStop, which puts an
//          address on the do-not-contact list; this never does).
//
// A reply that both declines and asks for something reads as OPEN: a person
// decides that one, never a rule.
// PURE.

import { normalizeEmail } from './suppress-shape.js';
import { ownText } from './reply-rules.js';

import { WHY_MAX } from './reply-said.js';

export { SAYS, WANTS, cleanSaid, saidOf, closes, saidWords } from './reply-said.js';

// A machine's reply. The SUBJECT says so outright ("Automatic reply:", "Out of office"); in the body only words no
// person writes to a stranger count — […] opens many a real answer, so it is a subject-only sign.
const AUTO_SUBJECT = /^(auto(matic)?[\s-]*(reply|response|antwort)|out of (the )?office|abwesenheit|thank(s| you) for (your|contacting|reaching)|we('ve| have) received your|your (message|email) (has been|was) received)/i;
const AUTO_BODY = /\b(i am|i'm|i will be|i'll be) (currently )?(out of (the )?office|away|on (annual |parental |medical )?leave|travell?ing)\b|\b(limited|no) access to (my )?e-?mail\b|\bthis is an automat(ed|ic) (reply|response|message)\b|\bwe('ve| have) received your (message|email|inquiry|enquiry|request)\b/i;
const GONE = /\b(is |has )?no longer (with|at|works? (for|at|with)|employed|part of|a (partner|member))\b|\bhas (left|departed|moved on|transitioned out)\b|\b(left|departed) the (firm|company|fund|team)\b|\bno longer (monitored|in use|active)\b|\bthis (mailbox|address|inbox) is (no longer|not) (monitored|in use)\b/i;
const NO = /\bnot (a |the right |a good )?fit\b|\bnot interested\b|\bno interest\b|\b(we|i)('ll| will| are going to|'m going to| have to| must| need to)? ?pass(ing)?\b(?! (it|this|you|your|that) (on|along|to))|\bnot (currently |actively )?(investing|looking|taking (on|new)|making (new )?investments|deploying|adding)\b|\boutside (of )?(our|my) (focus|thesis|mandate|scope|stage|area|wheelhouse)\b|\b(does|do)(n'?t| not) (fit|align|match)\b|\bnot (something|a space|an area|a stage|in a position)\b|\b(have to|must|will|going to|respectfully) decline\b|\bno,? thank(s| you)\b|\bnot for (us|me)\b|\b(won'?t|will not|unable to|not able to|can'?t|cannot) (be )?(able to )?(invest|participat|pursu|mov(e|ing) forward|tak(e|ing) (this|it) (on|further))|\btoo (early|late|small|far) (for|from) (us|our|me)\b|\bwe (do not|don'?t) invest\b|\bnot (a |the )?(right|good) (time|moment)\b|\bnot (moving|going) forward\b|\bwish you (the best|all the best|luck|well)\b|\bbest of luck\b/i;
const DECK = /\b(send|share|forward|shoot|pass|email)\b[^.?!\n]{0,40}\b(deck|pitch|materials?|one[- ]?pager|memo|presentation|slides|data ?room)\b|\b(deck|pitch deck|one[- ]?pager|materials)\b[^.?!\n]{0,24}\?|\b(do|can|could|would) you (have|send|share)\b[^.?!\n]{0,40}\b(deck|materials?|one[- ]?pager|more (info|information|details))\b/i;
const CALL = /\b(let'?s|happy to|glad to|love to|open to|like to|free to|can we|could we|shall we|want to|keen to)\b[^.?!\n]{0,40}\b(chat|talk|speak|connect|call|meet|catch up|hop on|jump on|zoom|sync)\b|\b(book(ed)?|schedul(e|ed|ing)|find|set up|grab)\b[^.?!\n]{0,30}\b(time|a call|a meeting|a slot|15 minutes|30 minutes)\b|\bwhat (does|is) your (availability|calendar)\b|\bwhen (are|would) you (be )?(free|available)\b/i;
const MORE = /\btell me more\b|\b(love|like|keen|happy|interested) to (learn|hear|see|know|understand) more\b|\bwhat('s| is| are) (your|the) (valuation|round|raise|terms|traction|revenue|cap|ask|pricing|price|timeline)\b|\bhow (much|many|does|do|is|are)\b[^.?!\n]{0,80}\?|\bcould you (clarify|explain|elaborate)\b|\b(sounds|looks|this is) (interesting|great|promising|compelling)\b|\bi('m| am) interested\b|\bwe('re| are) interested\b/i;
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

// The few words around what a rule matched, on one line: what the operator is shown as why.
const around = (own, match) => {
  const flat = own.replace(/\s+/g, ' ');
  const at = flat.toLowerCase().indexOf(match[0].replace(/\s+/g, ' ').toLowerCase());
  if (at < 0) return match[0].trim().slice(0, WHY_MAX);
  // Their whole sentence: from the end of the one before it to its own full stop, question mark or exclamation mark.
  const before = [...flat.slice(0, at).matchAll(/[.?!](?=\s)/g)].at(-1);
  const from = before ? before.index + 1 : 0;
  const after = /[.?!](?=\s|$)/.exec(flat.slice(at + 1));
  return flat.slice(from, after ? at + 1 + after.index + 1 : flat.length).trim().slice(0, WHY_MAX);
};

/**
 * Read one reply.
 * @param {{subject?: ?string, text?: ?string, from?: ?string}} reply text: the message's text (quoted history is cut here)
 * @returns {{says: string, want?: string, why: ?string, forward?: string[]}} why: their own sentence the reading
 *   stands on (null when no words were kept); forward: the addresses a "gone" notice points to instead
 */
export const readReply = ({ subject, text, from } = {}) => {
  const own = ownText(text ?? '', 4000).trim();
  if (!own) return { says: 'open', why: null };
  const bareSubject = String(subject ?? '').replace(/^((re|aw|fwd?|sv):\s*)+/i, '');
  const gone = GONE.exec(own);
  if (gone) {
    const self = normalizeEmail(from);
    const forward = [...new Set((own.match(ADDRESS) ?? []).map(normalizeEmail).filter((a) => a && a !== self))].slice(0, 3);
    return { says: 'gone', why: around(own, gone), ...(forward.length ? { forward } : {}) };
  }
  if (AUTO_SUBJECT.test(bareSubject)) return { says: 'auto', why: bareSubject.slice(0, WHY_MAX) };
  const no = NO.exec(own);
  const asked = [['deck', DECK.exec(own)], ['call', CALL.exec(own)], ['more', MORE.exec(own)]].find(([, m]) => m) ?? null;
  // A decline that still asks for something is a person's to read, never a rule's.
  if (no && asked) return { says: 'open', why: around(own, no) };
  if (no) return { says: 'no', why: around(own, no) };
  if (asked) return { says: 'wants', want: asked[0], why: around(own, asked[1]) };
  const auto = AUTO_BODY.exec(own);
  if (auto) return { says: 'auto', why: around(own, auto) };
  return { says: 'open', why: null };
};
