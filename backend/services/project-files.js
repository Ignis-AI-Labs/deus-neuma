// project-files.js — shared files as always-on turn context: a curated set of
// files, each proven to live inside its owner's folder, read and injected as a
// bounded section so the neuma sees the working material without a tool call
// (CAMPAIGN_FILES_SHAPE). The Projects feature that first used it was removed
// (2026-11-10).
//
// "Text-extractable with certainty" means we do NOT trust the extension alone:
// every file is content-sniffed for a NUL byte and skipped if it looks binary.
// Reads are bounded three ways — a hard per-file byte ceiling (never slurp a
// giant file), a per-file char cap, and a total char budget — so a project
// can never silently blow the context window. Everything skipped is reported,
// never dropped silently.

import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './logger.js';
import { checkPathAccess } from './tool-sandbox.js';
import { docFence } from './doc-fence.js';

const log = createLogger('Project.Files');

// Bounds (chars ≈ tokens/4). Deliberately conservative — shared files are
// always-on, paid on every turn.
export const HARD_FILE_BYTES = 512 * 1024; // never read a file larger than this
export const PER_FILE_CHARS = 20000;       // ~5k tokens of any one file
export const TOTAL_CHARS = 60000;          // ~15k tokens across all shared files
export const MAX_FILES = 20;

// pure — a file looks binary if the sampled text carries a NUL. Real source /
// docs / data never do; most binary formats do within the first KB. NUL is
// built from its char code — a literal control char in source is a footgun.
const NUL = String.fromCharCode(0);
const looksBinary = (text) => text.includes(NUL);

// impure — read one shared file as bounded text. Returns { text, chars,
// truncated } on success or { skip: reason } when it can't be text.
const readOne = async (absPath, perFileChars) => {
  // RE-VERIFY AT READ TIME, not only when the file was tied. Attachment is a
  // read grant that is paid on every turn, so the check must happen at the
  // moment of reading: a file that was innocent when it was attached can be
  // replaced by a symlink into the denied set afterwards, and nothing else
  // would notice. Same shape as the post scheduler re-resolving its media
  // before an irreversible send. A denial is REPORTED as a skip, never silent.
  const real = await fs.realpath(absPath).catch(() => null);
  if (!real) return { skip: 'missing' };
  const verdict = checkPathAccess(real, []);
  if (!verdict.allowed) return { skip: `refused (${verdict.reason})` };
  const stat = await fs.stat(real).catch(() => null);
  if (!stat || !stat.isFile()) return { skip: 'missing' };
  if (stat.size > HARD_FILE_BYTES) return { skip: `too large (${Math.round(stat.size / 1024)}KB)` };
  let raw;
  try {
    raw = await fs.readFile(real, 'utf8');
  } catch (err) {
    return { skip: `unreadable (${err.code || err.message})` };
  }
  if (looksBinary(raw)) return { skip: 'not text (binary)' };
  const truncated = raw.length > perFileChars;
  return { text: truncated ? raw.slice(0, perFileChars) : raw, chars: Math.min(raw.length, perFileChars), truncated };
};

/**
 * Read a curated set of shared files into ONE bounded prompt section.
 *
 * Generalised from the project reader on 2026-07-27 so campaigns can carry
 * their material the same way (Founder: *[…]*). Everything hard here — the
 * byte ceiling, the per-file and total char budgets, the NUL binary sniff, the
 * backtick fence that a file body cannot break out of, and reporting every skip
 * instead of dropping it — is exactly what a campaign needs too, and none of it
 * should exist twice.
 *
 * `owner.folder` is optional: with it, paths are shown relative to the folder;
 * without it (a campaign has no folder) the stored path is shown as given.
 *
 * @param {{folder?: string, name?: string, sharedFiles?: Array<{path: string}>}} owner
 * @param {{id: string, label: string, heading: string, describe: (name?: string) => string}} shape
 * @param {{perFileChars?: number, totalChars?: number, maxFiles?: number}} [limits]
 * @returns {Promise<{ section: {id,label,text}|null, included: Array, skipped: Array }>}
 */
// impure
export const buildSharedFilesSection = async (owner, shape, limits = {}) => {
  const perFileChars = limits.perFileChars ?? PER_FILE_CHARS;
  const totalChars = limits.totalChars ?? TOTAL_CHARS;
  const maxFiles = limits.maxFiles ?? MAX_FILES;

  const project = owner;
  const files = Array.isArray(project?.sharedFiles) ? project.sharedFiles : [];
  const included = [];
  const skipped = [];
  const blocks = [];
  let used = 0;

  for (const f of files) {
    if (included.length >= maxFiles) { skipped.push({ path: f.path, reason: `over the ${maxFiles}-file limit` }); continue; }
    const remaining = totalChars - used;
    if (remaining <= 0) { skipped.push({ path: f.path, reason: 'over the total context budget' }); continue; }
    const res = await readOne(f.path, Math.min(perFileChars, remaining));
    if (res.skip) { skipped.push({ path: f.path, reason: res.skip }); continue; }
    const rel = path.isAbsolute(f.path) && project.folder
      ? path.relative(project.folder, f.path) || path.basename(f.path)
      : f.path;
    const fence = docFence(res.text);
    blocks.push(`### ${rel}${res.truncated ? ' (truncated)' : ''}\n${fence}\n${res.text}\n${fence}`);
    used += res.chars;
    included.push({ path: f.path, chars: res.chars, truncated: res.truncated });
  }

  if (skipped.length) log.debug('shared files skipped', { count: skipped.length, reasons: skipped.map((s) => s.reason) });
  if (blocks.length === 0) return { section: null, included, skipped };

  return {
    section: {
      id: shape.id,
      label: shape.label,
      text: `## ${shape.heading}\n${shape.describe(project.name)}\n\n${blocks.join('\n\n')}`,
    },
    included,
    skipped,
  };
};

/** The campaign shape — the same reader, aimed at a campaign's own material. */
export const CAMPAIGN_FILES_SHAPE = Object.freeze({
  id: 'campaignFiles',
  label: 'CAMPAIGN FILES',
  heading: 'Campaign material',
  describe: (name) => `The operator has tied these files to the campaign${name ? ` "${name}"` : ''} — its brief, brand voice, approved copy, and reference material. They are always-on context you can read directly; no tool is needed to open them. Work from THESE rather than inventing new positioning.`,
});
