/**
 * THE UPSTREAM CONTRACT — what the organ is allowed to assume about the
 * pinned @modelcontextprotocol/server-filesystem, asserted instead of hoped.
 *
 * backend/services/native-filesystem.js executes the package's lib.js as the
 * security authority (validatePath's allowed-roots wall, the exclusive-create
 * and atomic-rename write discipline), and native-fs-catalog.js mirrors the
 * tool registrations. Both are version-sensitive in ways an import error does
 * NOT catch:
 *
 *   - a REMOVED export only fails when a handler runs, which is a being's
 *     first file read, not a boot;
 *   - a RENAMED or ADDED upstream tool leaves the catalog silently short.
 *
 * 2026.7.10 -> 2.0.1 was exactly this class of break: getAllowedDirectories
 * and setAllowedDirectories disappeared, validatePath gained its second
 * argument, and the organ now threads its own roots through every call. This
 * file fails loudly if a future bump undoes any of it.
 *
 * pure (reads the installed package; no network, no writes).
 */

import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import { FILESYSTEM_TOOL_CATALOG } from '../../backend/services/native-fs-catalog.js';
import {
  FILESYSTEM_SERVER_VERSION,
  lockedFilesystemVersion,
} from '../helpers/mcp-fs-server-spec.js';

const require = createRequire(import.meta.url);

const pkgRoot = path.dirname(require.resolve('@modelcontextprotocol/server-filesystem/package.json'));
const distPath = (name) => path.join(pkgRoot, 'dist', name);
const distUrl = (name) => pathToFileURL(distPath(name)).href;

/**
 * Exports the organ imports today, minus validatePath, whose arity is expected
 * to change. Each must stay a function; a rename or removal is a breaking
 * change to the organ, not a detail.
 */
const STABLE_LIB_EXPORTS = [
  'applyFileEdits', 'formatSize', 'getFileStats', 'headFile', 'readFileContent',
  'tailFile', 'writeFileContent',
];

/** path-utils survives both versions and native-fs-roots.js depends on it. */
const PATH_UTIL_EXPORTS = ['expandHome', 'normalizePath'];

/**
 * The arity the pinned version must show. 2.x: `validatePath(path, roots)`.
 * The organ passes its roots explicitly at every call site, so an upstream
 * change back to module state (or a third argument) is a reviewed edit here,
 * never a surprise at runtime.
 */
const EXPECTED_VALIDATE_PATH_ARITY = 2;

/** Tool registrations as the package writes them: registerTool("name" / tool("name". */
const TOOL_REGISTRATION = /\.(?:registerTool|tool)\(\s*["']([a-z][a-z0-9_]*)["']/g;

/** Every tool name the installed package registers, from every dist module. */
const upstreamToolNames = () => {
  const names = new Set();
  for (const file of fs.readdirSync(path.join(pkgRoot, 'dist'))) {
    if (!file.endsWith('.js')) continue;
    const source = fs.readFileSync(distPath(file), 'utf8');
    for (const match of source.matchAll(TOOL_REGISTRATION)) names.add(match[1]);
  }
  return names;
};

describe('the pinned filesystem package contract', () => {
  test('the lockfile and the installed copy name the same version', () => {
    expect(lockedFilesystemVersion()).toBe(FILESYSTEM_SERVER_VERSION);
  });

  test('dist/lib.js still exports every name the organ executes', async () => {
    const lib = await import(distUrl('lib.js'));
    for (const name of STABLE_LIB_EXPORTS) {
      expect(typeof lib[name], `${name} must stay an export of dist/lib.js`).toBe('function');
    }
  });

  test('validatePath exists — its roots argument is the version-sensitive part', async () => {
    const lib = await import(distUrl('lib.js'));
    expect(typeof lib.validatePath).toBe('function');
    // 1.x read module-global roots; 2.x takes them as a second argument. The
    // organ supplies its own at every call site.
    expect(lib.validatePath.length).toBe(EXPECTED_VALIDATE_PATH_ARITY);
  });

  test('dist/path-utils.js still exports the normalization helpers', async () => {
    const utils = await import(distUrl('path-utils.js'));
    for (const name of PATH_UTIL_EXPORTS) {
      expect(typeof utils[name], `${name} must stay an export of dist/path-utils.js`).toBe('function');
    }
  });

  test('the catalog serves every tool the package registers', () => {
    const upstream = upstreamToolNames();
    const served = new Set(FILESYSTEM_TOOL_CATALOG.map((entry) => entry.name));
    expect(upstream.size, 'the package registers its tools as registerTool("name"').toBeGreaterThan(0);
    const missing = [...upstream].filter((name) => !served.has(name));
    expect(missing, 'upstream tools the catalog does not serve').toEqual([]);
  });

  test('no catalog entry serves a tool the package never registers, unless it is a native addition', () => {
    const upstream = upstreamToolNames();
    const extras = FILESYSTEM_TOOL_CATALOG
      .map((entry) => entry.name)
      .filter((name) => !upstream.has(name));
    // The organ's own verbs (copy_file, search_content, …) live in the catalog
    // by design; the list is pinned so an upstream rename cannot hide here.
    expect(extras.sort()).toEqual(['copy_file', 'search_content']);
  });
});
