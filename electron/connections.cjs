// connections.cjs — every connection the app makes, and whether the person has turned it on.
//
// Design note, 2026-10-25: […] Ruled the same evening: every connection that
// runs by itself is OFF until the person turns it on, and one list says them all — in the app's
// CONNECTIONS panel and on the site, which syncs connections.json from a committed revision.
//
// connections.json is the list (data). This module is its one reader, shared by the Electron main
// process (update check, spellcheck) and the backend (security watch, platform data, the panel's
// routes), so the two sides can never disagree on where a switch lives or what a missing one means.
//
// The switch file is <data root>/settings/connections.json: { "<id>": true|false }. A switch never
// written reads as its default (off). A file that cannot be read or parsed reads as everything OFF —
// a broken file must never invent consent to send something.

const fs = require('fs');
const path = require('path');
const REGISTRY = require('./connections.json');

const CONNECTIONS = Object.freeze(REGISTRY.connections.map((row) => Object.freeze({ ...row })));
// The connections this list switches (control "switch"); the others are governed where they live.
const SWITCHED = Object.freeze(CONNECTIONS.filter((row) => row.control === 'switch').map((row) => row.id));

/**
 * Is a switched connection on, given the parsed switch file? `saved` null = unreadable. Pure.
 * @param {string} id
 * @param {Record<string, boolean>|null} saved
 */
const switchOn = (id, saved) => {
  const row = CONNECTIONS.find((c) => c.id === id && c.control === 'switch');
  if (!row || saved === null) return false;
  return typeof saved[id] === 'boolean' ? saved[id] : row.default === true;
};

/**
 * The data root as the backend resolves it: NEUMA_DATA_ROOT when set (packaged installs and agent
 * lanes), else the home root for a packaged app, else the repo's data/. Pure.
 */
const dataRootFor = ({ env, isPackaged, home, repoRoot }) =>
  env.NEUMA_DATA_ROOT || (isPackaged ? path.join(home, '.neuma', 'data') : path.join(repoRoot, 'data'));

/** The switch file. NEUMA_CONNECTIONS_PATH is the isolation door tests use. Pure. */
const switchFilePath = ({ env, dataRoot }) =>
  env.NEUMA_CONNECTIONS_PATH || path.join(dataRoot, 'settings', 'connections.json');

/**
 * Read the switch file: {} when none was ever written, null when it cannot be read as an object.
 * impure — fs.
 */
const readSwitchFile = (file) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return error.code === 'ENOENT' ? {} : null;
  }
};

/** Is this connection on right now? impure — reads the switch file. */
const isOn = (id, { env = process.env, dataRoot }) => switchOn(id, readSwitchFile(switchFilePath({ env, dataRoot })));

module.exports = { CONNECTIONS, SWITCHED, switchOn, dataRootFor, switchFilePath, readSwitchFile, isOn };
