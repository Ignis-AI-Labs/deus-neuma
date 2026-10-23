// managed-ollama-record — where the platform's own model server was set up, read by the
// setup (managed-ollama.js) and by the machine read (substrate-setup.js), which must always
// look for that server first: when an outdated Ollama holds the usual port, the platform's
// own answers on the next one, and only this record says so for certain.
//
// impure (fs).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDataRoot } from './data-root.js';

/** The record's path, read at call time (packaged vs dev data roots). impure */
export const managedRecordPath = () => path.join(getDataRoot(), 'model-server', 'managed.json');

/** What the platform set up ({version, managed, bin, endpoint, home, modelsDir, model, …}), or null. impure */
export const readManagedRecord = () => {
  try { return JSON.parse(fs.readFileSync(managedRecordPath(), 'utf8')); } catch { return null; }
};

/**
 * Write the record whole (tmp + rename), its folder made first. The tmp name is this write's own:
 * a name shared by two writes in one process (pid only) let the first rename take the second's
 * file, […] (2026-10-23). impure
 */
export const writeManagedRecord = async (record) => {
  const file = managedRecordPath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(record, null, 2));
  await fsp.rename(tmp, file);
};
