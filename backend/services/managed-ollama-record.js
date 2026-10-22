// managed-ollama-record — where the platform's own model server was set up, read by the
// setup (managed-ollama.js) and by the machine read (substrate-setup.js), which must always
// look for that server first: when an outdated Ollama holds the usual port, the platform's
// own answers on the next one, and only this record says so for certain.
//
// impure (fs).
import fs from 'node:fs';
import path from 'node:path';
import { getDataRoot } from './data-root.js';

/** The record's path, read at call time (packaged vs dev data roots). impure */
export const managedRecordPath = () => path.join(getDataRoot(), 'model-server', 'managed.json');

/** What the platform set up ({version, managed, bin, endpoint, model, …}), or null. impure */
export const readManagedRecord = () => {
  try { return JSON.parse(fs.readFileSync(managedRecordPath(), 'utf8')); } catch { return null; }
};
