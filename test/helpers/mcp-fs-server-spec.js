/**
 * THE FILESYSTEM SERVER SPEC THE TESTS SPAWN — pinned, never "latest".
 *
 * These tests used to spawn `npx -y @modelcontextprotocol/server-filesystem`
 * with no version. npm resolves that from the network, so the suite exercised
 * whatever upstream published that morning while the organ in
 * native-filesystem.js ran the version in package.json. A test that passes
 * against a version nobody ships proves nothing.
 *
 * The version comes from the installed package, so it tracks package.json in a
 * single move: bump the dependency and the spawn follows.
 *
 * pure (reads one package.json).
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);

/** The installed version of the filesystem server this tree ships. */
export const FILESYSTEM_SERVER_VERSION =
  require('@modelcontextprotocol/server-filesystem/package.json').version;

/**
 * The npm spec an `npx` spawn must name: `@scope/pkg@<installed version>`.
 *
 * The allowlist in backend/routes/mcp-routes.js rejects a version suffix on
 * client-supplied argv, so this helper belongs to tests only: it is the one
 * place that knows tests spawn a pinned copy on purpose.
 */
export const FILESYSTEM_SERVER_SPEC = `@modelcontextprotocol/server-filesystem@${FILESYSTEM_SERVER_VERSION}`;

/**
 * The same version, read from the lockfile instead of node_modules. Used by the
 * package contract test so a missing install cannot pass silently.
 * @returns {string} the version named in package-lock.json
 */
export const lockedFilesystemVersion = () => {
  const lockPath = path.resolve(fileURLToPath(import.meta.url), '../../../package-lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const entry = lock.packages?.['node_modules/@modelcontextprotocol/server-filesystem'];
  if (!entry?.version) throw new Error('server-filesystem is absent from package-lock.json');
  return entry.version;
};
