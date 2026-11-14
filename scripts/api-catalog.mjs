#!/usr/bin/env node
// Write docs/reference/API-ROUTES.md from the real routers (route-catalog.js).
//
//   node scripts/api-catalog.mjs           write the page
//   node scripts/api-catalog.mjs --check   exit 1 when the page is out of date
//
// Importing the routers loads the backend's services, so every store root is
// pointed at a throwaway folder first: making the catalog never touches the
// operator's data.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CATALOG_PAGE = path.join(repo, 'docs', 'reference', 'API-ROUTES.md');

const scratch = await fs.mkdtemp(path.join(process.env.NEUMA_SCRATCH_DIR || '/var/tmp', 'neuma-api-catalog-'));
try {
  for (const [key, dir] of Object.entries({
    WORKSPACES_ROOT: 'workspaces', WITNESSES_ROOT: 'witnesses', AI_WITNESSES_ROOT: 'ai-witnesses',
    NEUMA_DATA_ROOT: 'data', NEUMA_REALM_ROOT: 'realm', NEUMA_VAULT_ROOT: 'vault', NEUMA_BACKUPS_ROOT: 'backups',
  })) process.env[key] = path.join(scratch, dir);
  process.env.NEUMA_ROOT_LOCK_PATH = path.join(scratch, 'root-lock.json');
  process.env.PLATFORM_DB_PATH = path.join(scratch, 'platform.db');
  process.env.LOG_LEVEL = 'error';

  const { mountApiRoutes } = await import('../backend/routes/route-mounts.js');
  const { catalogRoutes, catalogMarkdown } = await import('../backend/routes/route-catalog.js');
  const { requireAuth } = await import('../backend/services/auth.js');
  const { requireInstallOwner } = await import('../backend/services/install-owner.js');
  const page = catalogMarkdown(catalogRoutes(mountApiRoutes, new Map([[requireAuth, 'requireAuth'], [requireInstallOwner, 'requireInstallOwner']])));

  if (process.argv.includes('--check')) {
    const standing = await fs.readFile(CATALOG_PAGE, 'utf8').catch(() => '');
    if (standing !== page) {
      process.stderr.write('docs/reference/API-ROUTES.md is out of date — run: node scripts/api-catalog.mjs\n');
      process.exitCode = 1;
    } else process.stdout.write('API-ROUTES.md matches the routers\n');
  } else {
    await fs.writeFile(CATALOG_PAGE, page);
    process.stdout.write(`wrote ${path.relative(repo, CATALOG_PAGE)}\n`);
  }
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
// The routers' services hold timers and handles open; the work is done.
process.exit(process.exitCode ?? 0);
