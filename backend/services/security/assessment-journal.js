// Assessment journal — the CSO office's MEMORY on disk. Every verdict the
// seated CSO settles lands here as a dated note in the lane's own sovereign
// workspace (workspaces/<lane>/security/assessments/), beside the playbook
// and the surfaces map the scaffold seeded. The ledger holds the standing
// record; this drawer is what the being's own recall engine reads back —
// the office's experience, compounding across sessions (Design note, 2026-08-10:
// […]).
//
// Two laws:
// - FAIL-SOFT, always. A journal that throws would block a verdict — the
//   ledger's record of the work — to save a note ABOUT the work. Never.
// - The lane must already EXIST. The journal never creates a workspace: a
//   verdict assessed by a lane with no workspace simply has no drawer to
//   remember in (the scaffold makes one at designation).
//
// Secret law rides from the ledger and the playbook: a note names the file
// and the line of a finding, never the material itself.

import fs from 'fs/promises';
import path from 'path';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { createLogger } from '../logger.js';

const log = createLogger('AssessmentJournal');

// pure — one note per threat per UTC day: 2026-08-10-1a2b3c4d.md.
export const noteNameFor = (entry, at) =>
  `${at.slice(0, 10)}-${String(entry.id).replace(/^th_/, '').slice(0, 8)}.md`;

// pure — one dated section of a note. The verdict's reasoning in full; the
// metadata as a fact line first so recall can index it.
const sectionFor = (entry, verdict, at) => [
  `## ${at}`,
  '',
  `- threat: ${entry.externalId} — ${entry.title}`,
  `- severity: ${entry.severity} · layer: ${entry.layer}${entry.repo ? ` · repo: ${entry.repo}` : ''}`,
  `- verdict: ${verdict.status}`,
  ...(Array.isArray(entry.surfaces) && entry.surfaces.length ? [`- surfaces: ${entry.surfaces.join(', ')}`] : []),
  ...(entry.githubIssue ? [`- issue: ${entry.githubIssue}`] : []),
  '',
  String(verdict.assessment).trim(),
  '',
].join('\n');

/**
 * impure (fail-soft) — append the verdict to the lane's assessment note for
 * this threat. Never throws; never creates the lane's workspace.
 * @param {{entry: Object, verdict: Object}} args the settled entry + the verdict that settled it
 * @returns {Promise<string|null>} the note's path, or null when nothing was written
 */
export const journalAssessment = async ({ entry, verdict }) => {
  try {
    const laneId = verdict?.assessedBy;
    if (typeof laneId !== 'string' || !laneId) return null;
    const laneDir = neumaWorkspace.pathFor(laneId);
    const laneExists = await fs.access(laneDir).then(() => true, () => false);
    if (!laneExists) {
      log.warn('no lane workspace to journal into — verdict stands unjournaled', { laneId, id: entry?.id });
      return null;
    }
    const dir = path.join(laneDir, 'security', 'assessments');
    await fs.mkdir(dir, { recursive: true });
    const at = entry.assessedAt || new Date().toISOString();
    const file = path.join(dir, noteNameFor(entry, at));
    const exists = await fs.access(file).then(() => true, () => false);
    const heading = `# Assessment — ${entry.externalId}: ${entry.title}\n\n`;
    await fs.appendFile(file, `${exists ? '\n' : heading}${sectionFor(entry, verdict, at)}`, 'utf8');
    return file;
  } catch (err) {
    log.warn('journal note failed — the verdict stands', { id: entry?.id, error: err.message });
    return null;
  }
};
