// export-files — a data export as the person downloaded it: the .zip itself, or the folder it
// unpacked to, read the same way; and which service it came from, told by what is inside.
//   Claude  (Settings → Privacy → Export data): conversations.json, memories.json, users.json, projects/<id>.json
//   ChatGPT (Settings → Data controls → Export data): conversations.json, chat.html, user.json, message_feedback.json
// impure (reads the disk)
import fs from 'node:fs/promises';
import path from 'node:path';
import { openZip } from './zip-read.js';

const FOLDER_DEPTH = 2;

/** Which export this is, from the names inside it — or null. Pure. */
export const exportKind = (names) => {
  const has = (n) => names.includes(n);
  if (!has('conversations.json')) return null;
  if (has('chat.html') || has('message_feedback.json') || has('user.json')) return 'chatgpt-export';
  if (has('memories.json') || has('users.json') || names.some((n) => n.startsWith('projects/'))) return 'claude-export';
  return null;
};

// impure — the files under a folder, relative with forward slashes, two levels down, links left out
const namesUnder = async (dir, rel = '', depth = 0, out = []) => {
  for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => [])) {
    const name = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isFile()) out.push(name);
    else if (entry.isDirectory() && depth + 1 < FOLDER_DEPTH) await namesUnder(dir, name, depth + 1, out);
  }
  return out;
};

/**
 * Open an export — a .zip or a folder — for reading. Close it when done. impure
 * @param {string} target
 * @returns {Promise<{names: string[], has: (name: string) => boolean, read: (name: string, max: number) => Promise<Buffer>, close: () => Promise<void>}>}
 */
export const openExport = async (target) => {
  const stat = await fs.lstat(target);
  if (stat.isDirectory()) {
    const names = await namesUnder(target);
    const read = async (name, max) => {
      if (!names.includes(name)) throw new Error(`${name} is not in the export`);
      const file = path.join(target, name);
      const { size } = await fs.lstat(file);
      if (size > max) throw new Error(`${name} is ${size.toLocaleString('en-US')} bytes, more than the ${max.toLocaleString('en-US')} this import reads`);
      return fs.readFile(file);
    };
    return { names, has: (n) => names.includes(n), read, close: async () => {} };
  }
  if (!stat.isFile()) throw new Error('not a file or a folder');
  const zip = await openZip(target);
  const names = zip.entries.map((e) => e.name).filter((n) => !n.endsWith('/'));
  return { names, has: (n) => names.includes(n), read: zip.read, close: zip.close };
};

/** Read one JSON entry of an export. impure */
export const readJson = async (ex, name, max) => JSON.parse((await ex.read(name, max)).toString('utf8'));
