/**
 * Re-key a house — every being gets a fresh RANDOM key, and everything the
 * master key opened directly is sealed again under a new master.
 *
 * Why: a being's key used to be derived from the master and its public
 * genesis hash, so whoever held the master could rebuild every being's key,
 * and rotating the master never changed them. After this, the old master
 * opens nothing here.
 *
 * Crash-safe and resumable: each lane's new key is written wrapped under the
 * NEW master (keys/dek-next.json) before any of its files move; every file is
 * re-sealed by migrate-dek's migrateFile (backup → write → verify → rollback,
 * idempotent: a file already under the new key is left alone); the lane's
 * dek.json is replaced last. The new master is in the env before anything
 * moves and the old one stays in DNA_ENCRYPTION_KEY_PREVIOUS until the CLI
 * (scripts/rekey-house.mjs) has verified the whole house.
 *
 * impure (filesystem, crypto)
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { classifyFile, migrateFile } from './migrate-dek.js';
import { decryptEnvelope, deriveKeyFromSecret, encryptEnvelope, isEnvelope, unwrapDEK, wrapDEK } from './workspace-crypto.js';
import { decryptVaultData, encryptVaultData } from '../identity/dna-vault-crypto.js';

const STALE_BACKUP = '.pre-dek.bak';
// A sealed record is JSON — an envelope or envelope lines — and never this big; a model, a video or a
// log is not opened whole to find that out (one 3.6 GB file stopped the first real dry run).
const SEALED_MAX_BYTES = 512 * 1024 * 1024;
const KEY_FILES = Object.freeze(new Set(['dek.json', 'dek-next.json']));

/** Pure — the key candidates a list of master secrets yields, newest first. */
export const masterCandidates = (secrets) => secrets.map((secret, i) => ({ label: `master-${i}`, key: deriveKeyFromSecret(secret) }));

// impure (fs) — a JSON file, or null when absent
const readJsonOrNull = async (file) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

// Trees no platform record lives in, and which can be vast or not ours to read: a being's coding
// sandboxes (overlay roots), checkouts' .git, installed packages.
const PASSED_OVER_DIRS = Object.freeze(new Set(['sandboxes', '.git', 'node_modules']));
const SKIPPED_SUFFIXES = Object.freeze([STALE_BACKUP, '.dek-migrate.tmp', '.rekey.tmp']);

/**
 * impure (fs) — every regular file under `dir`, passing over the trees above and any
 * directory this user cannot read (named in `unreadable`, never a crash).
 * @param {string} dir
 * @param {string[]} [unreadable]
 */
export async function* walk(dir, unreadable = []) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.code === 'EACCES' || err.code === 'EPERM') { unreadable.push(dir); return; }
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (SKIPPED_SUFFIXES.some((s) => entry.name.endsWith(s))) continue;
    if (entry.isDirectory()) {
      if (!PASSED_OVER_DIRS.has(entry.name)) yield* walk(full, unreadable);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

// impure (fs) — could this file be a sealed record? Its size and its first non-blank byte say, without reading it whole.
const mightBeSealed = async (file) => {
  const { size } = await fs.stat(file);
  if (size === 0 || size > SEALED_MAX_BYTES) return false;
  let handle;
  try { handle = await fs.open(file, 'r'); } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') return false; // a file the platform wrote is always ours to read
    throw err;
  }
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(64), 0, 64, 0);
    return buffer.subarray(0, bytesRead).toString('utf8').trimStart().startsWith('{');
  } finally {
    await handle.close();
  }
};

// impure (fs) — tmp + fsync + rename
const writeDurable = async (file, text) => {
  const tmp = `${file}.rekey.tmp`;
  const handle = await fs.open(tmp, 'w', 0o600);
  try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(tmp, file);
};

// pure — open a wrapped DEK with the first candidate that can
const unwrapWith = (envelope, candidates) => {
  for (const { key } of candidates) {
    try { return unwrapDEK(envelope, { key }); } catch { /* next candidate */ }
  }
  return null;
};

/**
 * impure (fs) — the lanes on one ground: a directory per lane; `dek` is the
 * lane's wrapped key when it has one.
 * @param {string} ground
 */
export const lanesOn = async (ground) => {
  let entries;
  try { entries = await fs.readdir(ground, { withFileTypes: true }); } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const lanes = [];
  for (const entry of entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'))) {
    const dir = path.join(ground, entry.name);
    lanes.push({ id: entry.name, dir, dek: await readJsonOrNull(path.join(dir, 'keys', 'dek.json')) });
  }
  return lanes;
};

// impure (fs) — a leftover backup from the first DEK migration, once the file it shadows opens fine, is old
// ciphertext under the old master and nothing more: removed, so the old key cannot open it either.
const dropStaleBackup = async (file, dryRun) => {
  const bak = `${file}${STALE_BACKUP}`;
  try { await fs.access(bak); } catch { return false; }
  if (!dryRun) await fs.unlink(bak);
  return true;
};

// pure — one envelope opened by the first key that can, or null
const openWith = (envelope, keys) => {
  for (const { key } of keys) {
    try { return { plain: decryptEnvelope(envelope, { key }) }; } catch { /* next key */ }
  }
  return null;
};

