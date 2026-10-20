import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  clearAttackSurfaceCache,
  dependencyPathsFor,
  mapThreatAttackSurface,
  readArchitectureSurface,
  routeProtection,
  selectWatchedRepo,
} from '../../backend/services/security/attack-surface.js';

const LOCK = Object.freeze({
  name: 'surface-fixture',
  version: '1.0.0',
  lockfileVersion: 3,
  packages: {
    '': {
      name: 'surface-fixture',
      version: '1.0.0',
      dependencies: { 'app-builder-lib': '1.0.0', express: '5.1.0' },
    },
    'node_modules/app-builder-lib': {
      version: '1.0.0',
      dependencies: { tar: '6.2.1' },
    },
    'node_modules/app-builder-lib/node_modules/tar': { version: '6.2.1' },
    'node_modules/express': { version: '5.1.0' },
  },
});

const writeFixtureRepo = async (root) => {
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.mkdir(path.join(root, 'backend', 'routes'), { recursive: true });
  await fs.mkdir(path.join(root, 'backend', 'services'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'surface-fixture',
    version: '1.0.0',
    type: 'module',
    dependencies: { 'app-builder-lib': '1.0.0', express: '5.1.0' },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(root, 'package-lock.json'), `${JSON.stringify(LOCK, null, 2)}\n`);
  await fs.writeFile(path.join(root, 'backend', 'server.js'), [
    "import express from 'express';",
    "import archiveRouter from './routes/archive-routes.js';",
    'const app = express();',
    "app.use('/api/v1/archive', archiveRouter);",
    'export default app;',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(root, 'backend', 'routes', 'archive-routes.js'), [
    "import express from 'express';",
    "import { requireAuth } from '../auth.js';",
    "import { extractArchive } from '../services/archive-extractor.js';",
    'const router = express.Router();',
    "router.get('/health', (_req, res) => res.json({ ok: true }));",
    'router.use(requireAuth);',
    "router.post('/extract', extractArchive);",
    'export default router;',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(root, 'backend', 'services', 'archive-extractor.js'), [
    "import { Platform } from 'app-builder-lib';",
    'export const extractArchive = (_req, res) => res.json({ platform: Platform.LINUX });',
    '',
  ].join('\n'));
};

describe('security attack-surface mapping (real filesystem + real architecture compiler)', () => {
  let repo;

  beforeAll(async () => {
    repo = await createTempDir('security-attack-surface');
    await writeFixtureRepo(repo);
  });

  afterAll(async () => {
    clearAttackSurfaceCache();
    await fs.rm(repo, { recursive: true, force: true });
  });

  test('resolves the installed transitive package chain exactly', () => {
    const result = dependencyPathsFor(LOCK, 'tar', '6.2.1');
    expect(result.installed).toEqual([{
      key: 'node_modules/app-builder-lib/node_modules/tar',
      version: '6.2.1',
      reachableFromRoot: true,
    }]);
    expect(result.roots).toEqual([{ name: 'app-builder-lib', version: '1.0.0', kind: 'runtime' }]);
    expect(result.paths[0].map((entry) => entry.name)).toEqual(['app-builder-lib', 'tar']);
  });

  test('router auth evidence applies only to routes declared after the gate', () => {
    const middleware = [{ name: 'requireAuth', sites: [{ file: 'routes.js', line: 20, scope: 'router' }] }];
    expect(routeProtection({ file: 'routes.js', line: 10 }, middleware)).toBe('public_or_unverified');
    expect(routeProtection({ file: 'routes.js', line: 30 }, middleware)).toBe('authenticated');
  });

  test('maps a real software finding from package-lock through imports to reachable routes', async () => {
    const surface = await readArchitectureSurface(repo);
    expect(surface.packageImports).toContainEqual({
      name: 'app-builder-lib',
      kind: 'runtime',
      files: ['backend/services/archive-extractor.js'],
    });
    expect(surface.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/api/v1/archive/health', protection: 'public_or_unverified' }),
      expect.objectContaining({ path: '/api/v1/archive/extract', protection: 'authenticated' }),
    ]));

    const mapped = await mapThreatAttackSurface({
      id: 'th_fixture',
      layer: 'software',
      source: 'osv',
      repo: path.basename(repo),
      externalId: 'GHSA-fixture-tar',
      title: 'fixture tar advisory',
      affected: [{ package: 'tar', version: '6.2.1' }],
    }, repo);

    expect(mapped.contexts).toHaveLength(1);
    expect(mapped.contexts[0].dependency.paths[0].map((entry) => entry.name))
      .toEqual(['app-builder-lib', 'tar']);
    expect(mapped.contexts[0].importedBy).toEqual([{
      package: 'app-builder-lib',
      kind: 'runtime',
      file: 'backend/services/archive-extractor.js',
    }]);
    expect(mapped.contexts[0].routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/api/v1/archive/health', protection: 'public_or_unverified' }),
      expect.objectContaining({ path: '/api/v1/archive/extract', protection: 'authenticated' }),
    ]));
    expect(mapped.contexts[0].exposure).toBe('loopback_route_candidate');
    expect(mapped.contexts[0].confidence).toBe('static_evidence');
  }, 30000);

  test("the app's own watch entry resolves to where the app runs now, never a stale mount path", () => {
    const watch = { repos: [
      { id: 'neuma', path: '/tmp/.mount_NEUMA-old/resources/app', app: true },
      { id: 'mine', path: '/srv/mine' },
    ] };
    const installed = { appRoot: '/tmp/.mount_NEUMA-new/resources/app', resourcesPath: '/tmp/.mount_NEUMA-new/resources' };
    expect(selectWatchedRepo(watch, 'neuma', '/', installed).path).toBe(installed.appRoot);
    expect(selectWatchedRepo(watch, 'mine', '/', installed).path).toBe('/srv/mine');
  });
});
