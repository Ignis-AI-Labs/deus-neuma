/**
 * bench-live — WHAT IS RUNNING ON THIS MACHINE, AND HOW FAR (Design note, 2026-10-15:
 * […]).
 *
 * Machine-wide, never per desk: a run launched from a chat, from the BENCH
 * window, or by another desk process (the house desk driving a night queue)
 * is read the same way — from the runner's own command line and the
 * benchmarks repository's live work directory. Read only; never writes into
 * the sovereign repository.
 *
 *   - which run: every `… bench.mjs run <cell> … --arm <arm>` process (a shell
 *     whose command text merely MENTIONS bench.mjs run is no runner)
 *   - how far: the rig lock names the arm holding the GPU
 *     (active.lock/owner.json); its work directory
 *     `work/<comparisonId>-<arm>-a<attempt>-<stamp>/` holds the item total
 *     (raw/manifest.json protocol.sampleLimit) and the items done — one
 *     agent-receipts/request-NNNN.json per finished item on an agent arm, the
 *     lm-eval progress line (stderr/lm-eval.log) on a bare one. An arm that
 *     writes nothing while it runs (Inspect's bare arm) reads done: null —
 *     unknown, never guessed.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { harnessRoot } from './bench-paths.js';
import { pgrepPids, readRigLock } from './bench-status.js';

const SECONDS_PER_TICK = 100; // USER_HZ on Linux

// impure — one runner read from /proc, or null when it is not a runner / has finished
const runnerAt = async (pid) => {
  try {
    const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
    const at = argv.indexOf('run');
    if (at < 1 || !argv[at - 1].endsWith('bench.mjs')) return null;
    const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
    const started = Number((await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ')[1].split(' ')[19]) / SECONDS_PER_TICK;
    const uptime = Number((await readFile('/proc/uptime', 'utf8')).split(' ')[0]);
    return { pid, cell: argv[at + 1] || null, arm: flag('--arm'), minutes: Math.max(0, Math.round((uptime - started) / 60)) };
  } catch {
    return null;
  }
};

/** Every benchmark runner live on this machine. impure. */
export const liveRunners = async () =>
  (await Promise.all((await pgrepPids('bench\\.mjs run ')).map(runnerAt))).filter(Boolean);

// pure — the newest lm-eval progress line, e.g. […]
export const tqdmProgress = (text) => {
  const hits = [...String(text || '').matchAll(/(\d+)\/(\d+) \[/g)];
  const last = hits.at(-1);
  return last ? { done: Number(last[1]), total: Number(last[2]) } : null;
};

// impure — the live work directory of the arm holding the rig lock, newest first
const workDirFor = async (root, owner) => {
  if (!owner?.comparisonId || !owner?.arm) return null;
  const prefix = `${owner.comparisonId}-${owner.arm}-a${owner.attempt ?? 1}-`;
  const dirs = (await readdir(join(root, 'work')).catch(() => [])).filter((d) => d.startsWith(prefix));
  const dated = await Promise.all(dirs.map(async (d) => ({ d, at: (await stat(join(root, 'work', d)).catch(() => null))?.mtimeMs || 0 })));
  return dated.sort((a, b) => b.at - a.at)[0]?.d ? join(root, 'work', dated[0].d) : null;
};

// impure — items done and the total for the arm holding the lock
const armProgress = async (root, owner) => {
  const dir = await workDirFor(root, owner);
  if (!dir) return { done: null, total: null };
  const manifest = JSON.parse(await readFile(join(dir, 'raw', 'manifest.json'), 'utf8').catch(() => '{}'));
  const limit = manifest?.protocol?.sampleLimit;
  const receipts = (await readdir(join(dir, 'agent-receipts')).catch(() => [])).filter((f) => /^request-\d+\.json$/.test(f)).length;
  const tqdm = tqdmProgress(await readFile(join(dir, 'stderr', 'lm-eval.log'), 'utf8').catch(() => ''));
  const total = Number.isInteger(limit) ? limit : tqdm?.total ?? null;
  const done = receipts > 0 ? receipts : tqdm ? tqdm.done : owner.arm === 'bare' ? null : 0;
  return { done, total };
};

/**
 * What runs now: each runner with its cell, arm and minutes; the one holding
 * the rig lock also with its comparison and items done of total. impure.
 * @returns {Promise<Array<{pid: number, cell: ?string, arm: ?string, minutes: number,
 *   comparisonId?: string, done?: ?number, total?: ?number}>>}
 */
export const liveProgress = async (root = harnessRoot()) => {
  const runners = await liveRunners();
  if (!runners.length) return [];
  const lock = await readRigLock(root);
  const owner = lock?.alive ? lock.owner?.owner || null : null;
  const progress = owner ? await armProgress(root, owner) : null;
  return runners.map((r) => (owner && r.arm === owner.arm
    ? { ...r, comparisonId: owner.comparisonId, ...progress }
    : r));
};

/** One line a person reads: […]. Pure. */
export const liveLine = (run) => [
  run.cell || '?',
  run.arm ? `${run.arm} arm` : null,
  Number.isInteger(run.done) && Number.isInteger(run.total) ? `${run.done} of ${run.total} items` : null,
  `${run.minutes} min`,
].filter(Boolean).join(' · ');
