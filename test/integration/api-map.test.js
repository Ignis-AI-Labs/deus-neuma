/**
 * Map API route — proven end to end with a REAL opened folder and a REAL folder
 * scan (RULE 0). Auth is REAL (#390 tranche 4); the realm root, the opened
 * roots, and the architecture scan are all real. We open a real temp folder
 * containing real source, focus it (`?folder=`), and assert GET /api/v1/map
 * returns the graph the scanner extracts. (It drove an active project until
 * Projects was removed, 2026-11-10.)
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import process from 'node:process';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

describe('Map API route', () => {
  let app;
  let projectFolder;
  let witness;

  beforeEach(async () => {
    vi.resetModules();

    // Imported AFTER resetModules — the token must be minted from the same
    // auth.js instance the router will verify against (memoized HMAC secret
    // per module instance; a stale import 401s honestly).
    // No neuma lane on this router; a real session that claims no workspace
    // is exactly the right shape for the witness's own folder map.
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    // The REAL settings module, aimed at a real throwaway file (#390 tranche
    // 3). NEUMA_FILES_SETTINGS_PATH is the module's own isolation door and is
    // read per call, so the persist path runs for real and the operator's
    // live data/settings/user-files.json is never touched.
    process.env.NEUMA_FILES_SETTINGS_PATH = path.join(
      await createTempDir('files-settings'), 'user-files.json');

    const realm = await import('../../backend/services/user-realm.js');
    realm.setRealmRoot(await createTempDir('map-realm'));

    // A real folder with real source, opened in the Explorer: one mounted route + one channel.
    projectFolder = await fs.realpath(await createTempDir('map-project'));
    const files = await import('../../backend/services/user-files.js');
    files.setRoots([projectFolder]);
    await fs.writeFile(path.join(projectFolder, 'server.js'), [
      "import api from './api-routes.js';",
      "app.use('/api/thing', api);",
      "ws.send('desk:ping', {});",
    ].join('\n'));
    await fs.writeFile(path.join(projectFolder, 'api-routes.js'), [
      'const router = express.Router();',
      "router.get('/list', (req, res) => res.json([]));",
      "function h(m) { switch (m.type) { case 'desk:ping': return 1; } }",
      'export default router;',
    ].join('\n'));

    const { default: router } = await import('../../backend/routes/map-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/map', router);
  });

  afterEach(() => vi.restoreAllMocks());

  const mapOf = (query = '') => `/api/v1/map?folder=${encodeURIComponent(projectFolder)}${query}`;

  test('GET /?folder= returns the architecture graph of the focused folder', async () => {
    const res = await request(app).get(mapOf()).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.project).toEqual({ name: path.basename(projectFolder), focus: true });
    const paths = res.body.graph.routes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('GET /api/thing/list');
    const ping = res.body.graph.channels.find((c) => c.name === 'desk:ping');
    expect(ping.producers).toContain('server.js');
    expect(ping.consumers).toContain('api-routes.js');
  });

  test('GET /?findings=1 with no baseline returns the full plan-ready report', async () => {
    const res = await request(app).get(mapOf('&findings=1')).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(Array.isArray(res.body.findings)).toBe(true);
  });

  test('GET /?findings=1 with a committed baseline reports only what is NEW (#391)', async () => {
    // Accept the folder's current state as its baseline — the real artifact,
    // written where the CLI writes it.
    const { scanArchitecture } = await import('../../backend/services/mapview/scan.js');
    const { buildBaseline, BASELINE_RELPATH } = await import('../../backend/services/mapview/delta.js');
    const baselinePath = path.join(projectFolder, BASELINE_RELPATH);
    await fs.mkdir(path.dirname(baselinePath), { recursive: true });
    await fs.writeFile(baselinePath, JSON.stringify(buildBaseline(await scanArchitecture(projectFolder))));

    // Clean check: the delta shape, nothing introduced.
    const clean = await request(app).get(mapOf('&findings=1')).set(witness.header);
    expect(clean.status).toBe(200);
    expect(clean.body.baselined).toBe(true);
    expect(clean.body.introduced).toEqual([]);

    // A fresh defect (an orphan consumer) surfaces as introduced — and ONLY it.
    await fs.writeFile(path.join(projectFolder, 'orphan.js'), [
      "function h(m) { switch (m.type) { case 'desk:never_sent': return 1; } }",
      'export default h;',
    ].join('\n'));
    const dirty = await request(app).get(mapOf('&findings=1')).set(witness.header);
    expect(dirty.body.baselined).toBe(true);
    expect(dirty.body.introduced.some((a) => a.label === 'desk:never_sent')).toBe(true);

    // The whole backlog stays reachable behind ?full=1.
    const full = await request(app).get(mapOf('&findings=1&full=1')).set(witness.header);
    expect(full.body).toHaveProperty('summary');
    expect(Array.isArray(full.body.findings)).toBe(true);
  });

  test('GET / with no folder in focus defaults to the NEUMA repo, flagged as default', async () => {
    const res = await request(app).get('/api/v1/map').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.project).toEqual({ name: 'neuma', default: true });
    // The graph is REALLY this repo's: a route only the neuma backend mounts.
    expect(res.body.graph.routes.some((r) => r.path.startsWith('/api/v1/map'))).toBe(true);
  }, 120000);

  test('GET /?folder= is 403 once the focused folder no longer exists — never an existence oracle', async () => {
    await fs.rm(projectFolder, { recursive: true, force: true });
    const res = await request(app).get(mapOf()).set(witness.header);
    expect(res.status).toBe(403);
  });
});
