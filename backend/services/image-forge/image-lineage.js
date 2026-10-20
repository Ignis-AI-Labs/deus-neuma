/**
 * IMAGE LINEAGE — what an image was made from, so a picture cannot launder a
 * prompt the content law would refuse.
 *
 * The screen reads words, never pixels. Without lineage, a lawful still ([…]) animated or edited with a sexual prompt that never
 * names an age would pass, and the entrenched minor + sexual line would be
 * crossed through the image. So every forge output records the screened
 * prompts that made it: its own, then its source's lineage. A job that starts
 * from an image screens its new prompt TOGETHER with that lineage.
 *
 * The record lives in the platform's own data folder, never the being's
 * workspace, and is bound to the stored file's SHA-256: a manifest entry that
 * names a swapped or planted file has no lineage. An image without one (made
 * before lineage existed, or not made here) can still be animated — but never
 * with sexual content (prompt-screen `unrecordedSource`).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { getDataRoot } from '../data-root.js';
import { createLogger } from '../logger.js';

const log = createLogger('ImageForge.Lineage');

// A chain longer than this is not recorded (the image is then "unrecorded"),
// so a long chain can never push its first prompt out of a truncated record.
export const MAX_LINEAGE_CHARS = 16_000;

/** impure (env) */
const lineagePath = (env = process.env) =>
  env.COMFYUI_LINEAGE_PATH || path.join(getDataRoot(), 'image-forge', 'lineage.jsonl');

/**
 * The lineage of a new output. Pure.
 * @param {string} prompt the screened prompt that made it
 * @param {string|null|undefined} sourceLineage undefined = no source; null = a source with no lineage
 * @returns {string|null} null when the chain is unknown or too long
 */
export const composeLineage = (prompt, sourceLineage) => {
  if (sourceLineage === null) return null;
  const text = [String(prompt ?? '').trim(), sourceLineage ?? ''].filter(Boolean).join('\n');
  return text.length > 0 && text.length <= MAX_LINEAGE_CHARS ? text : null;
};

/**
 * Record one output's lineage. Impure. Never throws: an output whose lineage
 * cannot be written is simply unrecorded (and so never usable for sexual content).
 */
export const recordLineage = ({ laneId, imageId, sha256, lineage }, env = process.env) => {
  if (typeof lineage !== 'string' || !lineage) return;
  try {
    const file = lineagePath(env);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    appendFileSync(file, `${JSON.stringify({ laneId, imageId, sha256, lineage })}\n`, { mode: 0o600 });
  } catch (err) {
    log.warn('an output\'s lineage could not be recorded', { err: err.message });
  }
};

/**
 * The recorded lineage of one of a lane's images, or null when there is none
 * or the file on disk is not the file that was recorded. Impure.
 * Pass `bytes` (the exact bytes about to be used) so the file cannot be swapped
 * between the check and the use.
 * @param {{laneId: string, imageId: string, file: string, bytes?: Buffer}} p
 * @returns {string|null}
 */
export const lineageFor = ({ laneId, imageId, file, bytes = null }, env = process.env) => {
  try {
    const store = lineagePath(env);
    if (!existsSync(store) || (!bytes && !existsSync(file))) return null;
    let entry = null;
    for (const line of readFileSync(store, 'utf8').split('\n')) {
      if (!line.includes(imageId)) continue;
      try {
        const row = JSON.parse(line);
        if (row.laneId === laneId && row.imageId === imageId) entry = row;
      } catch { /* a torn line is no lineage */ }
    }
    if (!entry) return null;
    const sha256 = createHash('sha256').update(bytes ?? readFileSync(file)).digest('hex');
    return sha256 === entry.sha256 ? entry.lineage : null;
  } catch (err) {
    log.warn('lineage could not be read; the image counts as unrecorded', { err: err.message });
    return null;
  }
};
