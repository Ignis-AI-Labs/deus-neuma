// research-mode — the chat's RESEARCH bearing: a question researched in depth, then answered in a
// full report.
//
// Design note, 2026-11-14: […]
//
// The model decides when it is done, and a model that has read three pages decides early. In
// RESEARCH the harness keeps the count: every page the being actually READ (a web fetch that came
// back with text, never a search snippet) and every search it ran. A turn that tries to finish
// below the floor is sent back to the thin parts of its question with what it has read so far; it
// may stop short only when searching stops turning up anything new, and then the report says so.
// Once it has read enough it is asked for the report, with its sources numbered for citation, and
// that last word is the report: saved in the being's workspace with the source list the harness
// keeps (what was read, never what was remembered), and shown in the chat.
//
// One of the standing chat modes (tool-policy.js CHAT_MODES), set from the composer's mode menu.
// Acting tools ask per act as in DEFAULT; reading the web needs no card. impure (connection state,
// one workspace file)
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeChatMode } from './tool-policy.js';
import { createLogger } from './logger.js';
import { neumaWorkspace } from '../../core/index.js';
import { sendToolEvent } from './portal-tools/tool-events.js';

const log = createLogger('ResearchMode');

/**
 * The least a report rests on: pages read, from different sites, across searches run. Founder,
 * 2026-11-14: […]
 */
export const RESEARCH_FLOOR = Object.freeze({ sources: 40, sites: 15, searches: 12 });
/** Returns to the work a turn gets before the report is asked for anyway. */
export const RESEARCH_MAX_RETURNS = 12;
/** Returns in a row that SEARCHED and still read nothing new: the searching is exhausted. A turn
 * that only talks is not exhausted, it is not researching, and keeps being sent back. */
export const RESEARCH_DRY_RETURNS = 2;

const SEARCH = 'web/web_search';
const FETCH = 'web/web_fetch';

/** Whether this sitting is in RESEARCH. Pure. */
export const isResearching = (connection) => normalizeChatMode(connection?.chatMode) === 'research';

/** The protocol the being reads in RESEARCH ('' in every other mode: the empty-string law). Pure. */
// THE RULES OF THE WORK (Design note, 2026-11-14: […]). Nothing is off limits and nothing is softened; and the report
// keeps fact, allegation, dispute and opinion apart, because research that assumes its verdict is
// the manipulated output it exists to see through.
export const researchModeSection = (connection) => (isResearching(connection) ? [
  'RESEARCH MODE — the operator asked for deep research and a full report, not a quick answer. Depth and honesty are the whole job.',
  '1. SCOPE. Say the question in one line, then the 6 to 12 sub-questions that together answer it, including the ones a sceptic of each side would ask.',
  '2. GATHER, FROM EVERY KIND OF SOURCE. For every sub-question, search from many angles and READ the pages with web_fetch; a search result snippet is not a source, only a page you read counts. Go to primary material first: official records, court filings and judgments, government, parliamentary and congressional records, declassified and archival documents, treaties, statistics, financial filings, academic studies. Then reporting from outlets in different countries and of different alignments, and the strongest critics and the strongest defenders. Note each source\'s date and who published it.',
  '3. NOTHING IS OFF LIMITS, NOTHING IS SOFTENED. Follow the evidence wherever it goes, whoever it reflects badly on: a government, an institution, a company, a person. Do not leave a finding out because it is controversial or unflattering, do not water it down, and do not add warnings or moral commentary the operator did not ask for.',
  '4. OBJECTIVE, NOT ONE-SIDED. Report what each source actually documents and keep apart: DOCUMENTED (the record shows it), ALLEGED (who alleges it, on what evidence), DISPUTED (each side\'s evidence) and OPINION. Where the evidence does not support a claim, say so as plainly as where it does. A conclusion is earned by the evidence, never assumed before the reading.',
  `5. KEEP GOING. The harness counts the pages you actually read. The report needs at least ${RESEARCH_FLOOR.sources} pages from at least ${RESEARCH_FLOOR.sites} different sites across at least ${RESEARCH_FLOOR.searches} searches; stop short and you will be sent back. Go wider where a sub-question is thin and deeper where sources disagree.`,
  '6. REPORT. When you are asked for the report, write it in markdown: a title; SUMMARY (what the evidence shows, in 5 to 10 lines); FINDINGS, one section per sub-question, every claim cited by its source number like [3] and marked DOCUMENTED, ALLEGED, DISPUTED or OPINION; WHERE SOURCES DISAGREE, and why; OPEN QUESTIONS AND LIMITS. Do not write a source list: the harness appends the numbered list of exactly what you read.',
].join('\n') : '');

