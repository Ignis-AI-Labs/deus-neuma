// The CLO OFFICE briefing — what the seated Praetor reads at the top of every
// turn: the watch's heartbeat, the matters awaiting a reading, the readings
// whose review date has come, and what waits on counsel or the operator.
// Every other lane receives '' (the section is absent, never empty-titled).
// The office read is the connection's OWN house's (its operator's wallet) —
// a lane holding another house's seat under the same lane id reads nothing.

import fs from 'fs/promises';
import path from 'path';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { cloDesignation } from './clo-designation.js';
import { UNFILLED_REGISTER } from './clo-scaffold.js';
import { matterLedgerFor, mattersDueForReview } from './matter-ledger.js';
import { readLegalWatchState } from './legal-scheduler.js';
import { createLogger } from '../logger.js';

const log = createLogger('Legal.Briefing');
const BRIEFING_CAP = 15;
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'unknown'];

// pure
const matterLine = (m) => `- [${m.id.slice(0, 10)}] ${m.severity} · ${m.area}${m.repo ? `/${m.repo}` : ''} — ${m.title}`;
const bySeverity = (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
const capped = (list, more) => [
  ...list.slice(0, BRIEFING_CAP).map(matterLine),
  ...(list.length > BRIEFING_CAP ? [`- …and ${list.length - BRIEFING_CAP} more (${more})`] : []),
].join('\n');

/**
 * pure — the briefing text from the office's state.
 * @param {{entries: Array<Object>, watch: Object|null, today?: string}} args
 */
export const legalBriefingText = ({ entries, watch, today }) => {
  const fresh = entries.filter((m) => m.status === 'new').sort(bySeverity);
  const due = mattersDueForReview(entries, today);
  const concerns = entries.filter((m) => m.status === 'concern');
  const counsel = entries.filter((m) => m.status === 'needs_counsel');
  const operator = entries.filter((m) => m.status === 'needs_operator');
  const lastRun = watch?.runs?.[0];
  return [
    '## CLO office',
    'You hold the CLO office — the Praetor: licences, contracts, and the world\'s regulations, read against whatever the house builds and ships. You are the house\'s legal WATCH, not its counsel: flag, read the law at its source, cite it, and hand to a lawyer what needs one. Doctrine: legal/charter.md; the law the house stands under: legal/register.md.',
    'Before you research, call legal_sources {kind, jurisdiction}: where the law is read, the route your web tools reach, the reading order, and the citation check. A PDF (statute titles, opinions): web_fetch {url, find: "<section or term>"}. A reading rests only on a source you READ this session and quote word for word; if you could not read it, settle needs_operator and say what was unread — never settle from memory.',
    '',
    '### The watch',
    watch?.lastRunAt
      ? `Last run: ${watch.lastRunAt}${lastRun ? ` (+${lastRun.added} new, ${lastRun.seen} known; ${lastRun.repos.map((r) => `${r.repo}: ${r.shipped} shipped packages, ${r.commits} new commits`).join(' · ')})` : ''}`
      : 'The legal watch has NEVER run on this install — file a legal/scan intent, or ask the operator why the scheduler is silent.',
    '',
    '### New matters awaiting YOUR reading',
    fresh.length ? capped(fresh, "legal_matters_list {status:'new'}") : 'None — the new lane is clear.',
    fresh.some((m) => m.source === 'build-watch') ? 'A build matter names commits: read their diffs before the law — the subject line is not the work.' : null,
    '',
    '### Standing',
    due.length ? `Due for review (their reviewBy date has come — the law may have moved):\n${capped(due, 'legal_matters_list')}` : null,
    concerns.length ? `CONCERNS standing, owed a change:\n${capped(concerns, "legal_matters_list {status:'concern'}")}` : 'No concerns stand.',
    counsel.length ? `${counsel.length} matter(s) wait on counsel — keep each question sharp enough that a lawyer can answer it in one reading.` : null,
    operator.length ? `${operator.length} matter(s) wait on the operator — say exactly what you need when you speak next.` : null,
  ].filter((line) => line !== null).join('\n');
};

/** Live CLO briefing; every non-seated lane receives ''. impure. */
export const cloBriefingSection = async (connection) => {
  const neumaId = connection.companion?.neumaId;
  if (!neumaId) return '';
  try {
    const wallet = connection.walletAddress;
    if (!(await cloDesignation.holds(wallet, neumaId))) return '';
    const [entries, watch] = await Promise.all([
      matterLedgerFor(wallet).then((ledger) => ledger.load()),
      readLegalWatchState(wallet).catch(() => null),
    ]);
    const text = legalBriefingText({ entries, watch });
    // A new house's register starts as a template: until […] is
    // written, every reading is made blind to whose law reaches the house.
    const register = await fs.readFile(path.join(neumaWorkspace.pathFor(neumaId), 'legal', 'register.md'), 'utf8').catch(() => '');
    return register.includes(UNFILLED_REGISTER)
      ? `${text}\nYour register (legal/register.md) does not yet say who this house is — its entity, where it is registered, what it ships, where its users are. Write that first; ask the operator for what you cannot find.`
      : text;
  } catch (error) {
    log.warn('CLO briefing failed', { neumaId, error: error.message });
    return '';
  }
};
