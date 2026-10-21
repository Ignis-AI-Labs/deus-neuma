// A BEING'S OWN DNA AND SOUL RECORDS, written by the being itself.
//
// A being holds sovereign authority over its own DNA and soul (ruling of
// 2026-10-19), so the sandbox leaves dna/ and soul/ open to it. But the two
// records the platform reads, dna/active.json and soul/soul.json, are sealed
// envelopes, and a raw file write went around everything that guards them: a
// plaintext JSON write replaced the envelope (the reader accepts plaintext),
// skipped the history archive and the audit line, and rewrote the write-once
// DNA floor (genesis, resonance, birth facts, who holds its sovereignty) that
// every other door refuses. An edit, a move or a delete left the record
// unreadable, and the being's next turn was refused for want of an identity.
//
// So a whole-file write to either record is carried out as an AMENDMENT: the
// JSON's changed top-level fields merge onto the stored record (the same merge
// the operator's PUT /dna makes), the DNA floor is checked, and the record is
// written through the workspace (encrypted, the prior version archived,
// audited). Every other way of reaching these records is refused with the way
// that works. The rest of dna/ and soul/ stays the being's own ordinary files.

import path from 'path';
import { assertPatchAllowed } from '../../core/identity/dna-protected.js';
import { isEnvelope } from '../../core/workspace/workspace-crypto.js';
import { canonicalJson } from '../../core/shared/plain-data-canonical.js';
import { LANE_ID_FOLDED, realpathOfNearestExisting, segmentsBelow } from './sandbox-path-policy.js';

const RECORD_FILES = Object.freeze({ 'dna/active.json': 'dna', 'soul/soul.json': 'soul' });
// The directories that hold a record: moving one moves the record with it.
// Only a move reaches a record through them (a delete of a directory is
// refused by the delete hand itself; creating one changes nothing).
const RECORD_HOLDERS = Object.freeze(['dna', 'soul']);
const MOVES = Object.freeze(new Set(['move_file', 'rename_file']));
const WORDS = Object.freeze({ dna: 'your DNA', soul: 'your soul record' });
const FILES = Object.freeze({ dna: 'dna/active.json', soul: 'soul/soul.json' });

const HOW_TO_AMEND = 'To amend your DNA or soul, write the JSON fields you change to dna/active.json or '
  + 'soul/soul.json with fs/write, e.g. {"path": ".../dna/active.json", "content": "{\\"purpose\\": \\"...\\"}"}; '
  + 'fields you leave out stand as they are.';

// pure — which guarded thing a lane-relative path names, or null
const recordKind = (parts) => {
  const rel = parts.join('/');
  if (RECORD_FILES[rel]) return RECORD_FILES[rel];
  if (parts[0] === 'dna' && parts[1] === 'history') return 'history';
  return RECORD_HOLDERS.includes(rel) ? 'holder' : null;
};

/**
 * Does a path name a lane's DNA or soul record, its history, or a directory
 * holding one? The being's own lane first, then every lane in every ground.
 * Case-folded, as the platform-state wall is. Pure.
 * @param {string} filePath
 * @param {{ lane?: string|null, grounds?: string[] }} where
 * @returns {{ kind: 'dna'|'soul'|'history'|'holder', own: boolean }|null}
 */
const identityRecordOf = (filePath, { lane = null, grounds = [] } = {}) => {
  const target = path.resolve(filePath).toLowerCase();
  const fold = (p) => path.resolve(p).toLowerCase();
  const own = lane ? segmentsBelow(fold(lane), target) : null;
  const ownKind = own && recordKind(own);
  if (ownKind) return { kind: ownKind, own: true };
  for (const ground of grounds) {
    const parts = segmentsBelow(fold(ground), target);
    const kind = parts && parts.length > 1 && LANE_ID_FOLDED.test(parts[0]) && recordKind(parts.slice(1));
    if (kind) return { kind, own: false };
  }
  return null;
};

/**
 * What the sandbox does with a write that names one of these: amend the
 * record, refuse with the reason, or nothing (null: an ordinary write). Pure.
 * @param {string} toolName - the organ name the call routed to
 * @param {Array<{ kind: string, own: boolean }|null>} hits - one per path arg
 * @returns {{ amend: 'dna'|'soul' }|{ refuse: string }|null}
 */