// pure — the turn's research ledger, made the first time it is needed
const ledgerOf = (connection) => {
  connection._research ??= { sources: [], seen: new Set(), searches: new Set(), returns: 0, dry: 0, phase: 'gathering', lastCount: 0, lastSearches: 0 };
  connection._research.sites ??= new Map(); // host → pages read there
  return connection._research;
};

/** The site a page belongs to (www. dropped), or null. Pure. */
const siteOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
};

/** The read URL a fetch's text opens with (web-being-tools renderPage: […]). Pure. */
const readUrlOf = (act, result) => {
  const first = String(result?.content || '').split('\n', 1)[0];
  const url = first.split(' (', 1)[0].trim();
  return /^https?:\/\//.test(url) ? url : String(act?.args?.url || '').trim() || null;
};

/** impure — one round's searches and reads onto the turn's ledger (acts and results are index-aligned). */
export const noteResearchRound = (connection, acts = [], results = []) => {
  if (!isResearching(connection)) return;
  const ledger = ledgerOf(connection);
  acts.forEach((act, i) => {
    const result = results[i];
    if (result?.status !== 'ok') return;
    const tool = result.tool || act?.tool;
    if (tool === SEARCH && act?.args?.query) ledger.searches.add(String(act.args.query).trim().toLowerCase());
    if (tool === FETCH) {
      const url = readUrlOf(act, result);
      if (url && !ledger.seen.has(url)) {
        ledger.seen.add(url);
        ledger.sources.push(url);
        const host = siteOf(url);
        if (host) ledger.sites.set(host, (ledger.sites.get(host) || 0) + 1);
      }
    }
  });
};

/** The numbered list the report cites and closes with. Pure. */
export const numberedSources = (sources) => sources.map((url, i) => `[${i + 1}] ${url}`).join('\n');

// pure — where the gathering stands, said to the being
const standing = (ledger) => `You have read ${ledger.sources.length} page(s) from ${ledger.sites.size} site(s) across ${ledger.searches.size} search(es).`;

// pure — the sites carrying the most of the reading, when a few carry too much of it
const concentration = (ledger) => {
  const top = [...ledger.sites].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const share = top.reduce((sum, [, n]) => sum + n, 0);
  return ledger.sources.length >= 6 && share / ledger.sources.length > 0.5
    ? `More than half of what you have read comes from ${top.map(([host, n]) => `${host} (${n})`).join(', ')}: widen to other kinds of source and other countries.`
    : '';
};

/**
 * impure — at a round that made no call: in RESEARCH, the turn either goes back to the work, is
 * asked for the report, or ends (the report written). Pushes the being's words and the harness's
 * next instruction onto `messages` and answers 'continue' when the turn goes on; null otherwise.
 * @param {Object} connection
 * @param {{messages: Array<{role: string, content: string}>, roundResponse: string}} round
 * @returns {'continue'|null}
 */
