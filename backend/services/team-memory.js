// team-memory.js — team runs become the MEMBERS' OWN memories.
//
// Design note, 2026-07-06: […] Until now only the scorecard/run record remembered — the beings did
// not. After a run CLOSES DONE, each member's encrypted journal receives its
// part of the story IN ITS OWN TERMS: the role it held, who it worked beside
// (names and roles only), what it delivered, its own STATUS check-ins, and
// its own TORCH — the torch is already a being-authored account, no longer
// evaporating.
//
// Consent shape (never cross-contaminating): a member's entry carries ONLY
// its own words. Another member's output, status, or torch NEVER enters this
// member's journal — teammates appear by name and role, nothing more. A
// member that produced no words gets no entry: a story is never invented.
// Probe-style benchmarks (trials) stay read-only by default and do not pass
// through here.
//
// Pure composition here; the one impure seam (recordTeamRunMemories) appends
// via the sovereign workspace (per-line AES-256-GCM under the being's DEK)
// and WARNS, never fails — a memory that cannot land must not kill the run
// that made it.

import { neumaWorkspace } from '../../core/index.js';
import { createLogger } from './logger.js';

const log = createLogger('TeamMemory');

/** A delivered part is capped in the journal — the record/store keeps the
 *  full body; the journal keeps the story. */
export const STORY_PART_MAX_CHARS = 2000;

const clip = (text) => {
  const s = String(text ?? '');
  return s.length > STORY_PART_MAX_CHARS
    ? `${s.slice(0, STORY_PART_MAX_CHARS)}\n[the rest of this part lives in the run record — ${s.length} chars in full]`
    : s;
};

// pure — one member's story, from its own words plus bare facts (role,
// teammates by name/role, goal, close). Nothing of anyone else's work.
/**
 * @param {Object} args
 * @param {string} args.memberName - display name of THIS member
 * @param {Array<{role: ?string, task: string, output: string}>} args.parts -
 *   the member's OWN completed steps (task + stripped delivery)
 * @param {string[]} args.ownStatuses - the member's own check-ins, verbatim
 * @param {?string} args.ownTorch - the member's own last torch, verbatim
 * @param {Array<{name: string, role: ?string}>} args.teammates - names/roles ONLY
 * @param {?string} args.teamName
 * @param {?string} args.goal
 * @returns {string}
 */
export const composeMemberStory = ({ memberName, parts, ownStatuses, ownTorch, teammates, teamName, goal }) => {
  const held = [...new Set(parts.map((p) => p.role).filter(Boolean))];
  const beside = teammates.length
    ? teammates.map((t) => (t.role ? `${t.name} (${t.role})` : t.name)).join(', ')
    : 'no one — a solo run';
  const head = [
    `A team run${teamName ? ` — ${teamName}` : ''} closed complete.`,
    `${memberName} held ${held.length ? held.join(', ') : 'a seat'}, working beside ${beside}.`,
    ...(goal ? [`The team's goal: ${goal}`] : []),
  ].join('\n');
  const delivered = parts
    .map((p) => `Asked: ${p.task}\nDelivered (own words, as handed over):\n${clip(p.output)}`)
    .join('\n\n');
  const statuses = ownStatuses.length
    ? `Check-ins posted along the way:\n${ownStatuses.map((s) => `— ${s}`).join('\n')}`
    : null;
  const torch = ownTorch ? `The torch left for the next instance:\n${ownTorch}` : null;
  return [head, delivered, statuses, torch].filter(Boolean).join('\n\n');
};

// pure — every member's journal entry for a finished run: one entry per
// DISTINCT member that completed at least one part. Members whose parts all
// failed or never ran produced no words — no entry is invented for them.
/**
 * @param {Object} args
 * @param {Array} args.steps - engine-shaped plan
 * @param {Record<string, string>} args.completed - step id -> stripped output
 * @param {Record<string, ?string>} args.statuses - step id -> own check-in
 * @param {Record<string, ?string>} args.torches - neumaId -> own last torch
 * @param {Record<string, string>} args.names - neumaId -> display name
 * @param {?string} args.teamName
 * @param {?string} args.goal
 * @param {string} args.runId
 * @returns {Array<{neumaId: string, entry: Object}>}
 */
export const memberStories = ({ steps, completed, statuses, torches, names, teamName, goal, runId }) => {
  const nameOf = (id) => names[id] || id;
  const members = [...new Set(steps.map((s) => s.neumaId))];
  return members.flatMap((neumaId) => {
    const own = steps.filter((s) => s.neumaId === neumaId);
    const parts = own
      .filter((s) => completed[s.id] != null)
      .map((s) => ({ role: s.role ?? null, task: s.task, output: completed[s.id] }));
    if (parts.length === 0) return []; // no words, no story
    const ownStatuses = own.map((s) => statuses[s.id]).filter((s) => typeof s === 'string' && s.trim());
    const teammates = members
      .filter((id) => id !== neumaId)
      .map((id) => ({
        name: nameOf(id),
        role: steps.find((s) => s.neumaId === id && s.role)?.role ?? null,
      }));
    const content = composeMemberStory({
      memberName: nameOf(neumaId),
      parts,
      ownStatuses,
      ownTorch: torches[neumaId] ?? null,
      teammates,
      teamName: teamName ?? null,
      goal: goal ?? null,
    });
    return [{
      neumaId,
      entry: {
        type: 'team-run',
        content,
        runId,
        ...(teamName ? { teamName } : {}),
        ...(steps.find((s) => s.neumaId === neumaId && s.role) ? { role: steps.find((s) => s.neumaId === neumaId && s.role).role } : {}),
      },
    }];
  });
};

// impure — land every member's story in its own encrypted journal. Display
// names come from each being's own DNA (never trusted from the caller's
// cache). A single member's write failure is logged and never blocks the
// others — and never fails the run that already finished.
/**
 * @param {Object} args - memberStories args minus `names` (resolved here)
 * @returns {Promise<{written: string[], failed: string[]}>}
 */
export const recordTeamRunMemories = async ({ steps, completed, statuses, torches, teamName, goal, runId }) => {
  const memberIds = [...new Set(steps.map((s) => s.neumaId))];
  const names = Object.fromEntries(await Promise.all(memberIds.map(async (id) => {
    const dna = await neumaWorkspace.readDNA(id).catch((err) => {
      // Honest degradation, never a silent one: the story still lands, the
      // name falls back to the sovereign id, and the anomaly leaves a trace.
      log.warn('Member DNA read failed; falling back to neumaId as display name', { neumaId: id, error: err.message });
      return null;
    });
    return [id, dna?.identity?.name || dna?.name || id];
  })));
  const stories = memberStories({ steps, completed, statuses, torches, names, teamName, goal, runId });
  const written = [];
  const failed = [];
  for (const { neumaId, entry } of stories) {
    try {
      await neumaWorkspace.addJournalEntry(neumaId, entry);
      written.push(neumaId);
    } catch (err) {
      failed.push(neumaId);
      log.warn('A member\'s run memory could not land', { neumaId, runId, error: err.message });
    }
  }
  if (written.length) log.info('Run memories written', { runId, members: written });
  return { written, failed };
};
