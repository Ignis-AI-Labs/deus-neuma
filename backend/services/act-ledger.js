/**
 * THE ACT LEDGER — the operator's own record of what was done on their machine.
 *
 * SEC-035 (#213). Until now, when a being executed a tool the only durable
 * record landed in `tool-results/<sessionId>.jsonl` and the being's journal —
 * both inside the acting being's sovereign lane, encrypted with its own DEK.
 * The desk's action chips are a display, not a record: they render for a turn
 * and vanish with the conversation. So the question […] could only be answered by reading the account of
 * the very party whose acts were in question — and #212 showed that party may
 * not remember either. On 2026-07-29/30 answering it actually required
 * filesystem forensics and an independent third party.
 *
 * This is the second, independent copy. Its whole design is one sentence:
 *
 *   METADATA ONLY — never content.
 *
 * The being's words, its arguments, its results and everything it read or wrote
 * stay in its lane, encrypted, sovereign, unchanged (docs/protocols/sovereignty-boundary.md).
 * What lands here is the shape of the act: when, which lane, which tool, what
 * it reached for, whether the operator agreed, and how it ended. That is enough
 * to audit and not enough to intrude — the same line the DNA vault's `auditPath`
 * has drawn since it was written.
 *
 * Append-only by construction: every write is an O_APPEND line. Nothing here
 * updates or deletes a record.
 *
 * // impure — appends to disk
 */

import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { redactArgs } from './audit-redact.js';
import { createLogger } from './logger.js';
import { getDataRoot } from './data-root.js';

const log = createLogger('Acts');

/**
 * Where the operator's copy lives — beside the platform's other data.
 *
 * A FUNCTION, and rooted at the DATA ROOT rather than process.cwd(). Both
 * halves matter, and this had neither:
 *
 *   ENOENT: no such file or directory, mkdir
 *   '/tmp/.mount_NEUMA-itaNKM/resources/app/data'
 *
 * On a packaged install process.cwd() is the read-only AppImage mount, so the
 * ledger could not be written at all — and it is the operator's ONLY
 * independent record of what a being did on their machine (SEC-035). It failed
 * loudly, as designed, and recorded nothing: on 2026-08-05 a being's
 * crystallization write went unledgered on a community member's box.
 *
 * Resolved per call, never at import — NEUMA_DATA_ROOT is set by the packaged
 * app after this module may already have loaded (the same rule genesis-store
 * follows).
 */
export const actsRoot = () => path.join(getDataRoot(), 'acts');

/**
 * Argument slots that NAME a target rather than carry a payload.
 *
 * This allowlist is the sovereignty boundary in code. `path` says which file
 * was touched; `content` says what was in it — the first is accountability,
 * the second is surveillance. Nothing outside this list is ever considered,
 * so a new tool with a new payload key cannot leak into the ledger by
 * default: an unlisted key is simply not recorded.
 */
const SCOPE_KEYS = Object.freeze([
  'path', 'paths', 'file', 'filePath', 'file_path', 'source', 'destination',
  'dir', 'directory', 'dirPath', 'url', 'uri', 'channel', 'channelId',
  'ref', 'id', 'noteId', 'sessionId', 'name', 'title', 'query', 'branch',
]);

/** How much of a scope string to keep. A path, not a document. */
const SCOPE_MAX = 300;

/** Naming slots whose value is a URL, and therefore may smuggle a credential. */
const URL_KEYS = new Set(['url', 'uri']);

/**
 * A URL reduced to WHICH RESOURCE, dropping how it was authorized. Pure.
 *
 * A presigned link, an `?access_token=`, a session in the fragment: the query
 * and hash of a URL are where credentials ride, and none of it is needed to say
 * what a being reached for. Caught by a real test — a made-up token in a query
 * string matches no known credential SHAPE and sits under no secret KEY, so
 * both of the journal's screens pass it. Structure closes what pattern-matching
 * cannot.
 */