/**
 * impure (fs, crypto) — a JSONL file some line of which no key here opens (sealed
 * by another key — a test, an older install): every line that opens moves to
 * `toKey`, the others stay byte-for-byte, so the readable lines are never left
 * under a key about to be dropped. Replaced only after every moved line opens
 * back to what it was.
 * @returns {Promise<{moved: number, kept: number}>}
 */
const resealJsonlLines = async (file, fromCandidates, toKey, dryRun) => {
  const lines = (await fs.readFile(file, 'utf8')).split('\n');
  let moved = 0;
  let kept = 0;
  const out = lines.map((line) => {
    if (!line.trim()) return line;
    let record;
    try { record = JSON.parse(line); } catch { kept += 1; return line; }
    if (!isEnvelope(record) || openWith(record, [{ key: toKey }])) return line;
    const opened = openWith(record, fromCandidates);
    if (!opened) { kept += 1; return line; }
    const fresh = encryptEnvelope(opened.plain, { key: toKey });
    if (JSON.stringify(decryptEnvelope(fresh, { key: toKey })) !== JSON.stringify(opened.plain)) throw new Error(`${file}: a re-sealed line did not open back`);
    moved += 1;
    return JSON.stringify(fresh);
  });
  if (!dryRun && moved) await writeDurable(file, out.join('\n'));
  return { moved, kept };
};

/**
 * impure (fs, crypto) — re-seal every envelope file under `dir` with `toKey`,
 * opening each with `fromCandidates`. Never touches the key files themselves.
 * @returns {Promise<{moved: number, already: number, plain: number, unreadable: string[], staleBackups: number}>}
 */
