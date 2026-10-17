/**
 * Voice engine route id-validation (security) — NO MOCKS (#390 tranche 6).
 *
 * The engine id reaches BOTH a filesystem path (the download log) and a
 * SPAWNED PROCESS ARG, so it must be slug-validated before any handler runs.
 * That is the whole claim of this file — and it used to be made against a
 * mocked engine-manager and a mocked registry. Mocking the very thing the id
 * would have reached is the one place a stub is least defensible: with
 * `launch` and the registry stubbed, a guard that had stopped working could
 * not be told apart from one that still worked.
 *
 * Now the real router runs against the real registry and the real engine
 * manager, and the refusals are proven by CONSEQUENCE — no download log file
 * appears on disk for a rejected id, and the real download-status route still
 * answers `idle`. If the guard ever regresses, this test spawns a real
 * downloader and says so, which is exactly the alarm it exists to be.
 *
 * Nothing here launches a sidecar: `/local/:id` is a status read,
 * `/local/:id/health` is an HTTP probe that fails honestly when nothing is
 * listening, and the only spawning route is reached solely with ids the guard
 * refuses. Real synthesis lives behind RUN_GPU_ENGINE_TESTS=1.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { strangerWitness } from '../helpers/witness.js';
import router from '../../backend/routes/voice-engine-routes.js';
import { listLocalEngines } from '../../backend/services/voice/engine-registry.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOG_DIR = path.join(REPO_ROOT, 'voice-engines', '_logs');

const ILLEGAL_IDS = [
  'bad.id',              // a dot — adapter ids and engine ids both refuse it
  'evil$(whoami)',       // command substitution
  '../../etc/passwd',    // traversal
  'a b',                 // whitespace
  'engine;rm -rf /',     // separator
];

let app, witness;

/** Log files present for an id — the trace a spawned downloader would leave. */
const logsFor = (fragment) => (existsSync(LOG_DIR)
  ? readdirSync(LOG_DIR).filter((name) => name.includes(fragment))
  : []);

beforeAll(() => {
  // These routes carry no neuma lane at all, so a real wallet with a real
  // session that claims no workspace is exactly the right shape.
  witness = strangerWitness();
  app = express();
  app.use(express.json());
  app.use('/api/v1/voice/engines', router);
});

describe('the id guard', () => {
  it('refuses every illegal id on the health route (400)', async () => {
    for (const id of ILLEGAL_IDS) {
      const res = await request(app)
        .get(`/api/v1/voice/engines/local/${encodeURIComponent(id)}/health`)
        .set(witness.header);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid engine id/i);
    }
  });

  it('refuses an illegal id on the DOWNLOAD route, and nothing is spawned', async () => {
    // The route that actually spawns. Proven by consequence rather than by a
    // stub reporting it was not called: no log file lands, and the real
    // status route still reads idle. A guard regression would leave both.
    const marker = 'whoami';
    expect(logsFor(marker)).toEqual([]);

    const res = await request(app)
      .post(`/api/v1/voice/engines/local/${encodeURIComponent('evil$(whoami)')}/download`)
      .set(witness.header);
    expect(res.status).toBe(400);

    expect(logsFor(marker)).toEqual([]);
    const status = await request(app)
      .get(`/api/v1/voice/engines/local/${encodeURIComponent('evil$(whoami)')}/download/status`)
      .set(witness.header);
    // The guard refuses the status read too; either way no download exists.
    expect([200, 400]).toContain(status.status);
    if (status.status === 200) expect(status.body.state).toBe('idle');
  });

  it('a valid slug passes the guard — an unknown engine is 404, never 400', async () => {
    const res = await request(app)
      .get('/api/v1/voice/engines/local/definitely-not-an-engine').set(witness.header);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown local engine');
  });
});

describe('the real registry answers', () => {
  it('a REGISTERED engine is described, not 404', async () => {
    // Read the id off the real registry rather than hardcoding one — a
    // renamed or retired engine then shows up as a real failure here instead
    // of this test quietly asserting against a name nobody ships.
    const engines = listLocalEngines();
    expect(engines.length).toBeGreaterThan(0);

    const res = await request(app)
      .get(`/api/v1/voice/engines/local/${engines[0].id}`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.engineId).toBe(engines[0].id);
    expect(res.body.state).toBe('stopped'); // nothing launched in this lane
    expect(res.body.port).toBe(engines[0].serve.port);
    expect(typeof res.body.downloaded).toBe('boolean');
    expect(res.body).toHaveProperty('readiness');
  });

  it('health on a registered engine reports honestly that nothing is listening', async () => {
    // No sidecar is up in this lane, and the real probe says so. A stubbed
    // healthCheck returning {ok:false} proved only that a stub returns false.
    const engines = listLocalEngines();
    const res = await request(app)
      .get(`/api/v1/voice/engines/local/${engines[0].id}/health`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });
});

describe('authentication', () => {
  it('no session is a real 401', async () => {
    const res = await request(app).get('/api/v1/voice/engines/local/bad.id/health');
    expect(res.status).toBe(401);
  });

  it('a garbage bearer token is a real 401 — refused before the id guard', async () => {
    const res = await request(app)
      .post('/api/v1/voice/engines/local/evil$(whoami)/download')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});
