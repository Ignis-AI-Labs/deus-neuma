/**
 * WHAT IS INSTALLED, WHAT ITS CHECK FOUND, AND ITS KEYS.
 *
 *   <data root>/extensions/installed.json   one record per installed extension:
 *                                           version, the last security check, on/off,
 *                                           blocked (and why), the tools it offers
 *   <data root>/extensions/keys.json        the API keys you gave each one, encrypted
 *                                           at rest with the platform's own key
 *   <data root>/extensions/<id>/            the installed copy that was checked, and runs
 *
 * A key is never returned to a person or a being: only whether it is set.
 *
 * impure — the data root, one write at a time.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { getDataRoot } from '../data-root.js';
import { encryptEnvelope, parseAndDecrypt } from '../../../core/workspace/workspace-crypto.js';
import { extensionById } from './extension-catalog.js';

export const extensionsDir = () => path.join(getDataRoot(), 'extensions');
export const extensionDir = (id) => path.join(extensionsDir(), id);
const installedFile = () => path.join(extensionsDir(), 'installed.json');
const keysFile = () => path.join(extensionsDir(), 'keys.json');

const writeFile = async (file, text) => {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(tmp, text, { mode: 0o600 });
  await fs.rename(tmp, file);
};

let chain = Promise.resolve();
const serialize = (fn) => {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
};

/** impure — every installed record, by id. */
export const readInstalled = async () => {
  try {
    const parsed = JSON.parse(await fs.readFile(installedFile(), 'utf8'));
    return parsed?.extensions && typeof parsed.extensions === 'object' ? parsed.extensions : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
};

/** impure — change one record (or remove it with null). */
export const updateInstalled = (id, change) => serialize(async () => {
  const all = await readInstalled();
  const next = typeof change === 'function' ? change(all[id] ?? null) : change;
  if (next === null) delete all[id];
  else all[id] = next;
  await writeFile(installedFile(), `${JSON.stringify({ extensions: all }, null, 2)}\n`);
  return next;
});

const readKeys = async () => {
  try {
    return parseAndDecrypt(await fs.readFile(keysFile(), 'utf8')) ?? {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
};

/**
 * Set (or with an empty value, clear) one of an extension's keys. Only the
 * names its catalog entry declares are taken.
 * impure.
 */
export const setExtensionKey = (id, name, value) => serialize(async () => {
  const entry = extensionById(id);
  if (!entry) throw new Error(`no extension ${id} in the catalog`);
  if (!entry.env.some((k) => k.name === name)) throw new Error(`${entry.name} takes no key named ${name} (it takes: ${entry.env.map((k) => k.name).join(', ') || 'none'})`);
  const keys = await readKeys();
  const own = { ...(keys[id] ?? {}) };
  const text = String(value ?? '').trim();
  if (text) own[name] = text; else delete own[name];
  keys[id] = own;
  await writeFile(keysFile(), JSON.stringify(encryptEnvelope(keys)));
  return keyState(entry, own);
});

/** Which keys are set, never their values. Pure. */
export const keyState = (entry, own = {}) => entry.env.map((k) => ({ name: k.name, label: k.label, required: k.required, set: Boolean(own[k.name]) }));

/** impure — an extension's keys, for the process that runs it and nothing else. */
export const keysFor = async (id) => (await readKeys())[id] ?? {};

/** impure — forget an extension's keys (on removal). */
export const forgetKeys = (id) => serialize(async () => {
  const keys = await readKeys();
  if (!keys[id]) return;
  delete keys[id];
  await writeFile(keysFile(), JSON.stringify(encryptEnvelope(keys)));
});
