/**
 * User data realm — the witness's OWN local store.
 *
 * Separate from any neuma's sovereign workspace: this is the user's own
 * readable copy of their chats, at a filesystem location they control and
 * can prove is local. The neuma keeps its own (encrypted, sovereign)
 * session; this realm is the user's record.
 *
 * Layout, per wallet, under a user-chosen root (default ~/.neuma/realm):
 *   <root>/<wallet>/chats/<neumaId>.jsonl   append-only, plaintext (readable)
 *
 * The root is cached here and repointed by user-realm-settings.js at boot or
 * when the witness relocates it. Pure logic with IO isolated and marked.
 */
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { isTempPath } from './workspace-settings.js';
import { decryptEnvelope, encryptEnvelope, isEnvelope } from '../../core/workspace/workspace-crypto.js';

const NEW_ROOT = path.join(os.homedir(), '.neuma', 'realm');
const LEGACY_ROOT = path.join(os.homedir(), '.kenorie', 'realm');
// impure — a pre-rename realm at ~/.kenorie/realm is still home; only move to
// ~/.neuma/realm when no legacy realm exists (never fork the witness's data
// across two homes).
// NEUMA_REALM_ROOT — the launch-scoped isolation door (user-realm-settings.js
// applies it at boot) — is honoured here too, so a module graph re-imported
// later (a test's vi.resetModules) never falls back to the operator's realm.
const defaultRoot = () => (process.env.NEUMA_REALM_ROOT
  ? path.resolve(process.env.NEUMA_REALM_ROOT)
  : !existsSync(NEW_ROOT) && existsSync(LEGACY_ROOT) ? LEGACY_ROOT : NEW_ROOT);

const DEFAULT_ROOT = defaultRoot();
let realmRoot = DEFAULT_ROOT;

export const getRealmRoot = () => realmRoot;
export const setRealmRoot = (root) => {
  realmRoot = path.resolve(root);
};

/**
 * Refuse a ground the OS would sweep at reboot — unless the realm recording it
 * is itself throwaway.
 *
 * The rule is SELF-CONSISTENCY between the ground and the realm that remembers
 * it: a genuinely isolated stack puts both under tmp, so a temp ground there is
 * fine. A temp ground written into the operator's REAL realm is always a bug —
 * it survives the run that created it and outlives the directory it points at.
 *
 * This replaced a weaker check that keyed off NEUMA_WORKSPACE_SETTINGS_PATH.
 * That variable isolates WORKSPACE settings, which says nothing about where the
 * realm is; a test could pin workspaces, write a tmp ground, and still land it
 * in the live realm. It did: on 2026-07-26 the operator's realm was found
 * holding `/tmp/alliance-ground-Dj3vO0/house`, a path that no longer existed.
 *
 * @param {string} resolved absolute ground path
 * @param {string} what the thing being set, for the message
 */
export const assertDurableGround = (resolved, what) => {
  if (!isTempPath(resolved)) return;
  if (isTempPath(realmRoot)) return; // isolated stack — realm is throwaway too
  throw new Error(`${what} cannot live under the OS temp dir — it would not survive a reboot`);
};

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const NEUMA_RE = /^[a-zA-Z0-9_-]+$/;

/** Per-wallet directory, format-validated so it can never escape the root.
 *  Exported so sibling realm stores (e.g. user-tasks) reuse the same
 *  traversal guard rather than reimplementing it. */
export const walletDir = (wallet) => {
  if (typeof wallet !== 'string' || !WALLET_RE.test(wallet)) {
    throw new Error('Invalid wallet address');
  }
  const base = path.resolve(realmRoot);
  const resolved = path.resolve(base, wallet.toLowerCase());
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error('Path traversal denied');
  }
  return resolved;
};

/** The chat log file for one neuma, under the wallet's chats/ dir. */
const chatPath = (wallet, neumaId) => {
  if (typeof neumaId !== 'string' || !NEUMA_RE.test(neumaId)) {
    throw new Error('Invalid neumaId');
  }
  const dir = path.resolve(walletDir(wallet), 'chats');
  const resolved = path.resolve(dir, `${neumaId}.jsonl`);
  if (!resolved.startsWith(dir + path.sep)) {
    throw new Error('Path traversal denied');
  }
  return resolved;
};

/**
 * Append a conversation exchange to the witness's own chat log.
 * @param {string} wallet
 * @param {string} neumaId
 * @param {string|null} neumaName
 * @param {Array<{role: string, content: string}>} turns
 */