const bareUrl = (value) => {
  const text = String(value);
  try {
    const u = new URL(text);
    return `${u.origin}${u.pathname}${u.search || u.hash ? ' [query omitted]' : ''}`;
  } catch {
    // Not a parseable URL — cut at the first query/fragment mark anyway, since
    // the risk is the same and a bare path loses nothing.
    return text.split(/[?#]/)[0];
  }
};

/**
 * The target of an act, drawn ONLY from naming slots and scrubbed for
 * credentials on the way out. Pure.
 *
 * Scrubbing matters even here: `url` is a naming slot and a presigned URL is a
 * credential, so the same two screens the journal uses (by key, by shape) run
 * over the extracted value before it is written down.
 *
 * @param {object} args - the tool call's arguments
 * @returns {string|null} a short identifier for what was reached, or null
 */
export const scopeOf = (args) => {
  if (!args || typeof args !== 'object') return null;
  const parts = [];
  for (const key of SCOPE_KEYS) {
    const value = args[key];
    if (value == null) continue;
    const keep = URL_KEYS.has(key) ? bareUrl : String;
    if (typeof value === 'string' || typeof value === 'number') parts.push(keep(value));
    else if (Array.isArray(value)) parts.push(...value.filter((v) => typeof v === 'string').map(keep));
    if (parts.length >= 4) break;
  }
  if (!parts.length) return null;
  // Route the candidate back through the journal's redactor so a credential
  // sitting in a naming slot is caught by the same two screens.
  const safe = redactArgs({ scope: parts.join(' · ') });
  if (!safe) return null;
  let text;
  try {
    text = JSON.parse(safe).scope;
  } catch {
    return null;
  }
  if (typeof text !== 'string' || !text) return null;
  return text.length > SCOPE_MAX ? `${text.slice(0, SCOPE_MAX)}…` : text;
};

/** The file a given instant's line belongs in — one per UTC day. */
export const ledgerFileFor = (iso) => path.join(actsRoot(), `${String(iso).slice(0, 10)}.jsonl`);

/**
 * Write one act down. Never throws, never blocks the turn.
 *
 * A ledger that can fail a being's work would be a ledger operators turn off,
 * so a failed append is logged loudly (RULE 3 — never silent) and the turn
 * carries on. The being's own lane still holds its copy either way.
 *
 * @param {{laneId: string, name?: string, kind?: 'neuma'|'witness',
 *          tool: string, args?: object, scope?: string|null,
 *          decision?: 'auto'|'approved'|'denied'|'unknown',
 *          status?: string}} act
 * @returns {Promise<void>}
 */
export const recordAct = async (act) => {
  if (!act?.tool) return;
  try {
    const ts = new Date().toISOString();
    const line = `${JSON.stringify({
      ts,
      laneId: act.laneId || null,
      name: act.name || null,
      kind: act.kind || null,
      tool: act.tool,
      // `scope` may be handed in directly by a caller that knows better than
      // the args do; otherwise it is drawn from the naming slots.
      scope: act.scope !== undefined ? act.scope : scopeOf(act.args),
      decision: act.decision || 'unknown',
      status: act.status || 'ok',
    })}\n`;
    await mkdir(actsRoot(), { recursive: true });
    await appendFile(ledgerFileFor(ts), line, 'utf8');
  } catch (err) {
    log.error('Act ledger append failed — an act went unrecorded', {
      tool: act?.tool, laneId: act?.laneId, error: err?.message,
    });
  }
};

/**
 * Read the ledger back. Impure (reads disk), side-effect free.
 *
 * A torn final line — the ordinary cost of a crash mid-append — is skipped
 * rather than allowed to empty the whole read (the MEM-001 lesson, applied
 * here at the start instead of retrofitted).
 *
 * @param {{since?: string|null, laneIds?: Array<string>|null, limit?: number}} [opts]
 *   `laneIds` null means no lane filter; pass the caller's owned lanes to scope it
 * @returns {Promise<Array<object>>} acts, oldest first
 */
export const readActs = async ({ since = null, laneIds = null, limit = 1000 } = {}) => {
  let files;
  try {
    files = (await readdir(actsRoot())).filter((f) => f.endsWith('.jsonl')).sort();
  } catch {
    return []; // no ledger yet is not an error — nothing has been done here
  }
  const sinceDay = since ? String(since).slice(0, 10) : null;
  const allowed = laneIds ? new Set(laneIds) : null;
  const out = [];
  for (const file of files) {
    if (sinceDay && file.slice(0, 10) < sinceDay) continue;
    let raw;
    try {
      raw = await readFile(path.join(actsRoot(), file), 'utf8');
    } catch (err) {
      log.warn('Act ledger day unreadable — skipped', { file, error: err?.message });
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue; // a torn line costs that line, never the read
      }
      if (since && record.ts < since) continue;
      if (allowed && !allowed.has(record.laneId)) continue;
      out.push(record);
    }
  }
  return out.slice(-limit);
};