export const researchNextStep = (connection, { messages, roundResponse }) => {
  if (!isResearching(connection)) return null;
  const ledger = ledgerOf(connection);
  if (ledger.phase === 'written') return null;
  if (ledger.phase === 'writing') { ledger.phase = 'written'; return null; }
  const short = ledger.sources.length < RESEARCH_FLOOR.sources || ledger.sites.size < RESEARCH_FLOOR.sites
    || ledger.searches.size < RESEARCH_FLOOR.searches;
  const readMore = ledger.sources.length > ledger.lastCount;
  const searchedMore = ledger.searches.size > ledger.lastSearches;
  ledger.dry = readMore ? 0 : (searchedMore ? ledger.dry + 1 : ledger.dry);
  ledger.lastCount = ledger.sources.length;
  ledger.lastSearches = ledger.searches.size;
  const exhausted = ledger.dry >= RESEARCH_DRY_RETURNS || ledger.returns >= RESEARCH_MAX_RETURNS;
  messages.push({ role: 'assistant', content: roundResponse || '' });
  if (short && !exhausted) {
    ledger.returns += 1;
    messages.push({ role: 'user', content: [
      `[RESEARCH] Not done yet. ${standing(ledger)} The report needs at least ${RESEARCH_FLOOR.sources} pages read from at least ${RESEARCH_FLOOR.sites} different sites across ${RESEARCH_FLOOR.searches} searches.`,
      'Keep researching: name the sub-questions that are still thin, search them from new angles (primary records, other countries, the strongest critics and defenders), and READ the best pages with web_fetch. Do not write the report yet.',
      concentration(ledger),
      ledger.sources.length ? `Read so far:\n${numberedSources(ledger.sources)}` : '',
    ].filter(Boolean).join('\n\n') });
    log.info('research sent back to the work', { read: ledger.sources.length, searches: ledger.searches.size, returns: ledger.returns });
    return 'continue';
  }
  ledger.phase = 'writing';
  messages.push({ role: 'user', content: [
    `[RESEARCH] Write the report now. ${standing(ledger)}${short ? ' Searching stopped turning up new pages before the floor was reached: say so plainly under OPEN QUESTIONS AND LIMITS.' : ''}`,
    'Use the form you were given: title, SUMMARY, FINDINGS by sub-question with every claim cited like [3] and marked DOCUMENTED, ALLEGED, DISPUTED or OPINION, WHERE SOURCES DISAGREE, OPEN QUESTIONS AND LIMITS. Leave nothing out for being controversial and soften nothing. No source list: it is appended for you.',
    `Your sources, numbered:\n${numberedSources(ledger.sources)}`,
  ].join('\n\n') });
  return 'continue';
};

/** A file-safe name for the report, from its title line. Pure. */
export const reportFileName = (report, now = new Date()) => {
  const title = (String(report || '').match(/^#\s+(.+)$/m)?.[1] || 'research').toLowerCase();
  const slug = title.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'research';
  return `${now.toISOString().slice(0, 10)}-${slug}.md`;
};

/**
 * impure — the finished report onto disk, in the being's workspace (research/), with the sources it
 * actually read appended; the turn's ledger is cleared. Answers the written path (relative to the
 * workspace), or null when this turn wrote no report.
 * @param {Object} connection
 * @param {string} report - the turn's last word
 * @param {string|null} laneDir - the being's workspace folder
 */
export const saveResearchReport = async (connection, report, laneDir) => {
  const ledger = connection?._research;
  connection && (connection._research = undefined);
  if (!ledger || ledger.phase !== 'written' || !laneDir || !String(report || '').trim()) return null;
  const name = reportFileName(report);
  const body = `${String(report).trim()}\n\n## Sources\n\n${ledger.sources.map((url, i) => `${i + 1}. ${url}`).join('\n') || '(none read)'}\n`;
  const dir = path.join(laneDir, 'research');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), body);
  log.info('research report saved', { file: `research/${name}`, sources: ledger.sources.length, searches: ledger.searches.size });
  return { file: `research/${name}`, sources: ledger.sources.length, searches: ledger.searches.size };
};

/**
 * impure — the turn's end in RESEARCH: the report saved beside the being's work and named in the
 * chat as a chip that opens to its sources. An interrupted turn, or one that wrote no report,
 * leaves nothing but a cleared ledger.
 * @param {Object} connection
 * @param {string} report - the turn's last word
 * @param {{ws: Object, companion: {name?: string, neumaId?: string}|null, interrupted?: boolean}} turn
 */
export const finishResearchTurn = async (connection, report, { ws, companion, interrupted = false }) => {
  if (!connection?._research) return null;
  if (interrupted || !companion?.neumaId) { connection._research = undefined; return null; }
  try {
    const sources = connection._research.sources.slice();
    const saved = await saveResearchReport(connection, report, neumaWorkspace.pathFor(companion.neumaId));
    if (saved) {
      sendToolEvent(ws, companion, {
        tool: 'research/report', status: 'ok', path: saved.file,
        summary: `report saved — ${saved.file} · ${saved.sources} pages read across ${saved.searches} searches`,
        detail: numberedSources(sources),
      });
    }
    return saved;
  } catch (err) {
    log.warn('the research report could not be saved', { error: err.message });
    return null;
  }
};
