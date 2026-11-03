// THE SECOND READER — a separate reader judges what string matching cannot:
// whether each passage the legal office cites SUPPORTS its claim, and whether
// it is the provision the citation names (Design note, 2026-10-31.
//
// The citation check (cite-check.js) proves the words are on the page. It
// cannot see that a real passage was cited for something it does not say,
// or that the right words were pinned to the wrong subsection — most of the
// fifteen wrong citations a 2026-10-31 audit found in a CLO answer were of
// that kind. The reader is shown each claim beside the source's own words
// (the passage the check found), never the office's reasoning, and answers
// one line per citation.
//
// WHICH MODEL is the house's choice (per-house setting, the LEGAL window):
// by default the house's own model — the seated CLO's own route, in a fresh
// context with an adversarial brief — so nothing leaves the machine. The
// operator may choose any provider they have connected; that is the
// "second reader" row in electron/connections.json, off until chosen. A
// provider on the machine's own key is the install owner's to spend
// (witness-summon.js's law).
//
// FAIL-CLOSED: a reader that cannot be had is no review. The filing waits —
// the office may still hand off needs_operator / needs_counsel.

import { createStreamRequest, consumeStream, getConfig, getThinkBehavior } from '../llm-provider.js';
import { resolveNeumaRoute, isSovereigntyRefusal } from '../neuma-route-resolver.js';
import { isSovereignProvider, getProvider } from '../provider-registry.js';
import { getConnection, routeForConnection } from '../provider-connections.js';
import { resolveUsableCredential } from '../oauth-token-broker.js';
import { pairRequestCredential } from '../provider-credentials.js';
import { readInstallOwner, standingIn } from '../install-owner.js';
import { officeFile } from '../house-office.js';
import { frameUntrustedContent } from '../untrusted-content.js';
import { readDoc, saveDoc } from './legal-store-io.js';
import { createLogger } from '../logger.js';

const log = createLogger('Legal.SecondReader');

const LINE_MAX_TOKENS = 90;
const THINK_ROOM = 1536;
const TIMEOUT_MS = 120_000;
const VERDICTS = Object.freeze(['supports', 'does_not_support', 'wrong_provision', 'cannot_tell']);
export const BLOCKING = Object.freeze(['does_not_support', 'wrong_provision']);
export const HOUSE_MODEL = 'house';

// ── the setting ──
const settingFile = (wallet) => officeFile(wallet, 'legal', 'second-reader.json');

/** impure — the house's reader: {provider: 'house' | <providerId>, setAt, setBy}. */
export const readReaderSetting = async (wallet) => {
  const doc = await readDoc(settingFile(wallet), null);
  return doc && typeof doc.provider === 'string' ? doc : { provider: HOUSE_MODEL, setAt: null, setBy: null };
};

/**
 * impure — choose the house's reader. A connected provider must exist; one
 * that spends the machine's key is the install owner's (or a co-owner's) to choose.
 * @returns {Promise<{ok: true, setting: Object} | {ok: false, error: string}>}
 */
export const saveReaderSetting = async (wallet, provider) => {
  const choice = String(provider ?? '').trim() || HOUSE_MODEL;
  if (choice !== HOUSE_MODEL) {
    const conn = await getConnection(choice);
    if (!conn) return { ok: false, error: `${choice} is not a connected provider — connect it (key or sign-in, live test) in Settings first` };
    const stored = await resolveUsableCredential(choice).catch(() => ({}));
    if (stored.apiKey && !['owner', 'co-owner'].includes(standingIn(await readInstallOwner(), wallet))) {
      return { ok: false, error: `${choice} answers on this machine's own key, which only its owner can spend — choose the house's own model, or ask the owner` };
    }
  }
  const setting = { provider: choice, setAt: new Date().toISOString(), setBy: String(wallet).toLowerCase() };
  await saveDoc(settingFile(wallet), setting);
  log.info('second reader chosen', { wallet: setting.setBy, provider: choice });
  return { ok: true, setting };
};

// impure — the route the reader answers on, and how the result names it.
const readerRoute = async (setting, laneId) => {
  if (setting.provider === HOUSE_MODEL) {
    try {
      const route = await resolveNeumaRoute(laneId, null);
      return { route, label: `the house's own model (${route.model})` };
    } catch (err) {
      if (isSovereigntyRefusal(err) || !isSovereignProvider(getConfig().provider)) throw err;
      return { route: undefined, label: 'the house\'s own model (the machine default)' };
    }
  }
  const conn = await getConnection(setting.provider);
  if (!conn) throw new Error(`the chosen reader ${setting.provider} is no longer connected — choose again in the LEGAL window`);
  const cred = pairRequestCredential(await resolveUsableCredential(setting.provider), { endpoint: conn.endpoint });
  if (!cred.apiKey && getProvider(setting.provider)?.requiresKey) throw new Error(`${setting.provider} has no usable credential`);
  return { route: routeForConnection(conn, cred), label: `${setting.provider} (${conn.model})` };
};

