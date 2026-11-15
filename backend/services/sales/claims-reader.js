// THE CLAIMS READER — the sales facts check reads numbers, the disclosure line
// and pressure words; it cannot see a false claim made in words alone. An
// outreach tool studied for the lead engine pitched a "yield ladder" its
// client never sold, in an email with no number in it (Design note, 2026-11-14. So
// before an email reaches a lead, the house's own model — a fresh context,
// nothing leaving the machine — lists every claim the email makes about the
// house and names the approved fact behind each one. A claim no fact states
// stops the email, named. FAIL-CLOSED: a reader that cannot be had, or an
// answer that cannot be read, sends nothing.
// The brief, the messages and the parse are PURE; claimsRead is impure (one model call).

import { createStreamRequest, consumeStream, getConfig, getThinkBehavior } from '../llm-provider.js';
import { resolveNeumaRoute, isSovereigntyRefusal } from '../neuma-route-resolver.js';
import { isSovereignProvider } from '../provider-registry.js';
import { frameUntrustedContent } from '../untrusted-content.js';
import { SALES_DISCLOSURE } from './sales-facts.js';
import { createLogger } from '../logger.js';

const log = createLogger('Sales.ClaimsReader');
const ANSWER_TOKENS = 700;
const THINK_ROOM = 1536;
const TIMEOUT_MS = 120_000;

const BRIEF = [
  'You are the CLAIMS READER for a company\'s sales office. You did not write the email below and you owe it nothing: your job is to find every claim it makes that the approved facts do not state.',
  'A claim is anything the email says about the SENDER\'S company: what it is, what it sells or does, how it works, its terms, results, numbers or promises. Statements about the recipient, questions, greetings, sign-offs and the line saying the email is from an AI are not claims.',
  'For each claim, name the number of the fact that states it. A claim that goes beyond its fact (a product, a feature, a promise or a result the fact does not state) has no fact: write NONE.',
  'Answer with one line per claim and nothing else, in this form:',
  '<fact number or NONE> | <the claim, in a few words>',
  'If the email makes no claim about the sender\'s company, answer exactly: NO CLAIMS',
].join('\n');

/** The reader's messages. Pure. */
export const claimsMessages = ({ facts, subject, text }) => [
  { role: 'system', content: BRIEF },
  {
    role: 'user',
    content: [
      'APPROVED FACTS:',
      ...facts.map((f) => `${f.n}. ${f.claim}${f.figure ? ` [${f.figure.value} ${f.figure.unit}]` : ''}`),
      '',
      frameUntrustedContent('the email to judge', `Subject: ${subject}\n\n${String(text).split(SALES_DISCLOSURE).join('')}`),
    ].join('\n'),
  },
];

/**
 * The reader's answer, read: every claim and the fact behind it, or why the
 * answer cannot be used. A fact number the sheet does not hold counts as NONE.
 * Pure.
 * @returns {{ok: true, claims: Array<{fact: number|null, claim: string}>} | {ok: false, reason: string}}
 */
export const parseClaims = (answer, facts) => {
  const text = String(answer ?? '').replace(/[*`]/g, '').trim();
  if (/^no claims\.?$/i.test(text)) return { ok: true, claims: [] };
  const numbers = new Set(facts.map((f) => f.n));
  const claims = [];
  for (const line of text.split('\n')) {
    const m = /^\W*(\d+|none)\s*\|\s*(.+)$/i.exec(line.trim());
    if (!m) continue;
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : null;
    claims.push({ fact: n !== null && numbers.has(n) ? n : null, claim: m[2].trim().slice(0, 200) });
  }
  return claims.length ? { ok: true, claims } : { ok: false, reason: 'the reader\'s answer could not be read' };
};

// impure — the house's own model, as the Mercator's route resolves it.
const houseRoute = async (laneId) => {
  try {
    return await resolveNeumaRoute(laneId, null);
  } catch (err) {
    if (isSovereigntyRefusal(err) || !isSovereignProvider(getConfig().provider)) throw err;
    return undefined;
  }
};

// impure — the one call: no tools, thinking closed where the wire allows, a clock.
const ask = async (route, messages) => {
  const think = await getThinkBehavior(route);
  const clock = AbortSignal.timeout(TIMEOUT_MS);
  const stream = await createStreamRequest(messages, {
    temperature: 0,
    maxTokens: ANSWER_TOKENS + (think.thinks ? THINK_ROOM : 0),
    ...(think.serverBudget === true ? { thinkingBudget: THINK_ROOM } : { noThink: true }),
    ...(route ? { route } : {}),
    signal: clock,
  });
  const text = await consumeStream(stream, () => {}, { ...think, signal: clock });
  if (clock.aborted) throw new Error(`no answer within ${TIMEOUT_MS / 1000} s`);
  return text;
};

/**
 * Read one email's claims against the approved facts. Never throws.
 * @param {{laneId: string, facts: object[], subject: string, text: string}} args
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
export const claimsRead = async ({ laneId, facts, subject, text }) => {
  try {
    const read = parseClaims(await ask(await houseRoute(laneId), claimsMessages({ facts, subject, text })), facts);
    if (!read.ok) return { ok: false, reason: `the claims check could not run: ${read.reason} — nothing is sent until it can` };
    const unsupported = read.claims.filter((c) => c.fact === null);
    return unsupported.length
      ? { ok: false, reason: `it claims what the approved facts do not state: ${unsupported.map((c) => `"${c.claim}"`).join('; ')} — say only what a fact states, or ask the operator to approve a fact for it` }
      : { ok: true };
  } catch (err) {
    log.warn('The claims reader could not be had — the email waits', { laneId, error: err.message });
    return { ok: false, reason: `the claims check could not run (${err.message}) — nothing is sent until it can` };
  }
};
