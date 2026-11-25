// clone-splits — every shadow clone split on disk from the moment it starts (Design note, 2026-11-19: […]). One file a split in the original's lane, clones/splits/<splitId>.json: each clone's title,
// its GOAL, its whole task and its own sitting, where it stands (waiting, working, done, failed, cut) and its report;
// the chat it was split from, and, once every clone has reported, how long it took. So a clone a crash, a quit or an
// error stopped is found again and resumed in its own sitting — its words and acts so far are that sitting's record
// (turn-keep.js lands a turn the close cut) — and a chat reopened later shows each split as it truly stands
// (splitsAsTheyStand), never […] for clones nothing runs any more.
// The judging is PURE; the files are impure.

import fs from 'node:fs/promises';
import path from 'node:path';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { createWriteChain } from './write-chain.js';

export const ENDED = Object.freeze(new Set(['done', 'failed', 'cut']));
const chains = new Map();
const chainFor = (file) => {
  if (!chains.has(file)) chains.set(file, createWriteChain());
  return chains.get(file);
};
const fileOf = (laneId, splitId) => path.join(neumaWorkspace.pathFor(laneId), 'clones', 'splits', `${String(splitId).replace(/[^a-zA-Z0-9-]/g, '')}.json`);

// impure — whole-file write through a temp file, so a reader never sees half of one.
const write = async (file, value) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
};

/** impure — a split as kept, or null. */
export const readSplit = async (laneId, splitId) => {
  try {
    return JSON.parse(await fs.readFile(fileOf(laneId, splitId), 'utf8'));
  } catch {
    return null;
  }
};

/** impure — keep a split whole (its start). */
export const saveSplit = (laneId, split) => {
  const file = fileOf(laneId, split.splitId);
  return chainFor(file)(() => write(file, { ...split, updatedAt: new Date().toISOString() }));
};

/** impure — change a split as it goes: one clone (index) or the split itself (index null). Returns the split, or null. */
export const updateSplit = (laneId, splitId, index, patch) => {
  const file = fileOf(laneId, splitId);
  return chainFor(file)(async () => {
    const split = await readSplit(laneId, splitId);
    if (!split) return null;
    const next = index == null
      ? { ...split, ...patch }
      : { ...split, clones: split.clones.map((c) => (c.index === index ? { ...c, ...patch } : c)) };
    await write(file, { ...next, updatedAt: new Date().toISOString() });
    return next;
  });
};

/** pure — the clones of a split that did not finish: what a resume may take up (all of them, or the ones named). */
export const stoppedClones = (split, only = null) => (split?.clones ?? [])
  .filter((c) => c.state !== 'done' && (!only?.length || only.includes(c.index)));

/**
 * pure — a chat's clone chip as its split stands now: each clone's state, sitting, goal and report from the kept
 * split; a split nothing in this process runs has every unfinished clone STOPPED (cut), and one whose clones all
 * reported says how long it took. `live`: this process is running the split.
 */
export const splitAsItStands = (chip, kept, live) => {
  const byIndex = new Map((kept?.clones ?? []).map((c) => [c.index, c]));
  const clones = (chip.clones ?? []).map((c) => {
    const k = byIndex.get(c.index);
    const merged = k ? { ...c, goal: k.goal ?? c.goal ?? null, sessionId: k.sessionId ?? c.sessionId ?? null, state: k.state ?? c.state, report: k.report ?? c.report ?? null } : c;
    return !live && !ENDED.has(merged.state) ? { ...merged, state: 'cut' } : merged;
  });
  const finished = kept?.seconds != null && clones.every((c) => c.state === 'done');
  return {
    ...chip, clones,
    ...(finished ? { seconds: kept.seconds, together: kept.together ?? chip.together ?? null, record: kept.record ?? chip.record ?? null, cutOff: false } : {}),
    ...(!live && !finished && clones.some((c) => c.state !== 'done') ? { stopped: true } : {}),
  };
};

/** impure — every clone chip in a chat's rows, as its split stands now (the rows are not changed on disk). */
export const splitsAsTheyStand = async (laneId, rows, isLive = () => false) => {
  const chips = rows.flatMap((r) => (Array.isArray(r?.tools) ? r.tools : [])).filter((t) => t?.split?.splitId && t.split.clones?.length);
  if (!chips.length) return rows;
  const kept = new Map(await Promise.all([...new Set(chips.map((t) => t.split.splitId))].map(async (id) => [id, await readSplit(laneId, id)])));
  return rows.map((r) => (Array.isArray(r?.tools) && r.tools.some((t) => t?.split?.splitId)
    ? { ...r, tools: r.tools.map((t) => (t?.split?.splitId && t.split.clones?.length ? { ...t, split: splitAsItStands(t.split, kept.get(t.split.splitId), isLive(t.split.splitId)) } : t)) }
    : r));
};