// ── the reading ──
const BRIEF = [
  'You are the SECOND READER for a house\'s legal office. You did not write the work below and you owe it nothing: your job is to find where a citation does not hold.',
  'Each numbered item gives a CLAIM the office makes, the AUTHORITY and PIN CITE it names, and the SOURCE PASSAGE the app fetched from that authority itself. Judge each item on the passage alone, never on what you remember the law to say:',
  '- supports: the passage, at the pin cite named, says what the claim says.',
  '- does_not_support: the passage is real but does not say what the claim says (it says less, something else, or the opposite).',
  '- wrong_provision: the words may support the claim, but they are not the provision the pin cite names (another subsection, article, section or document).',
  '- cannot_tell: the passage is too short or unclear to judge.',
  'Answer with exactly one line per item and nothing else, in this form:',
  '<number> | <supports | does_not_support | wrong_provision | cannot_tell> | <one short reason>',
].join('\n');

/** The reader's messages for the verified rows of a check. Pure. */
export const readerMessages = (rows) => [
  { role: 'system', content: BRIEF },
  {
    role: 'user',
    content: rows.map((r) => [
      `ITEM ${r.n}`,
      `CLAIM: ${r.record.claim.trim()}`,
      `AUTHORITY: ${r.record.authority.trim()} · PIN CITE: ${r.record.pinCite.trim()} · HEADING: ${r.record.heading.trim()}`,
      r.record.quote ? `QUOTED: "${r.record.quote.trim()}"` : 'QUOTED: (a paraphrase — no quotation)',
      frameUntrustedContent(`the source passage fetched from ${r.record.sourceUrl.trim()}`, r.passage || '(the check could not place the passage on the page)'),
    ].join('\n')).join('\n\n'),
  },
];

/**
 * The reader's verdict per row, from its words. A row it did not answer is
 * cannot_tell. Pure.
 * @returns {Map<number, {verdict: string, why: string}>}
 */
export const parseReading = (text, rows) => {
  const said = new Map();
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\W*(\d+)\W*\|\s*([a-z_ ]+?)\s*\|\s*(.+)$/i.exec(line.replace(/[*`]/g, '').trim());
    const verdict = m ? m[2].toLowerCase().replace(/\s+/g, '_') : null;
    if (m && VERDICTS.includes(verdict) && !said.has(Number(m[1]))) said.set(Number(m[1]), { verdict, why: m[3].trim().slice(0, 300) });
  }
  return new Map(rows.map((r) => [r.n, said.get(r.n) ?? { verdict: 'cannot_tell', why: 'the reader gave no answer for this item' }]));
};

// impure — the one call: no tools, thinking closed where the wire allows, a clock.
const ask = async (route, messages, rows) => {
  const think = await getThinkBehavior(route);
  const clock = AbortSignal.timeout(TIMEOUT_MS);
  const stream = await createStreamRequest(messages, {
    temperature: 0,
    maxTokens: LINE_MAX_TOKENS * rows.length + (think.thinks ? THINK_ROOM : 0),
    ...(think.serverBudget === true ? { thinkingBudget: THINK_ROOM } : { noThink: true }),
    ...(route ? { route } : {}),
    signal: clock,
  });
  const text = await consumeStream(stream, () => {}, { ...think, signal: clock });
  if (clock.aborted) throw new Error(`no answer within ${TIMEOUT_MS / 1000} s`);
  return text;
};

/**
 * impure — the second reading of a passed citation check. Never throws.
 * @param {{rows: Array<Object>, connection: Object}} args rows: the check's verified rows (with passage)
 * @returns {Promise<{ok: boolean, failed?: string, reader: string|null, readings: Map<number, Object>}>}
 */
export const secondRead = async ({ rows, connection }) => {
  const setting = await readReaderSetting(connection.walletAddress);
  let label = null;
  try {
    const { route, label: named } = await readerRoute(setting, connection.companion?.neumaId);
    label = named;
    const readings = parseReading(await ask(route, readerMessages(rows), rows), rows);
    const blocked = rows.filter((r) => BLOCKING.includes(readings.get(r.n).verdict));
    return { ok: blocked.length === 0, reader: label, readings };
  } catch (err) {
    log.warn('the second reader could not be had — the filing waits', { provider: setting.provider, error: err.message });
    return { ok: false, failed: `the second reader (${label ?? setting.provider}) could not be had: ${err.message}`, reader: label, readings: new Map() };
  }
};

/** The reading as the office reads it. Pure. */
export const readingText = (result, rows) => [
  result.failed
    ? `SECOND READER — ${result.failed}. A reading nobody could second does not land: try again, or hand off needs_operator.`
    : `SECOND READER — ${result.reader} read each passage against its claim:`,
  ...rows.filter((r) => result.readings.has(r.n)).map((r) => {
    const { verdict, why } = result.readings.get(r.n);
    return `${r.n}. ${verdict.toUpperCase().replace(/_/g, ' ')} · ${r.record.authority.trim()}, ${r.record.pinCite.trim()} — ${why}`;
  }),
  result.ok ? null : (result.failed ? null : 'Nothing that rests on a row the reader judged DOES NOT SUPPORT or WRONG PROVISION may land: fix the claim or the pin cite from the passage, or remove it.'),
].filter(Boolean).join('\n');
