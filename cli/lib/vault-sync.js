// Vault sync engine — reads the witness's claude-mem store and materializes
// the collective knowledge vault (memory pyramid T3-commons) as a folder of
// markdown notes any Obsidian-style tool can open. Generated zones are
// observations/ and sessions/; memory/ mirrors an already-markdown memory
// dir verbatim. Hand-edited generated notes are preserved (see sync-plan).
//
// Uses node:sqlite (read-only) rather than better-sqlite3: the CLI must run
// under whatever runtime invokes it, and the repo's native ABI is rebuilt
// per-runtime for the app/tests — a built-in engine sidesteps that entirely
// for this read-only consumer.
//
// impure (filesystem + SQLite reads, filesystem writes)

import { DatabaseSync } from 'node:sqlite';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { hashText, parseNote, renderNote } from '../../core/vault/note.js';
import { buildNotes } from '../../core/vault/claude-mem-notes.js';
import { planSync } from '../../core/vault/sync-plan.js';

const OBSERVATION_COLUMNS =
  'id, memory_session_id, project, type, title, subtitle, narrative, facts, concepts, files_read, files_modified, created_at, content_hash';
const SUMMARY_COLUMNS =
  'id, memory_session_id, project, request, investigated, learned, completed, next_steps, notes, created_at';

/**
 * Read observation + session-summary rows from a claude-mem SQLite store.
 * @param {{ dbPath: string, project?: string }} params
 * @returns {{ observations: object[], summaries: object[] }}
 */
const readClaudeMem = ({ dbPath, project }) => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const where = project ? ' WHERE project = ?' : '';
    const args = project ? [project] : [];
    return {
      observations: db.prepare(`SELECT ${OBSERVATION_COLUMNS} FROM observations${where}`).all(...args),
      summaries: db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM session_summaries${where}`).all(...args),
    };
  } finally {
    db.close();
  }
};

const GENERATED_ZONES = ['observations', 'sessions'];

/**
 * Index the generated zones of an existing vault for the sync planner.
 * @param {string} outDir
 * @returns {Promise<Map<string, { sourceHash: string, stampedBodyHash: string, actualBodyHash: string }>>}
 */
const indexVault = async (outDir) => {
  const index = new Map();
  for (const zone of GENERATED_ZONES) {
    let entries;
    try {
      entries = await readdir(join(outDir, zone), { recursive: true, withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const abs = join(entry.parentPath, entry.name);
      const { frontmatter, body } = parseNote(await readFile(abs, 'utf8'));
      index.set(relative(outDir, abs), {
        sourceHash: String(frontmatter.source_hash || ''),
        stampedBodyHash: String(frontmatter.body_hash || ''),
        actualBodyHash: hashText(body.replace(/\n$/, '')),
      });
    }
  }
  return index;
};

const writeNoteFile = async (outDir, note) => {
  const abs = join(outDir, note.relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, renderNote(note), 'utf8');
};

/**
 * Mirror a directory of already-vault-native markdown (e.g. the witness's
 * curated memory dir) into <outDir>/memory/, top level only. The source dir
 * stays the single place to edit — differing vault copies are overwritten.
 * @param {{ srcDir: string, outDir: string, dryRun: boolean }} params
 * @returns {Promise<number>} files copied
 */
const mirrorMemoryDir = async ({ srcDir, outDir, dryRun }) => {
  const entries = await readdir(srcDir, { withFileTypes: true });
  let copied = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const content = await readFile(join(srcDir, entry.name), 'utf8');
    const dest = join(outDir, 'memory', entry.name);
    const current = await readFile(dest, 'utf8').catch(() => null);
    if (current === content) continue;
    copied += 1;
    if (dryRun) continue;
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content, 'utf8');
  }
  return copied;
};

/**
 * Full sync run: claude-mem rows → notes → incremental plan → disk.
 * @param {{
 *   dbPath: string, outDir: string, project?: string,
 *   memoryDir?: string, dryRun?: boolean, force?: boolean,
 * }} params
 * @returns {Promise<{ created: number, updated: number, unchanged: number, preserved: string[], memoryCopied: number, dryRun: boolean }>}
 */
export const runVaultSync = async ({ dbPath, outDir, project, memoryDir, dryRun = false, force = false }) => {
  const rows = readClaudeMem({ dbPath, project });
  const desired = buildNotes(rows);
  const existing = await indexVault(outDir);
  const plan = planSync(desired, existing, { force });

  if (!dryRun) {
    for (const note of [...plan.creates, ...plan.updates]) {
      await writeNoteFile(outDir, note);
    }
  }
  const memoryCopied = memoryDir ? await mirrorMemoryDir({ srcDir: memoryDir, outDir, dryRun }) : 0;

  return Object.freeze({
    created: plan.creates.length,
    updated: plan.updates.length,
    unchanged: plan.unchanged,
    preserved: plan.preserved,
    memoryCopied,
    dryRun,
  });
};
