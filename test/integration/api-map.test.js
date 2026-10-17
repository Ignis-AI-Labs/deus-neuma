/**
 * Map API route — proven end to end with a REAL project store and a REAL folder
 * scan (RULE 0). Auth is REAL (#390 tranche 4); the realm root, the projects
 * service, and the architecture scan are all real. We create a real project
 * pointing at a real temp folder containing real source, activate it, and
 * assert GET /api/v1/map returns the graph the scanner extracts.
 */
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
    // is exactly the right shape for the witness's own project map.
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
    const files = await import('../../backend/services/user-files.js');
    files.setRoots([]);

    // A real project folder with real source: one mounted route + one channel.
    projectFolder = await createTempDir('map-project');
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

    const { createProject, setActiveProject } = await import('../../backend/services/user-projects.js');
    const project = await createProject(witness.address, { name: 'mapped', folder: projectFolder });
    await setActiveProject(witness.address, project.id);

    const { default: router } = await import('../../backend/routes/map-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/map', router);
  });

  afterEach(() => vi.restoreAllMocks());

  test('GET / returns the architecture graph of the active project', async () => {
    const res = await request(app).get('/api/v1/map').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.project.name).toBe('mapped');
    const paths = res.body.graph.routes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('GET /api/thing/list');
    const ping = res.body.graph.channels.find((c) => c.name === 'desk:ping');
    expect(ping.producers).toContain('server.js');
    expect(ping.consumers).toContain('api-routes.js');
  });

  test('GET /?findings=1 with no baseline returns the full plan-ready report', async () => {
    const res = await request(app).get('/api/v1/map?findings=1').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(Array.isArray(res.body.findings)).toBe(true);
  });

  test('GET /?findings=1 with a committed baseline reports only what is NEW (#391)', async () => {
    // Accept the project's current state as its baseline — the real artifact,
    // written where the CLI writes it.
    const { scanArchitecture } = await import('../../backend/services/mapview/scan.js');
    const { buildBaseline, BASELINE_RELPATH } = await import('../../backend/services/mapview/delta.js');
    const baselinePath = path.join(projectFolder, BASELINE_RELPATH);
    await fs.mkdir(path.dirname(baselinePath), { recursive: true });
    await fs.writeFile(baselinePath, JSON.stringify(buildBaseline(await scanArchitecture(projectFolder))));

    // Clean check: the delta shape, nothing introduced.
    const clean = await request(app).get('/api/v1/map?findings=1').set(witness.header);
    expect(clean.status).toBe(200);
    expect(clean.body.baselined).toBe(true);
    expect(clean.body.introduced).toEqual([]);

    // A fresh defect (an orphan consumer) surfaces as introduced — and ONLY it.
    await fs.writeFile(path.join(projectFolder, 'orphan.js'), [
      "function h(m) { switch (m.type) { case 'desk:never_sent': return 1; } }",
      'export default h;',
    ].join('\n'));
    const dirty = await request(app).get('/api/v1/map?findings=1').set(witness.header);
    expect(dirty.body.baselined).toBe(true);
    expect(dirty.body.introduced.some((a) => a.label === 'desk:never_sent')).toBe(true);

    // The whole backlog stays reachable behind ?full=1.
    const full = await request(app).get('/api/v1/map?findings=1&full=1').set(witness.header);
    expect(full.body).toHaveProperty('summary');
    expect(Array.isArray(full.body.findings)).toBe(true);
  });

  test('GET / with no active project defaults to the NEUMA repo, flagged as default', async () => {
    const { setActiveProject } = await import('../../backend/services/user-projects.js');
    await setActiveProject(witness.address, null);
    const res = await request(app).get('/api/v1/map').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.project).toEqual({ name: 'neuma', default: true });
    // The graph is REALLY this repo's: a route only the neuma backend mounts.
    expect(res.body.graph.routes.some((r) => r.path.startsWith('/api/v1/map'))).toBe(true);
  }, 120000);

  test('GET / is 422 when the active project folder no longer exists', async () => {
    await fs.rm(projectFolder, { recursive: true, force: true });
    const res = await request(app).get('/api/v1/map').set(witness.header);
    expect(res.status).toBe(422);
  });
});
