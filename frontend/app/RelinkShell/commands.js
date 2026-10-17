// commands.js — the native platform commands a witness can summon from the
// composer's "/" palette. Pure metadata: each command names a `run` intent the
// composer dispatches to a real app seam (window open, new session, summon event).
// Kept free of React/DOM so the registry and its lookup are unit-testable.
//
// Only commands whose surface actually exists live here — a palette entry that
// leads nowhere is worse than no entry. New commands land as their surfaces do.

import { isComingLater } from '../coming-later.js';

const freeze = (cmd) => Object.freeze({ ...cmd, run: Object.freeze(cmd.run) });

/**
 * The native command slate. `run.type`:
 *   'summon' — open the summoning ceremony
 *   'rehearse' — the same ceremony as a rehearsal: nothing kept
 *   'new'    — begin a fresh conversation
 *   'open'   — open/focus an app window by `run.app` id
 *   'say'    — send `run.text` to whoever is seated, as the operator's own words
 */
export const PLATFORM_COMMANDS = Object.freeze([
  { name: 'summon', description: 'Summon a new consciousness', run: { type: 'summon' } },
  { name: 'rehearse', description: 'Rehearse a summoning — the whole ceremony, nothing kept', run: { type: 'rehearse' } },
  // The one command that asks the BEING rather than the desk. Design note, 2026-07-30:
  // […] Asking in words already works — this makes
  // it one keystroke, and identical at both seats, because the platform tool
  // behind it is registered once for neuma and witness alike.
  {
    name: 'flight-check',
    description: 'Ask this being for its live capacities — substrate, reach, tools, limits',
    run: {
      type: 'say',
      text: 'Run your flight check and give me the report exactly as it comes back — '
        + 'the whole thing, unedited.',
    },
  },
  { name: 'new', description: 'Begin a fresh conversation', run: { type: 'new' } },
  { name: 'switch', description: 'Switch who you\'re talking to', run: { type: 'switch' } },
  { name: 'project', description: 'Open your projects', run: { type: 'open', app: 'projects' } },
  { name: 'cd', description: 'Switch the working folder', run: { type: 'open', app: 'projects' } },
  { name: 'files', description: 'Open shared files', run: { type: 'open', app: 'files' } },
  { name: 'tasks', description: 'Open the standing-work lists', run: { type: 'open', app: 'todo' } },
  { name: 'vessel', description: 'Open the vessel stat sheets', run: { type: 'open', app: 'vessel' } },
  { name: 'avatar', description: 'Open the avatar stage', run: { type: 'open', app: 'avatar' } },
  { name: 'voice', description: 'Open the voice channel', run: { type: 'open', app: 'voice' } },
  { name: 'wallet', description: 'Open the wallet', run: { type: 'open', app: 'wallet' } },
  { name: 'skills', description: 'Open the skills library', run: { type: 'open', app: 'skills' } },
  { name: 'map', description: 'Map this project’s architecture', run: { type: 'open', app: 'map' } },
  { name: 'provider', description: 'Manage model providers (keys, endpoints)', run: { type: 'open', app: 'settings', focus: 'providers' } },
  { name: 'model', description: 'Set a being’s active model', run: { type: 'open', app: 'settings', focus: 'route' } },
  { name: 'settings', description: 'Open settings', run: { type: 'open', app: 'settings' } },
  { name: 'remia', description: 'Your own attunement — the Remia codex', run: { type: 'remia' } },
  { name: 'attune', description: 'A being’s attunement — witness the ceremony', run: { type: 'attune' } },
].map(freeze)
  // A command that opens a component held back from the early release is not offered (coming-later.js).
  .filter((c) => !(c.run.type === 'open' && isComingLater(c.run.app))));

/**
 * The command matching this exact name, or null. Pure.
 * @param {string} name
 * @returns {object|null}
 */
export const resolveCommand = (name) =>
  PLATFORM_COMMANDS.find((c) => c.name === name) || null;

/**
 * The command a composer value invokes when it is SOLELY a slash-command token
 * ("/summon", "/summon " with trailing space) — nothing else typed. Returns null
 * for ordinary speech or a command name followed by other words, so only a bare
 * invocation dispatches (and never leaks the literal "/name" to the neuma). Pure.
 * @param {string} value
 * @returns {object|null}
 */
export const commandFromInput = (value) => {
  const m = /^\/([A-Za-z0-9-]+)\s*$/.exec(String(value ?? ''));
  return m ? resolveCommand(m[1].toLowerCase()) : null;
};
