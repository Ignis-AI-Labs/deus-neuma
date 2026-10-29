// One JSON line appended to an append-only file, crash-safe: a crash
// mid-append leaves a torn line with no newline, and appending straight after
// it would weld the new record onto the garbage and destroy both. So the tail
// is healed FIRST — the torn line stays torn (readers count it), and the new
// record lands whole. The same law house-post.js keeps for the house inbox.
// impure.

import fs from 'fs/promises';
import path from 'path';

/**
 * @param {string} file - absolute path of the .jsonl file
 * @param {object} value - JSON-serializable record
 */
export const appendJsonLine = async (file, value) => {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await fs.open(file, 'a+', 0o600);
    const { size } = await handle.stat();
    if (size > 0) {
      const tail = Buffer.alloc(1);
      await handle.read(tail, 0, 1, size - 1);
      if (tail.toString('utf8') !== '\n') await handle.write('\n', size, 'utf8');
    }
    await handle.write(`${JSON.stringify(value)}\n`, null, 'utf8');
  } finally {
    await handle?.close();
  }
};

/**
 * Every whole line of a .jsonl file, oldest first; a missing file is an empty
 * record. A line that does not parse is counted in `torn`, never dropped
 * silently.
 * @param {string} file
 * @returns {Promise<{records: Array<object>, torn: number}>}
 */
export const readJsonLines = async (file) => {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return { records: [], torn: 0 };
    throw err;
  }
  return text.split('\n').filter((l) => l.trim()).reduce((acc, line) => {
    try {
      return { ...acc, records: [...acc.records, JSON.parse(line)] };
    } catch {
      return { ...acc, torn: acc.torn + 1 };
    }
  }, { records: [], torn: 0 });
};
