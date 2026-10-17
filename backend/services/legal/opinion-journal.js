// Opinion journal — the CLO office's MEMORY on disk. Every verdict the
// seated Praetor settles lands as a dated note in the lane's own sovereign
// workspace (workspaces/<lane>/legal/opinions/), beside the charter and the
// register the scaffold seeded. The ledger holds the standing record; this
// drawer is what the being's own recall reads back — its reading of the law,
// compounding across sessions.
//
// Two laws (the CSO journal's): FAIL-SOFT always — a note ABOUT the work
// never blocks the work; and the lane must already EXIST — the journal never
// creates a workspace.

import fs from 'fs/promises';
import path from 'path';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { createLogger } from '../logger.js';

const log = createLogger('OpinionJournal');

// pure — one note per matter per UTC day: 2026-10-01-1a2b3c4d.md.
export const opinionNameFor = (entry, at) =>
  `${at.slice(0, 10)}-${String(entry.id).replace(/^lm_/, '').slice(0, 8)}.md`;

// pure — one dated section: the fact lines first (so recall can index
// them), then the reasoning whole.
const sectionFor = (entry, verdict, at) => [
  `## ${at}`,
  '',
  `- matter: ${entry.externalId} — ${entry.title}`,
  `- area: ${entry.area} · severity: ${entry.severity}${entry.repo ? ` · repo: ${entry.repo}` : ''}`,
  ...(entry.regimes?.length ? [`- regimes: ${entry.regimes.join(', ')}`] : []),
  `- verdict: ${verdict.status}${entry.reviewBy ? ` · review by ${entry.reviewBy}` : ''}`,
  ...(entry.citations?.length ? ['- citations:', ...entry.citations.map((c) => `  - ${c}`)] : []),
  '',
  String(verdict.assessment).trim(),
  '',
].join('\n');

/**
 * impure (fail-soft) — append the verdict to the lane's opinion note for
 * this matter. Never throws; never creates the lane's workspace.
 * @param {{entry: Object, verdict: Object}} args
 * @returns {Promise<string|null>} the note's path, or null when nothing was written
 */
export const journalOpinion = async ({ entry, verdict }) => {
  try {
    const laneId = verdict?.assessedBy;
    if (typeof laneId !== 'string' || !laneId) return null;
    const laneDir = neumaWorkspace.pathFor(laneId);
    if (!(await fs.access(laneDir).then(() => true, () => false))) {
      log.warn('no lane workspace to journal into — verdict stands unjournaled', { laneId, id: entry?.id });
      return null;
    }
    const dir = path.join(laneDir, 'legal', 'opinions');
    await fs.mkdir(dir, { recursive: true });
    const at = entry.assessedAt || new Date().toISOString();
    const file = path.join(dir, opinionNameFor(entry, at));
    const exists = await fs.access(file).then(() => true, () => false);
    const heading = `# Opinion — ${entry.externalId}: ${entry.title}\n\n`;
    await fs.appendFile(file, `${exists ? '\n' : heading}${sectionFor(entry, verdict, at)}`, 'utf8');
    return file;
  } catch (err) {
    log.warn('opinion note failed — the verdict stands', { id: entry?.id, error: err.message });
    return null;
  }
};
