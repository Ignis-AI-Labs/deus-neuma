// fs-name-search — find a file by its name across every folder a neuma may read, at once.
//
// Design note, 2026-11-14: […] Before this a search with no folder named looked in the
// being's own workspace alone and walked one entry at a time, re-resolving each against the wall,
// stopping at 50,000 entries: a drive holds hundreds of thousands, so the being fell back to listing
// folders one by one. Now one search walks every root it was given, many folders at a time, and the
// best match comes first (the exact name, then names that start with it).
//
// The walk never follows a link into a folder, so it cannot leave the roots it started from; a link
// to a file is listed only when the wall clears where it leads (`clearLink`). Every folder it enters
// and every name it lists meets the deny law and the other-house wall (`withheld`), as the caller
// defines them. Folders whose
// names start with a dot, and dependency and version-control folders, are skipped unless asked for,
// and the result says so. impure (fs)
import fs from 'fs/promises';
import path from 'path';
import { Minimatch } from 'minimatch';

export const NAME_SEARCH = Object.freeze({ MAX_ENTRIES: 4_000_000, MAX_RESULTS: 200, KEEP: 2000, TIME_MS: 25_000, PARALLEL: 48 });
/** Folders skipped unless the search names them or passes its own excludePatterns. */
export const NAME_SEARCH_EXCLUDES = Object.freeze(['node_modules', '.git', '__pycache__', '.venv']);

/**
 * How a pattern matches: a plain word is matched inside the NAME, ignoring case ("budget" finds
 * Budget-2026.xlsx anywhere); a glob is matched against the path below its root. Pure.
 * @param {string} raw
 * @returns {{test: (name: string, relative: string) => boolean, rank: (name: string) => number, plain: string|null, dotted: boolean}}
 */
export const nameMatcher = (raw) => {
  const p = String(raw || '').trim();
  const dotted = p.startsWith('.') || /(^|[\\/])\./.test(p);
  if (!p || /[*?[\]{}\\/]/.test(p)) {
    const glob = !p ? '**/*' : (p.includes('/') || p.startsWith('**') ? p : `**/${p}`);
    const mm = new Minimatch(glob, { dot: true, nocase: true });
    return { test: (_name, relative) => mm.match(relative.split(path.sep).join('/')), rank: () => 2, plain: null, dotted };
  }
  const want = p.toLowerCase();
  return {
    test: (name) => name.toLowerCase().includes(want),
    // the exact name first, then names that start with it, then the rest
    rank: (name) => { const n = name.toLowerCase(); return n === want || n.replace(/\.[^.]+$/, '') === want ? 0 : (n.startsWith(want) ? 1 : 2); },
    plain: want,
    dotted,
  };
};

// pure — the folders a walk passes by: plain names by name, globs against the path below the root
const excluder = (patterns) => {
  const names = new Set(patterns.filter((p) => !/[*?[\]{}/]/.test(p)));
  const globs = patterns.filter((p) => /[*?[\]{}/]/.test(p)).map((p) => new Minimatch(p, { dot: true }));
  return (name, relative) => names.has(name) || globs.some((g) => g.match(relative));
};

/**
 * Walk the roots for names that match. impure
 * @param {{roots: string[], pattern: string, excludePatterns?: string[]|null, hidden?: boolean,
 *   withheld: (fullPath: string) => boolean, clearLink: (fullPath: string) => Promise<string|null>}} ask
 *   `clearLink` answers where a link leads when the wall allows it, else null
 * @returns {Promise<{results: string[], more: number, walked: number, withheld: number, hiddenSkipped: number, stopped: string|null, unfinished: string[]}>}
 */
export const searchNames = async ({ roots, pattern, excludePatterns = null, hidden = false, withheld, clearLink }) => {
  const match = nameMatcher(pattern);
  const skip = excluder(Array.isArray(excludePatterns) ? excludePatterns : NAME_SEARCH_EXCLUDES);
  const seeHidden = hidden || match.dotted;
  const found = [];
  const counts = { walked: 0, withheld: 0, hiddenSkipped: 0 };
  let stopped = null;
  const deadline = Date.now() + NAME_SEARCH.TIME_MS;
  const queue = roots.map((root) => ({ root, dir: root }));

  const visit = async ({ root, dir }) => {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (stopped) return;
      counts.walked += 1;
      if (counts.walked >= NAME_SEARCH.MAX_ENTRIES) { stopped = 'entries'; return; }
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full);
      if (entry.isDirectory() && skip(entry.name, relative)) continue;
      if (!seeHidden && entry.name.startsWith('.')) { if (entry.isDirectory()) counts.hiddenSkipped += 1; continue; }
      // the law is asked of what the walk enters or names; a file it passes by is neither read nor listed
      const named = match.test(entry.name, relative);
      const folder = entry.isDirectory();
      if (!named && !folder) continue;
      if (withheld(full)) { counts.withheld += 1; continue; }
      if (entry.isSymbolicLink()) {
        if (named && await clearLink(full)) found.push(full);
        continue; // never into a linked folder: the walk stays inside its roots
      }
      if (named) found.push(full);
      if (found.length >= NAME_SEARCH.KEEP) { stopped = 'results'; return; }
      if (folder) queue.push({ root, dir: full });
    }
  };

  // many folders at a time: a worker with nothing to take waits while others may still add folders
  let active = 0;
  const worker = async () => {
    for (;;) {
      if (stopped) return;
      if (Date.now() > deadline) { stopped = 'time'; return; }
      const next = queue.pop();
      if (!next) {
        if (active === 0) return;
        await new Promise((r) => setTimeout(r, 1));
        continue;
      }
      active += 1;
      try { await visit(next); } finally { active -= 1; }
    }
  };
  await Promise.all(Array.from({ length: NAME_SEARCH.PARALLEL }, worker));

  const ranked = found
    .map((full, i) => ({ full, rank: match.rank(path.basename(full)), i }))
    .sort((a, b) => a.rank - b.rank || a.full.length - b.full.length || a.i - b.i);
  return {
    results: ranked.slice(0, NAME_SEARCH.MAX_RESULTS).map((r) => r.full),
    more: Math.max(0, ranked.length - NAME_SEARCH.MAX_RESULTS),
    ...counts,
    stopped,
    // the roots with folders still unwalked when the search stopped
    unfinished: stopped ? [...new Set(queue.map((q) => q.root))] : [],
  };
};
