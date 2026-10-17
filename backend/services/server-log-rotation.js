/**
 * THE SERVER LOG GENERATIONS (#506) — every crash keeps its last words.
 *
 * The supervisor's relight used to rename the live log to `.prev`, overwriting
 * the previous `.prev` — one crash generation deep, no more. Overnight
 * 2026-09-12/13 the substrate SIGABRT'd five times and only the final crash's
 * log survived; the benchmarks handoff could not say whether all five deaths
 * shared a cause because the evidence had rotated away ([…] — reports/handoff-20260913). Now the outgoing `.prev` moves into
 * a timestamped generations ring before the fresh log takes its place, pruned
 * to a bounded count so a crash-loop cannot fill the disk.
 *
 * `.prev` stays the freshest archive: every existing "its last words" pointer
 * (the supervisor's exit/relight/stand-down logs) keeps meaning exactly what
 * it says.
 */
import { readdirSync, renameSync, rmSync } from 'fs';
import path from 'path';

/** How many timestamped generations the ring retains beyond `.prev`. */
export const SERVER_LOG_GENERATIONS = 8;

/** impure — rotates the live log into `.prev` and the old `.prev` into the
 * generations ring, pruning the oldest past the bound. Best-effort by law: a
 * rotation failure must never cost a substrate launch, so every step swallows
 * its own error and the truth is simply less history. */
export const rotateServerLog = (logFile, { keep = SERVER_LOG_GENERATIONS, at = () => new Date() } = {}) => {
  const prev = `${logFile}.prev`;
  try {
    const stamp = at().toISOString().replace(/[:.]/g, '-');
    renameSync(prev, `${logFile}.${stamp}`);
  } catch { /* no earlier generation — first rotation, or history already pruned */ }
  try { renameSync(logFile, prev); } catch { /* first boot — nothing to retain */ }

  try {
    const dir = path.dirname(logFile);
    const base = path.basename(logFile);
    const generations = readdirSync(dir)
      .filter((name) => name.startsWith(`${base}.`) && name !== `${base}.prev`)
      .sort();
    for (const stale of generations.slice(0, Math.max(0, generations.length - keep))) {
      try { rmSync(path.join(dir, stale), { force: true }); } catch { /* a lost prune is no launch's business */ }
    }
  } catch { /* the ring could not be read — the launch still goes ahead */ }
};
