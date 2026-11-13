// model-home — the folder a person chose for the model server and its models, before anything
// downloads. Models are large (3 to 35 GB): a person whose system drive is full keeps them on
// another drive, and the setup puts them there from the first byte.
//
// Design note, 2026-11-13, after a teammate's Windows install put its model on a full C: drive: […] The Windows installer asked for the folder and kept it in the registry, but the app never
// read it back, so a setup the app ran itself (the installer's download skipped or stopped) went to
// the default folder on C:.
//
// The choice, newest first: the folder picked in the app (the door's CHANGE, kept in
// settings/model-home.json), else the folder picked in the Windows installer
// (HKCU\Software\Deus Neuma\ModelHome). It applies to the NEXT setup; a server already set up keeps
// running from its own folder (its record) until a setup into the new folder replaces it.
// impure (fs, the Windows registry).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getSettingsDir } from './data-root.js';

const choicePath = () => path.join(getSettingsDir(), 'model-home.json');

/** The Windows installer's `reg query` answer, read for its ModelHome value. Pure. */
export const parseRegistryHome = (stdout) => {
  const m = /^\s*ModelHome\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m.exec(String(stdout || ''));
  return m && path.win32.isAbsolute(m[1]) ? m[1] : null;
};

// the installer writes the registry only while it runs, so one read per backend is enough
let installerHome;
const installerChoice = () => {
  if (process.platform !== 'win32') return null;
  if (installerHome === undefined) {
    const r = spawnSync('reg', ['query', 'HKCU\\Software\\Deus Neuma', '/v', 'ModelHome'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    installerHome = r.status === 0 ? parseRegistryHome(r.stdout) : null;
  }
  return installerHome;
};

/** The folder the person chose for models, or null (the setup's own default). impure */
export const chosenModelHome = () => {
  try {
    const saved = JSON.parse(fs.readFileSync(choicePath(), 'utf8'));
    if (typeof saved?.home === 'string' && path.isAbsolute(saved.home)) return saved.home;
  } catch { /* no choice made in the app */ }
  return installerChoice();
};

const refuse = (message) => Object.assign(new Error(message), { code: 'MODEL_HOME' });

/**
 * Keep the person's folder for the next setup: made if missing, and it must take a file, so the
 * download never finds out halfway. impure
 * @param {string} home - an absolute folder
 * @returns {Promise<string>} the folder, resolved
 */
export const chooseModelHome = async (home) => {
  if (typeof home !== 'string' || !path.isAbsolute(home)) throw refuse('Choose a folder by its full path.');
  const dir = path.resolve(home);
  try {
    await fsp.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.neuma-write-check-${process.pid}`);
    await fsp.writeFile(probe, '');
    await fsp.rm(probe, { force: true });
  } catch (err) {
    throw refuse(`Deus Neuma cannot write in ${dir} (${err.code || err.message}). Choose a folder you can write to.`);
  }
  await fsp.mkdir(path.dirname(choicePath()), { recursive: true });
  const tmp = `${choicePath()}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ home: dir, chosenAt: new Date().toISOString() }, null, 2));
  await fsp.rename(tmp, choicePath());
  return dir;
};
