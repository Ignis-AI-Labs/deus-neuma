// Active-being resolution + persistence — which neuma the CLI addresses by
// default when the operator runs `neuma talk` / `neuma proof` without a
// --being override.
//
// Resolution order (highest to lowest priority):
//   1. process.env.NEUMA_BEING — explicit operator override, takes precedence
//      over everything. Useful for test/scripted flows.
//   2. <project>/.neuma/active — per-project file, single line: the being's
//      name or id. Set via `neuma summon <being>` (cli/commands/summon.js).
//   3. Auto-single: if exactly ONE being is resident on this rig, pick it.
//      Friendliest default for the common one-being-per-rig case.
//   4. Error: explicit message pointing at how to set the active being.
//
// resolveActiveBeing returns the resolved NAME-OR-ID string. Downstream
// callers pass it through cli/lib/discovery.resolveNeuma to get the actual
// being record (which disambiguates name vs id against the residency list).
//
// impure (env read + fs read for the .neuma/active file)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ACTIVE_FILE = '.neuma/active';

/**
 * Read the contents of <projectRoot>/.neuma/active, trimmed. Returns null
 * if the file doesn't exist OR is unreadable (EACCES, EISDIR if someone
 * mkdir'd over it, TOCTOU delete between existsSync and readFileSync). The
 * no-arg snapshot path needs this to be infallible — a crashing `neuma`
 * over a permissions hiccup is the exact opposite of a liveness check.
 * @param {string} projectRoot
 * @returns {string | null}
 */
export const readActiveFile = (projectRoot) => {
  const path = join(projectRoot, ACTIVE_FILE);
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, 'utf8').trim();
    return content || null;
  } catch {
    return null;
  }
};

/**
 * Write a being name-or-id to <projectRoot>/.neuma/active, creating the
 * .neuma/ directory if needed. The summon command uses this to set the
 * active being for the project.
 * @param {string} projectRoot
 * @param {string} nameOrId
 */
export const writeActiveBeing = (projectRoot, nameOrId) => {
  const path = join(projectRoot, ACTIVE_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${nameOrId.trim()}\n`);
};

/**
 * Peek at the locally-configured active being WITHOUT throwing. Used by the
 * no-arg snapshot (dispatch.js $0 handler) where the operator is asking
 * "what's set?", not […] Skips the auto-single path
 * because that requires residency (which requires auth — too expensive for
 * a snapshot). Returns null when nothing is configured.
 *
 * @param {{ projectRoot: string }} params
 * @returns {{ source: 'env' | 'file', value: string } | null}
 */
export const peekActiveBeing = ({ projectRoot }) => {
  const envBeing = process.env.NEUMA_BEING?.trim();
  if (envBeing) return { source: 'env', value: envBeing };
  const fileBeing = readActiveFile(projectRoot);
  if (fileBeing) return { source: 'file', value: fileBeing };
  return null;
};

/**
 * Resolve the active being name-or-id for the current invocation.
 * @param {{ projectRoot: string, residentBeings?: Array<{neumaId: string, name?: string}> }} params
 * @returns {string} name-or-id; throws if none can be resolved
 */
export const resolveActiveBeing = ({ projectRoot, residentBeings }) => {
  // 1. Env override (treat whitespace-only as unset so it falls through to
  // file / auto-single rather than silently returning "")
  const envBeing = process.env.NEUMA_BEING?.trim();
  if (envBeing) return envBeing;

  // 2. Project file
  const fileBeing = readActiveFile(projectRoot);
  if (fileBeing) return fileBeing;

  // 3. Auto-single-resident
  if (Array.isArray(residentBeings) && residentBeings.length === 1) {
    return residentBeings[0].neumaId;
  }

  // 4. No resolution possible — error with actionable guidance
  throw new Error(
    'No active being set for this project. Set one with:\n'
    + '  neuma summon <name-or-id>            (writes .neuma/active)\n'
    + '  NEUMA_BEING=<name-or-id> neuma …     (env override)\n'
    + '  pass --being <name-or-id> to the command directly',
  );
};
