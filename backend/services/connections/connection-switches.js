// connection-switches — the backend's side of the CONNECTIONS list (electron/connections.cjs): is a
// connection on, the list with each switch's state for the panel, and the install owner's flip.
//
// Every connection that runs by itself starts OFF and stays off until the person turns it on (Founder,
// 2026-10-25). The gates (security watch's online check, public platform data) ask isConnectionOn at
// their network door, per call, so a flip takes effect on the next request without a restart.

import fs from 'fs/promises';
import { dirname } from 'path';
import connections from '../../../electron/connections.cjs';
import { getDataRoot } from '../data-root.js';
import { webSettings } from '../web-settings.js';

const { CONNECTIONS, SWITCHED, switchOn, switchFilePath, readSwitchFile } = connections;

/** Where the switches live for this process. Resolved per call (the isolation door). impure — env. */
const switchFile = () => switchFilePath({ env: process.env, dataRoot: getDataRoot() });

/** Is this switched connection on right now? impure — reads the switch file. */
export const isConnectionOn = (id) => switchOn(id, readSwitchFile(switchFile()));

/**
 * Every connection, as the panel shows it: switched rows carry `on`, the web row its own switch's
 * state, the rest happen only when the person uses them. impure — reads both switch files.
 */
export const connectionStates = async () => {
  const saved = readSwitchFile(switchFile());
  const web = await webSettings.isEnabled();
  return CONNECTIONS.map((row) => {
    if (row.control === 'switch') return { ...row, on: switchOn(row.id, saved) };
    if (row.control === 'web') return { ...row, on: web };
    return { ...row };
  });
};

/** Is this an id the list switches? Pure. */
export const isSwitchedConnection = (id) => SWITCHED.includes(id);

/**
 * Turn one switched connection on or off, keeping the others as they are. An unreadable file is
 * replaced (it read as everything off, which is what the rewrite keeps for the rest). impure — fs.
 * @param {string} id
 * @param {boolean} on
 */
export const setConnection = async (id, on) => {
  if (!isSwitchedConnection(id)) throw new Error(`no switch named ${id}`);
  const file = switchFile();
  const next = { ...(readSwitchFile(file) || {}), [id]: on === true };
  await fs.mkdir(dirname(file), { recursive: true });
  // tmp + rename: a crash mid-write leaves the old file, never a half one
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
  await fs.rename(tmp, file);
};