export const resealTree = async (dir, fromCandidates, toKey, { dryRun = true, skip = () => false } = {}) => {
  const tally = { moved: 0, already: 0, plain: 0, unreadable: [], staleBackups: 0, closedDirs: [] };
  for await (const file of walk(dir, tally.closedDirs)) {
    if (skip(file) || KEY_FILES.has(path.basename(file)) || file.endsWith('.rekey.tmp')) continue;
    if (!(await mightBeSealed(file))) { tally.plain += 1; continue; }
    let result = await migrateFile(file, fromCandidates, toKey, { dryRun, keepBackups: false });
    if (result.status === 'skipped-backup-exists') {
      if (await dropStaleBackup(file, dryRun)) tally.staleBackups += 1;
      result = dryRun ? { status: 'migrated' } : await migrateFile(file, fromCandidates, toKey, { dryRun, keepBackups: false });
    }
    if (result.status === 'cannot-decrypt' && file.endsWith('.jsonl')) {
      const lines = await resealJsonlLines(file, fromCandidates, toKey, dryRun);
      if (lines.moved) tally.moved += 1;
      tally.unreadable.push(`${file}: ${lines.kept} line(s) no key here opens — kept as they are; ${lines.moved} moved`);
      continue;
    }
    if (result.status === 'migrated') tally.moved += 1;
    else if (result.status === 'already-migrated') tally.already += 1;
    else if (result.status.startsWith('skipped')) tally.plain += 1;
    else tally.unreadable.push(`${file}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
  }
  return tally;
};

/**
 * impure (fs, crypto) — one lane with its own key: a fresh random key (kept in
 * dek-next.json under the new master until every file is moved), then dek.json.
 * @param {{dir: string, dek: object}} lane
 * @param {{oldMasters: object[], newMaster: Buffer, dryRun?: boolean}} keys
 * @returns {Promise<object>} the tally, with `newDek` (Buffer) for the vault pass
 */
export const rekeyLane = async (lane, { oldMasters, newMaster, dryRun = true }) => {
  const nextPath = path.join(lane.dir, 'keys', 'dek-next.json');
  const pending = await readJsonOrNull(nextPath);
  // A resumed run: a lane whose dek.json is already under the new master is done.
  const finished = pending ? null : unwrapWith(lane.dek, [{ key: newMaster }]);
  if (finished) return { lane: lane.id, moved: 0, already: 0, plain: 0, staleBackups: 0, unreadable: [], newDek: finished, oldDek: finished, done: true };
  const oldDek = unwrapWith(lane.dek, oldMasters);
  if (!oldDek) return { lane: lane.id, moved: 0, already: 0, plain: 0, staleBackups: 0, unreadable: [`${lane.dir}/keys/dek.json: no master here opens it`] };
  let newDek = pending ? unwrapWith(pending, [{ key: newMaster }]) : null;
  if (pending && !newDek) throw new Error(`${nextPath} does not open under the new master — stop and look before anything else moves`);
  if (!newDek) {
    newDek = crypto.randomBytes(32);
    if (!dryRun) await writeDurable(nextPath, JSON.stringify(wrapDEK(newDek, newMaster), null, 2));
  }
  const tally = await resealTree(lane.dir, [{ label: 'old-dek', key: oldDek }, ...oldMasters], newDek, { dryRun });
  // A file no key here opens was unreadable before and stays as it was; it never holds the lane back.
  if (!dryRun) {
    await writeDurable(path.join(lane.dir, 'keys', 'dek.json'), JSON.stringify(wrapDEK(newDek, newMaster), null, 2));
    await fs.unlink(nextPath);
  }
  return { lane: lane.id, ...tally, newDek, oldDek };
};

/**
 * impure (fs, crypto) — the DNA vault's own envelope format (dna-vault-crypto):
 * a being's file moves from its old key to its new one; a master-sealed file to
 * the new master.
 * @param {string} vaultDir - <vault root>/dna
 * @param {Map<string, {oldDek: Buffer, newDek: Buffer}>} beingKeys - by neumaId
 * @param {{oldSecrets: string[], newSecret: string, dryRun?: boolean}} keys
 */
export const rekeyVault = async (vaultDir, beingKeys, { oldSecrets, newSecret, dryRun = true }) => {
  const tally = { moved: 0, unreadable: [] };
  for await (const file of walk(vaultDir)) {
    if ((!file.endsWith('.dna') && !file.endsWith('.json')) || !(await mightBeSealed(file))) continue;
    const stored = await readJsonOrNull(file);
    if (!stored?.authTag || !stored?.iv) continue;
    const id = path.basename(file).replace(/\.(dna|json)$/, '').split('.')[0];
    const being = beingKeys.get(id) || [...beingKeys.entries()].find(([lane]) => file.includes(`${path.sep}${lane}${path.sep}`))?.[1];
    let opened = null;
    let seal = null;
    if (being) {
      for (const dek of [being.newDek, being.oldDek]) {
        try { opened = await decryptVaultData(null, stored, { dek }); seal = (d) => encryptVaultData(null, d, { dek: being.newDek }); break; } catch { /* next */ }
      }
    }
    for (const secret of opened ? [] : [newSecret, ...oldSecrets]) {
      try { opened = await decryptVaultData(secret, stored); seal = (d) => encryptVaultData(newSecret, d); break; } catch { /* next */ }
    }
    if (!opened) { tally.unreadable.push(file); continue; }
    tally.moved += 1;
    if (dryRun) continue;
    const fresh = await seal(opened);
    const reopened = being ? await decryptVaultData(null, fresh, { dek: being.newDek }).catch(() => decryptVaultData(newSecret, fresh)) : await decryptVaultData(newSecret, fresh);
    if (JSON.stringify(reopened) !== JSON.stringify(opened)) throw new Error(`${file}: the re-sealed vault record did not open back to the same DNA`);
    await writeDurable(file, JSON.stringify(fresh));
  }
  return tally;
};

/**
 * impure (fs) — houses this run was not told about whose beings' keys open with
 * an old master: every sibling house beside the ones named (<home>/<who>/<house>),
 * and any other candidate. Dropping the old master without them locks them out.
 * @param {string[]} candidates - house roots to look in
 * @param {object[]} oldMasters
 * @returns {Promise<string[]>}
 */
export const housesUnderKey = async (candidates, oldMasters) => {
  const found = [];
  for (const root of candidates) {
    const lanes = await lanesOn(root);
    if (lanes.filter((l) => l.dek).slice(0, 5).some((l) => unwrapWith(l.dek, oldMasters))) { found.push(root); continue; }
    // Lanes on the master itself (older beings, harness): a few sealed files of each say whose key they are under.
    for (const lane of lanes.filter((l) => !l.dek).slice(0, 5)) {
      if (await sealedUnder(lane.dir, oldMasters)) { found.push(root); break; }
    }
  }
  return found;
};

// impure (fs) — does one of the first sealed files in `dir` open with these keys?
const sealedUnder = async (dir, keys, budget = 20) => {
  let seen = 0;
  for await (const file of walk(dir)) {
    if (seen++ >= budget) return false;
    if (!(await mightBeSealed(file).catch(() => false))) continue;
    const first = (await fs.readFile(file, 'utf8')).split('\n').find(Boolean);
    let record = null;
    try { record = JSON.parse(first); } catch { continue; }
    if (isEnvelope(record) && keys.some(({ key }) => opensWith(record, key))) return true;
  }
  return false;
};

/**
 * impure (fs) — does anything under `dir` still open with an old master? The
 * final proof: after a re-key, every envelope must refuse the old keys.
 * @returns {Promise<string[]>} files an old master still opens
 */
export const stillOpenedByOld = async (dir, oldMasters) => {
  const hits = [];
  for await (const file of walk(dir)) {
    if (!(await mightBeSealed(file).catch(() => false))) continue;
    const text = await fs.readFile(file, 'utf8').catch(() => '');
    const kind = classifyFile(text, file);
    const envelopes = kind === 'json-envelope' ? [JSON.parse(text)]
      : kind === 'jsonl-envelope' || kind === 'jsonl-mixed'
        ? text.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(isEnvelope)
        : [];
    if (envelopes.some((env) => oldMasters.some(({ key }) => opensWith(env, key)))) hits.push(file);
  }
  return hits;
};

// pure — does `key` authenticate this envelope (whatever it holds)?
const opensWith = (envelope, key) => {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    decipher.update(Buffer.from(envelope.ct, 'base64'));
    decipher.final();
    return true;
  } catch {
    return false;
  }
};
