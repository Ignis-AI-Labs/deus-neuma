// team-step-files.js — a step's named DELIVERABLES, and the platform's check
// that they exist.
//
// A real house run marked six steps done while four had produced nothing, and
// members cited files that were never written (2026-10-10). "Done" was the
// member's claim. A plan step may now name the files it delivers — paths
// relative to the team workspace — and the step closes only when every one
// stands on disk, non-empty. The platform checks; the member's word is not
// the evidence.

import fs from 'fs/promises';
import path from 'path';

export const STEP_FILES_MAX = 12;
export const STEP_FILE_PATH_MAX_CHARS = 200;

/**
 * Normalize a plan step's `files` — untrusted being input. Throws a message
 * the being can act on. Pure.
 *
 * @param {*} raw - the step's `files` arg
 * @param {string} stepId - for the message
 * @returns {?string[]} relative paths, or null when the step names none
 */
export const normalizeStepFiles = (raw, stepId) => {
  if (raw == null) return null;
  if (!Array.isArray(raw)) throw new Error(`step "${stepId}" files, when given, must be a list of paths relative to the team workspace.`);
  if (raw.length > STEP_FILES_MAX) throw new Error(`step "${stepId}" may name at most ${STEP_FILES_MAX} files.`);
  const files = raw.map((f) => (typeof f === 'string' ? f.trim() : ''));
  for (const f of files) {
    if (!f) throw new Error(`step "${stepId}" names an empty file path.`);
    if (f.length > STEP_FILE_PATH_MAX_CHARS) throw new Error(`step "${stepId}" file paths must stay under ${STEP_FILE_PATH_MAX_CHARS} characters.`);
    if (path.isAbsolute(f) || f.split(/[\\/]/).includes('..')) {
      throw new Error(`step "${stepId}" file "${f}" must be a path INSIDE the team workspace, relative to it (no leading /, no ..).`);
    }
  }
  return files.length ? [...new Set(files)] : null;
};

/**
 * impure — which of a step's named files are missing or empty in the team
 * workspace. Empty list = the deliverables stand.
 *
 * @param {string} root - the team workspace root
 * @param {string[]} files - relative paths (normalizeStepFiles)
 * @returns {Promise<string[]>}
 */
export const missingStepFiles = async (root, files) => {
  const missing = [];
  for (const f of files) {
    const full = path.resolve(root, f);
    // normalizeStepFiles already refused escapes; this holds the line even
    // for a record written before it existed.
    if (full !== root && !full.startsWith(`${path.resolve(root)}${path.sep}`)) { missing.push(f); continue; }
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isFile() || stat.size === 0) missing.push(f);
  }
  return missing;
};
