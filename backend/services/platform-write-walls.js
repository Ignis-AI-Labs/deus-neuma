/**
 * The write walls no grant reaches — the install's settings, the realm, and
 * the operator's session persistence (security seat G6, audit 2026-10-19).
 *
 * A being's write reach is its lane plus whatever the operator lends it: a
 * focus ground, a project folder, a granted root. When that loan is wide (the
 * Neuma checkout, the operator's home) it used to carry the platform's own
 * state with it: data/settings (tool policy, the install owner, provider
 * choice), the realm (every house's offices, threat ledger and seat files),
 * and the files a login runs (~/.bashrc, autostart, systemd user units, cron)
 * — a write there outlives the turn and acts as the operator. The same shape
 * as the lane-state wall: writes only, and a directory holding a wall counts
 * (moving ~/.config aside and back with a planted unit is the same write).
 *
 * Every root is resolved PER CALL, never at import: the data root, the realm
 * root and HOME are all relocatable at runtime (launch isolation, the realm
 * mover, tests), and a wall pinned at import would guard a stale place.
 *
 * Two more kinds joined (recheck 2026-10-20, §8): the configuration the
 * operator's own tools trust and run from (git, ssh, gpg, npm, docker, gh,
 * the coding agents), and inside ANY checkout the repository's own gate — its
 * git hooks, its git config and its agent settings. Those last are walls by
 * shape, wherever a repository stands.
 */
import os from 'os';
import path from 'path';
import { existsSync, realpathSync } from 'fs';
import { getDataRoot, getSettingsDir } from './data-root.js';
import { getRealmRoot } from './user-realm.js';

const PLATFORM_STATE_REFUSAL = 'That path is this install\'s own state (its settings or the realm every house keeps) — '
  + 'it changes only through the platform\'s own acts, never a file write. Reading it is fine.';
const PERSISTENCE_REFUSAL = 'That path runs when your operator logs in or on a schedule (a shell profile, autostart, '
  + 'a user service, cron, a command on their PATH) — no grant reaches it. Ask your operator to make that change themselves.';
const TRUSTED_CONFIG_REFUSAL = 'That path is configuration your operator\'s own tools trust and act on (git, ssh, gpg, '
  + 'npm, docker, gh, coding agents) — no grant reaches it. Ask your operator to make that change themselves.';
const REPO_GATE_REFUSAL = 'That path is a repository\'s own gate (its git hooks, its git config, or its agent settings '
  + 'in .claude/) — no grant reaches it. Ask your operator to make that change themselves.';

// Below the operator's home: the shell startup and logout files, the X and
// PAM session files, and the directories a session, a desktop (KDE Plasma
// included), systemd, D-Bus activation or launchd runs from.
const HOME_PERSISTENCE = Object.freeze([
  '.bashrc', '.bash_profile', '.bash_login', '.bash_logout', '.profile', '.zshrc', '.zshenv', '.zprofile', '.zlogin',
  '.zlogout', '.pam_environment', '.xprofile', '.xinitrc', '.xsession', '.xsessionrc', '.Xresources',
  '.config/autostart', '.config/autostart-scripts', '.config/plasma-workspace', '.config/systemd',
  '.config/environment.d', '.config/fish', '.local/share/applications', '.local/share/systemd', '.local/share/dbus-1',
  '.local/bin', 'bin', 'Library/LaunchAgents',
]);
// Below the operator's home: what their tools read as the operator's own word.
const HOME_TRUSTED_CONFIG = Object.freeze([
  '.gitconfig', '.config/git', '.ssh', '.gnupg', '.npmrc', '.netrc', '.docker/config.json', '.config/gh',
  '.claude', '.claude.json', '.config/opencode', '.codex',
]);
// Inside any checkout, matched by path segments: the hooks git runs and the
// config that names them, the hooks directory a repo's hooksPath names, and
// the agent settings that decide what a coding agent may run.
const REPO_GATES = Object.freeze([['.git', 'hooks'], ['.git', 'config'], ['scripts', 'git-hooks'], ['.claude']]);
// The per-user crontab spools (Linux; macOS and the BSDs).
const CRON_SPOOLS = Object.freeze(['/var/spool/cron', '/usr/lib/cron/tabs', '/var/at/tabs']);

