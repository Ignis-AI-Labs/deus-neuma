// repair-workspace-modes.mjs — restore owner-only (0o700) modes on every
// sovereign workspace directory at the live workspaces root.
//
//   node scripts/repair-workspace-modes.mjs [--check] [root ...]
//
// Why this exists: `mkdir(mode)` sets the mode only on directories it CREATES.
// Beings scaffolded before 0o700 became the law of a workspace kept their
// umask-derived 0o755, and the refinement authority layer verifies the mode
// EXACTLY — so on 2026-08-13 every pre-existing being stopped being servable
// with […],
// taking the portal's LLM turn down with it.
//
// The repair is the same one `neumaWorkspace.create` now performs, applied to
// beings that will not be created again. It never widens a mode, and it never
// leaves the declared skeleton plus the refinement/attunement subtrees.
//
// --check reports what would change and exits 1 if anything would — for a
// readiness probe that must walk the real road rather than trust the code.
//
// impure — stats and chmods sovereign directories.

import path from 'node:path';
import fs from 'node:fs/promises';
import 'dotenv/config';
import { getWorkspacesRoot, isWitnessLane, neumaWorkspace, setWorkspacesRoot } from '../core/index.js';
import { sovereignDirectories } from '../core/workspace/sovereign-directory-modes.js';
import { applyWorkspaceSettings } from '../backend/services/workspace-settings.js';

const NEUMA_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;

// The roots to sweep: whatever the operator names, else the one root the
// platform itself would boot into (persisted choice, then env, then default).
const resolveRoots = async (args) => {
  if (args.length) return args.map((root) => path.resolve(root));
  await applyWorkspaceSettings();
  return [getWorkspacesRoot()];
};

const beingsAt = async (root) => {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && NEUMA_ID.test(entry.name) && !isWitnessLane(entry.name))
    .map((entry) => entry.name)
    .sort();
};

const main = async () => {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const roots = await resolveRoots(args.filter((arg) => arg !== '--check'));
  let changed = 0;

  for (const root of roots) {
    console.log(`\n=== ${root} ===`);
    let beings;
    try {
      beings = await beingsAt(root);
    } catch (error) {
      console.error(`  unreadable: ${error.message}`);
      process.exitCode = 1;
      continue;
    }
    // The repair runs against the root being swept, not the module default.
    setWorkspacesRoot(root);
    for (const neumaId of beings) {
      // --check must not mutate, so it asks the same question by reading:
      // repairDirectoryModes reports exactly the directories it would change.
      const repaired = check
        ? await wouldRepair(root, neumaId)
        : await neumaWorkspace.repairDirectoryModes(neumaId);
      changed += repaired.length;
      const verb = check ? 'would repair' : 'repaired';
      console.log(repaired.length
        ? `  ${neumaId}: ${verb} ${repaired.length} directorie(s)`
        : `  ${neumaId}: already owner-only`);
      for (const dir of repaired) console.log(`      ${path.relative(root, dir)}`);
    }
  }

  console.log(`\n${changed} directorie(s) ${check ? 'need repair' : 'repaired'}.`);
  if (check && changed) process.exitCode = 1;
};

// The read-only twin of the repair: same target set, no chmod. Kept here
// rather than as a flag on the workspace method so the serving path carries no
// dry-run branch it can accidentally take.
const wouldRepair = async (root, neumaId) => {
  const ws = path.join(root, neumaId);
  const found = [];
  const walk = async (dir, recurse) => {
    let stats;
    try { stats = await fs.lstat(dir); } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    if (!stats.isDirectory()) return;
    if ((stats.mode & 0o777) !== 0o700) found.push(dir);
    if (!recurse) return;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), true);
    }
  };
  // Share the repair's skeleton so added domains cannot disappear from --check.
  for (const dir of sovereignDirectories(ws)) await walk(dir, false);
  for (const branch of ['refinement', 'attunement']) await walk(path.join(ws, branch), true);
  return found;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
