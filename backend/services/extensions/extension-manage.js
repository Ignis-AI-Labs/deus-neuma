/**
 * THE EXTENSION SHELF — what the CLI and the HTTP routes call: the catalog
 * with what is installed and checked, and the few things a person does with
 * an extension. Each change that could alter what an extension offers
 * (installing it, giving it a key, switching it on) reads its tools again by
 * starting it once and stopping it, so a being's catalog never starts a process.
 *
 * impure — the store, npm, OSV, child processes.
 */
import { EXTENSIONS, extensionById, THIRD_PARTY_NOTE } from './extension-catalog.js';
import { readInstalled, updateInstalled, setExtensionKey, keyState, keysFor } from './extension-store.js';
import { installExtension, removeExtension, recheckExtension } from './extension-install.js';
import { notRunnable, listExtensionTools, stopExtension } from './extension-runner.js';

/** impure — read its tools when it can run; record why not when it cannot. */
export const discoverTools = async (id) => {
  const entry = extensionById(id);
  const record = (await readInstalled())[id] ?? null;
  const why = notRunnable(entry, record, await keysFor(id));
  if (why) return updateInstalled(id, (prior) => (prior ? { ...prior, toolsWhy: why } : null));
  try {
    const tools = await listExtensionTools(id);
    return updateInstalled(id, (prior) => (prior ? { ...prior, tools, toolsWhy: null, toolsAt: new Date().toISOString() } : null));
  } catch (error) {
    return updateInstalled(id, (prior) => (prior ? { ...prior, tools: null, toolsWhy: `it would not start: ${error.message}` } : null));
  } finally {
    await stopExtension(id).catch(() => {});
  }
};

/** impure — the whole shelf as a person reads it (never a key's value). */
export const extensionShelf = async () => {
  const installed = await readInstalled();
  const rows = await Promise.all(EXTENSIONS.map(async (entry) => {
    const record = installed[entry.id] ?? null;
    const keys = await keysFor(entry.id);
    return {
      id: entry.id, name: entry.name, publisher: entry.publisher, package: `${entry.package}@${entry.version}`,
      repository: entry.repository, reaches: entry.reaches, does: entry.does, keys: keyState(entry, keys),
      ...(entry.held ? { held: entry.held } : {}),
      installed: Boolean(record),
      ...(record ? {
        enabled: record.enabled !== false, blocked: Boolean(record.blocked), blockedWhy: record.blockedWhy ?? null,
        check: record.check ?? null, tools: (record.tools ?? []).map((t) => t.name), toolsWhy: record.toolsWhy ?? null,
        runnable: !notRunnable(entry, record, keys), outdated: record.version !== entry.version,
      } : {}),
    };
  }));
  return { note: THIRD_PARTY_NOTE, extensions: rows };
};

/** impure — install (checked), then read its tools. */
export const addExtension = async (id) => {
  await installExtension(id);
  return discoverTools(id);
};

/** impure — give it a key, then read its tools again. */
export const giveExtensionKey = async (id, name, value) => {
  const keys = await setExtensionKey(id, name, value);
  if ((await readInstalled())[id]) await discoverTools(id);
  return keys;
};

/** impure — switch it on or off; off stops it at once. */
export const switchExtension = async (id, on) => {
  const record = await updateInstalled(id, (prior) => (prior ? { ...prior, enabled: Boolean(on) } : null));
  if (!record) throw new Error(`${id} is not installed`);
  if (on) return discoverTools(id);
  await stopExtension(id).catch(() => {});
  return record;
};

/** impure — check it again now. */
export const checkExtension = async (id) => {
  if (!(await readInstalled())[id]) throw new Error(`${id} is not installed`);
  const { record } = await recheckExtension(id);
  if (record?.blocked) await stopExtension(id).catch(() => {});
  return record;
};

/** impure — stop it and take it off the computer, keys included. */
export const dropExtension = async (id) => {
  await stopExtension(id).catch(() => {});
  return removeExtension(id);
};