// impure
export const appendChat = async (wallet, neumaId, neumaName, turns) => {
  const file = chatPath(wallet, neumaId);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const ts = new Date().toISOString();
  // Each line sealed under the install's key, like the beings' own files; EXPORT reads it back (chatText).
  const lines = turns
    .map((t) => JSON.stringify(encryptEnvelope({ ts, neuma: neumaName || null, role: t.role, content: t.content })) + '\n')
    .join('');
  await fs.appendFile(file, lines, { mode: 0o600 });
};

/** List the witness's chat logs (one per neuma) with sizes. */
// impure
export const listChats = async (wallet) => {
  const dir = path.join(walletDir(wallet), 'chats');
  try {
    const files = await fs.readdir(dir);
    const out = [];
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const st = await fs.stat(path.join(dir, f));
      out.push({ neumaId: f.replace(/\.jsonl$/, ''), bytes: st.size, modifiedAt: st.mtime.toISOString() });
    }
    return out;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};

// pure (given the key) — a chat line back to its turn: sealed lines open, a line from before the lock reads as it is
const openLine = (record) => (isEnvelope(record) ? decryptEnvelope(record) : record);

/** Read a neuma's chat log (last `limit` turns). For the history viewer. */
// impure
export const readChat = async (wallet, neumaId, { limit = 200 } = {}) => {
  const file = chatPath(wallet, neumaId);
  try {
    const content = await fs.readFile(file, 'utf8');
    // Skip any unparseable line rather than lose the whole log to one bad
    // record — in practice only the tail line can tear (a crash mid-append);
    // the sovereign workspace's JSONL reader applies the same tolerance.
    const lines = content.trim().split('\n').filter(Boolean)
      .map((l) => { try { return openLine(JSON.parse(l)); } catch { return null; } })
      .filter(Boolean);
    return limit ? lines.slice(-limit) : lines;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};

/**
 * One conversation as plain text — the person's own copy, readable outside the app. Pure.
 * @param {Array<{ts: string, neuma: ?string, role: string, content: string}>} turns
 * @returns {string}
 */
export const chatText = (turns) => turns
  .map((t) => `${t.ts} · ${t.role === 'user' ? 'you' : (t.neuma || t.role)}\n${t.content}\n`)
  .join('\n');

/**
 * Seal every chat copy written before the lock: each plain line becomes an
 * envelope; the file is replaced only after every line opens back to what it
 * was. impure (fs, crypto).
 * @returns {Promise<{files: number, lines: number, failed: string[]}>}
 */
export const sealChatCopies = async () => {
  const done = { files: 0, lines: 0, failed: [] };
  let wallets;
  try { wallets = await fs.readdir(realmRoot, { withFileTypes: true }); } catch { return done; }
  for (const w of wallets.filter((d) => d.isDirectory())) {
    const dir = path.join(realmRoot, w.name, 'chats');
    let files;
    try { files = (await fs.readdir(dir)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const file = path.join(dir, f);
      try {
        const rows = (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
        const plain = rows.filter((r) => !isEnvelope(r)).length;
        if (plain === 0) continue;
        const sealed = rows.map((r) => (isEnvelope(r) ? r : encryptEnvelope(r)));
        if (JSON.stringify(sealed.map(openLine)) !== JSON.stringify(rows.map(openLine))) throw new Error('a sealed line did not open back');
        const tmp = `${file}.${process.pid}.seal.tmp`;
        await fs.writeFile(tmp, sealed.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
        await fs.rename(tmp, file);
        done.files += 1;
        done.lines += plain;
      } catch (err) {
        done.failed.push(`${file}: ${err.message}`);
      }
    }
  }
  return done;
};

/** Realm summary for the "prove it's local" panel. */
// impure
export const realmStats = async (wallet) => {
  const chats = await listChats(wallet);
  return {
    root: realmRoot,
    walletDir: walletDir(wallet),
    chatCount: chats.length,
    totalBytes: chats.reduce((sum, c) => sum + c.bytes, 0),
    files: chats,
  };
};

/**
 * Write a JSON value to `file` atomically: a sibling temp file, then a rename
 * over the target, so a crash or a concurrent reader can never observe a
 * half-written store. THE write path for every whole-file JSON document in
 * the realm layer (labels, preset, recents, projects, tasks, settings) — a
 * plain fs.writeFile to a whole-file store is a data-loss door (a crash
 * mid-write destroys the entire file).
 * @param {string} file - absolute target path
 * @param {*} value - JSON-serializable value
 */
// impure
export const writeJsonAtomic = async (file, value) => {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fs.rename(tmp, file);
  } catch (err) {
    // A failed write leaves no half-file AND no temp litter behind.
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
};
