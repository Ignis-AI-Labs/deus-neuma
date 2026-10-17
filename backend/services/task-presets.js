/**
 * Task presets (backend) — the witness's custom preset store plus resolution
 * against the built-in catalog. Customs live in the witness's realm at
 *   <realmRoot>/<wallet>/task-presets.json
 * Shape/invariants live in core/tasks/task-presets.js (pure); this is only
 * the wallet-scoped persistence, the mutation queue, and preset lookup.
 * Built-ins ship with the app (core), are listed for everyone, and can
 * never be deleted. IO is isolated.
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { walletDir } from './user-realm.js';
import { validatePresetSpec, BUILTIN_PRESETS } from '../../core/tasks/task-presets.js';

const presetsFile = (wallet) => path.join(walletDir(wallet), 'task-presets.json');

// impure
const readCustomPresets = async (wallet) => {
  try {
    const raw = await fs.readFile(presetsFile(wallet), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.presets) ? parsed.presets : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};

// impure — atomic temp+rename (user-projects pattern).
const writeCustomPresets = async (wallet, presets) => {
  const file = presetsFile(wallet);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ presets }, null, 2));
  await fs.rename(tmp, file);
};

// impure — per-wallet mutation queue (user-projects pattern): every op below
// is read-modify-write on ONE json file.
const storeQueues = new Map();
const withStoreQueue = (wallet, task) => {
  const key = String(wallet).toLowerCase();
  const tail = storeQueues.get(key) ?? Promise.resolve();
  const run = tail.then(task, task);
  storeQueues.set(key, run.catch(() => {}));
  return run;
};

/**
 * Everything applyable: the built-in catalog plus the wallet's customs.
 * @returns {Promise<{builtins: Array, customs: Array}>}
 */
// impure
export const listPresets = async (wallet) => ({
  builtins: BUILTIN_PRESETS,
  customs: await readCustomPresets(wallet),
});

/**
 * Save a custom preset. The spec is validated by the pure module — its
 * corrections surface as 400s at the route.
 * @returns {Promise<{presets: Array, preset: Object}>}
 */
// impure
export const createCustomPreset = (wallet, spec) => withStoreQueue(wallet, async () => {
  const valid = validatePresetSpec(spec);
  const preset = { id: crypto.randomUUID(), ...valid, createdAt: new Date().toISOString() };
  const presets = [...await readCustomPresets(wallet), preset];
  await writeCustomPresets(wallet, presets);
  return { presets, preset };
});

/**
 * Delete a custom preset. Built-ins are not in the custom store, so they can
 * never be deleted — asking is a plain not-found.
 */
// impure
export const deleteCustomPreset = (wallet, presetId) => withStoreQueue(wallet, async () => {
  const presets = await readCustomPresets(wallet);
  if (!presets.some((p) => p.id === presetId)) {
    throw Object.assign(new Error('no custom preset with that id'), { notFound: true });
  }
  const next = presets.filter((p) => p.id !== presetId);
  await writeCustomPresets(wallet, next);
  return { presets: next };
});

/**
 * Resolve a preset id to its spec — built-in first, then customs. Null when
 * nothing matches (the route's 404).
 */
// impure
export const resolvePreset = async (wallet, presetId) => {
  const builtin = BUILTIN_PRESETS.find((p) => p.id === presetId);
  if (builtin) return builtin;
  const customs = await readCustomPresets(wallet);
  return customs.find((p) => p.id === presetId) ?? null;
};