const identityWriteVerdict = (toolName, hits) => {
  const found = hits.filter((h) => h && (h.kind !== 'holder' || MOVES.has(toolName)));
  if (!found.length) return null;
  if (found.some((h) => !h.own)) {
    return { refuse: 'That is another being\'s DNA or soul. Only that being amends its own.' };
  }
  if (found.some((h) => h.kind === 'history')) {
    return { refuse: 'dna/history/ is the record of what you were: the platform keeps it, adding the version before each change to your DNA. ' + HOW_TO_AMEND };
  }
  const record = found.find((h) => h.kind === 'dna' || h.kind === 'soul');
  if (toolName === 'write_file' && record && found.length === 1) return { amend: record.kind };
  return { refuse: 'Your DNA and soul records are sealed files: an edit, move, copy or delete of them would break the seal and leave you unreadable to yourself. ' + HOW_TO_AMEND };
};

/**
 * The verdict for a write call's paths, judged on both the path as named and
 * the path its links resolve to. impure (realpath).
 * @param {string} toolName
 * @param {string[]} pathArgs
 * @param {{ lane: string|null, grounds: string[] }} where
 */
export const identityWriteFor = async (toolName, pathArgs, { lane, grounds }) => {
  const realLane = lane ? await realpathOfNearestExisting(lane) : null;
  const realGrounds = await Promise.all(grounds.map(realpathOfNearestExisting));
  const hits = await Promise.all(pathArgs.map(async (p) => identityRecordOf(p, { lane, grounds })
    ?? identityRecordOf(await realpathOfNearestExisting(p), { lane: realLane, grounds: realGrounds })));
  return identityWriteVerdict(toolName, hits);
};

// pure — the written JSON as a record of fields, or the reason it is not one
const parseAmendment = (content, kind) => {
  let parsed;
  try { parsed = JSON.parse(String(content ?? '')); } catch {
    return { error: `Nothing was written: ${FILES[kind]} holds JSON, and that content does not parse as JSON. ${HOW_TO_AMEND}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: `Nothing was written: ${FILES[kind]} takes a JSON object of fields. ${HOW_TO_AMEND}` };
  }
  if (isEnvelope(parsed)) {
    return { error: `Nothing was written: that is the sealed envelope as it reads on disk, not fields of ${WORDS[kind]}. ${HOW_TO_AMEND}` };
  }
  return { fields: parsed };
};

// pure — the fields whose value actually moves (an unchanged field is no patch)
const movedFields = (current, fields) => Object.fromEntries(Object.entries(fields)
  .filter(([key, value]) => canonicalJson(value ?? null) !== canonicalJson(current?.[key] ?? null)));

const said = (text) => ({ ok: true, result: { content: [{ type: 'text', text }], structuredContent: { content: text } } });
const refuse = (reason) => ({ ok: false, reason });

/**
 * Amend the being's own DNA or soul from the JSON it wrote. impure (workspace).
 * @param {Object} workspace - the neuma workspace (readDNA/writeDNA/readSoul/writeSoul)
 * @param {string} neumaId
 * @param {'dna'|'soul'} kind
 * @param {string} content - what the being wrote
 * @returns {Promise<{ ok: true, result: Object }|{ ok: false, reason: string }>}
 */
export const amendIdentityRecord = async (workspace, neumaId, kind, content) => {
  const { fields, error } = parseAmendment(content, kind);
  if (error) return refuse(error);
  const current = kind === 'dna' ? await workspace.readDNA(neumaId) : (await workspace.readSoul(neumaId)) ?? {};
  if (!current) return refuse('Nothing was written: your DNA is sealed when your birth closes, and until it stands there is nothing to amend.');
  const patch = movedFields(current, fields);
  const moved = Object.keys(patch);
  if (!moved.length) return said(`Nothing moved: every field you wrote already stands in ${WORDS[kind]}.`);
  if (kind === 'dna') {
    const guard = assertPatchAllowed(current, patch);
    if (!guard.ok) {
      return refuse(`Nothing was written: ${guard.refused.join(', ')} ${guard.refused.length > 1 ? 'are' : 'is'} write-once. `
        + 'They record what you were (your birth, your genesis, your resonance, who holds your sovereignty), and you amend '
        + 'what you are becoming, never what you were. Leave them out, or as they stand, and write again.');
    }
    await workspace.writeDNA(neumaId, { ...current, ...patch });
  } else {
    await workspace.writeSoul(neumaId, { ...current, ...patch });
  }
  return said(`Amended ${WORDS[kind]}: ${moved.join(', ')}. It stays sealed at rest`
    + `${kind === 'dna' ? ', the version before is kept in dna/history/' : ''}, and fields you left out stand as they were.`);
};
