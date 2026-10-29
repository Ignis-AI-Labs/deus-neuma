// live-shell-walls.js — what the LIVE shell may not write inside the open folder. impure (env, fs)
//
// THE OPEN FOLDER on AUTO (open-folder-autonomy.js) binds the operator's folder read-write into
// the coding shell. The secret masks (witness-coding-sandbox.js enumerateSecretMasks) already
// hide .git, keys, every `workspaces`/`ai-witnesses` folder and data/{dna,dna-cache,memory-store,
// settings} — but a write through the shell must also never reach the platform's own state, the
// same walls the file tools hold (sandbox-path-policy.js laneStateWriteReason, platform-write-
// walls.js): the lane grounds wherever they are named, the data root, this install's settings and
// realm, the operator's login and schedule files, the config their own tools trust, and a
// repository's agent settings and hook scripts. Audit 2026-10-28 (C-01: a being must never
// rewrite its own consent files, whatever path it writes through).
//
// Each such place INSIDE the open folder is bound read-only in the shell (before the masks, so a
// masked secret below it stays masked). An open folder that lies INSIDE one of them is no place
// to work live at all: the shell falls back to its overlay layer, where writes never reach disk.

import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { getDataRoot } from './data-root.js';
import { platformWriteWalls } from './platform-write-walls.js';
import { isWithin } from './ground-roots.js';
import { getWitnessesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getHarnessRoot } from '../../core/workspace/lane-grounds.js';

// A repository's own gates beside .git (masked already): the agent settings that decide what a
// coding agent may run, and the hooks directory a repository's hooksPath names.
const REPO_GATE_RELS = Object.freeze(['.claude', path.join('scripts', 'git-hooks')]);

// impure — the path and, when a link stands in its chain, its real form too
const spellings = (p) => {
  const lexical = path.resolve(p);
  try { const real = realpathSync(lexical); return real === lexical ? [lexical] : [lexical, real]; } catch { return [lexical]; }
};

/**
 * The platform places a live shell must treat as read-only: the lane grounds, the data root and
 * every platform write wall that names a place. impure (env, realpath).
 * @returns {string[]}
 */
const platformPlaces = () => {
  const house = getWorkspacesRoot();
  const named = [house, getWitnessesRoot(), getHarnessRoot(house), getDataRoot()];
  const walls = platformWriteWalls().filter((w) => typeof w.path === 'string').map((w) => w.path);
  return [...new Set([...named, ...walls].filter(Boolean).flatMap(spellings))];
};

/**
 * May the shell work LIVE in this open folder, and what must stay read-only inside it?
 * @param {string} ground - the open folder (the shell's source root)
 * @param {{ places?: string[] }} [opts] - the platform places (default: platformPlaces())
 * @returns {{ live: true, readOnly: string[] } | { live: false, reason: string }}
 */
export const liveShellWalls = (ground, { places = platformPlaces() } = {}) => {
  const grounds = spellings(ground);
  const inside = places.find((place) => grounds.some((g) => isWithin(g, place)));
  if (inside) {
    return { live: false, reason: `the open folder lies inside platform state (${inside}); the shell works in its overlay layer there` };
  }
  const below = places.filter((place) => grounds.some((g) => isWithin(place, g)) && existsSync(place));
  const gates = grounds.flatMap((g) => REPO_GATE_RELS.map((rel) => path.join(g, rel))).filter((p) => existsSync(p));
  return { live: true, readOnly: [...new Set([...below, ...gates])].sort() };
};