// impure (fs) — the symlink-resolved form of a path that may not exist yet:
// realpath the nearest existing ancestor, re-append the rest. Both forms are
// walls, so a home reached through a link (/home → /var/home) is no way round.
const realOf = (target) => {
  const tail = [];
  let current = target;
  for (;;) {
    try {
      return path.join(realpathSync(current), ...tail);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
};

// pure — the home-relative walls, and their mirrors under a relocated
// XDG_CONFIG_HOME / XDG_DATA_HOME.
const underHome = (home, rels, env) => rels.flatMap((rel) => [
  path.join(home, rel),
  ...(env.XDG_CONFIG_HOME && rel.startsWith('.config/') ? [path.join(env.XDG_CONFIG_HOME, rel.slice(8))] : []),
  ...(env.XDG_DATA_HOME && rel.startsWith('.local/share/') ? [path.join(env.XDG_DATA_HOME, rel.slice(13))] : []),
]);

// pure — the PATH directories inside the operator's home: a file there runs
// as a command the next time its name is typed. Home itself is never one of
// them (that would wall every write in it); a relative entry names no place.
const homePathDirs = (home, env) => String(env.PATH || '').split(path.delimiter)
  .filter((dir) => path.isAbsolute(dir))
  .map((dir) => path.resolve(dir))
  .filter((dir) => dir !== home && dir.startsWith(home + path.sep));

/**
 * The walls as they stand right now: places, lexical and symlink-resolved,
 * and the repository gates as path-segment shapes.
 * impure (reads env, the realm root and the disk).
 * @param {Record<string, string|undefined>} [env]
 * @returns {Array<{ path: string, reason: string } | { segments: string[], reason: string }>}
 */
export const platformWriteWalls = (env = process.env) => {
  const home = path.resolve(os.homedir());
  const state = [getSettingsDir(), path.join(getDataRoot(), 'settings-store'), getRealmRoot()];
  const persistence = [...underHome(home, HOME_PERSISTENCE, env), ...homePathDirs(home, env), ...CRON_SPOOLS];
  const walls = (paths, reason) => paths.flatMap((p) => {
    const lexical = path.resolve(p);
    const real = realOf(lexical);
    return (real === lexical ? [lexical] : [lexical, real]).map((at) => ({ path: at, reason }));
  });
  return [
    ...walls(state, PLATFORM_STATE_REFUSAL), ...walls(persistence, PERSISTENCE_REFUSAL),
    ...walls(underHome(home, HOME_TRUSTED_CONFIG, env), TRUSTED_CONFIG_REFUSAL),
    ...REPO_GATES.map((segments) => ({ segments, reason: REPO_GATE_REFUSAL })),
  ];
};

// pure — is `inner` the same path as `outer` or below it? Both resolved and folded.
const atOrBelow = (inner, outer) => {
  const rel = path.relative(outer, inner);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};

// pure — does `parts` carry `segments` as one contiguous run?
const carriesRun = (parts, segments) =>
  parts.some((_, i) => segments.every((segment, j) => parts[i + j] === segment));

// impure (fs) — does a write at `target` reach a repository gate: the gate,
// anything below it, or a directory that holds one on disk? Moving a checkout,
// its .git or its scripts/ aside moves the gate with it, and only the disk
// knows which directory named `scripts` holds a git-hooks.
const reachesRepoGate = (target, segments) => {
  const parts = target.toLowerCase().split(path.sep).filter(Boolean);
  if (carriesRun(parts, segments)) return true;
  return segments.some((_, held) => {
    const tailIsGate = segments.slice(0, held).every((segment, k) => parts[parts.length - held + k] === segment);
    return tailIsGate && existsSync(path.join(target, ...segments.slice(held)));
  });
};

/**
 * Does a WRITE reach a wall — the wall itself, anything below it, or a
 * directory holding it? Case-folded, so a case-insensitive volume cannot be
 * asked for `.BashRC` instead. Pure for place walls; a repository gate looks
 * at the disk for the gate a directory holds (impure).
 * @param {string} filePath
 * @param {Array<{ path: string, reason: string } | { segments: string[], reason: string }>} walls
 * @returns {string|null} the refusal, or null when no wall is reached
 */
export const platformWallWriteReason = (filePath, walls) => {
  const resolved = path.resolve(filePath);
  const target = resolved.toLowerCase();
  for (const wall of walls) {
    if (wall.segments) {
      if (reachesRepoGate(resolved, wall.segments)) return wall.reason;
      continue;
    }
    const at = wall.path.toLowerCase();
    if (atOrBelow(target, at) || atOrBelow(at, target)) return wall.reason;
  }
  return null;
};
