/**
 * Legacy NeumaDatabase decommission — REAL router on a REAL Express app
 * over a real HTTP socket (RULE 0; the old suite for these routes was a
 * vi.doMock relic and died with them).
 *
 * The 2026-07-04 isolation audit found the name-keyed legacy store live at
 * /api/v1 with auth but no ownership gate: any authenticated wallet could
 * read/overwrite any companion's DNA, memories, and conversations by
 * naming it. Every endpoint must now answer 410 with the frozen tombstone
 * body pointing at the sovereign workspace routes — loud, never silent.
 */

import { createServer } from 'http';
import express from 'express';
import neumaDatabaseRoutes from '../../backend/routes/neuma-database-routes.js';

const LEGACY_ENDPOINTS = [
  ['post', '/neuma/Fenna/dna'],
  ['get', '/neuma/Fenna/dna'],
  ['post', '/neuma/Fenna/memory'],
  ['get', '/neuma/Fenna/memories'],
  ['post', '/neuma/Fenna/conversation'],
  ['get', '/neuma/Fenna/conversations'],
  ['get', '/neuma/registry'],
  ['post', '/neuma/registry'],
  ['post', '/neuma/Fenna/vessel'],
  ['get', '/neuma/Fenna/vessel'],
  ['get', '/neuma/Fenna/export'],
  ['post', '/neuma/import'],
  ['get', '/neuma/Fenna/stats'],
];

describe('legacy NeumaDatabase routes are decommissioned (real HTTP)', () => {
  let server, base;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1', neumaDatabaseRoutes);
    server = createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://localhost:${server.address().port}/api/v1`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test.each(LEGACY_ENDPOINTS)('%s %s answers 410 with the tombstone body', async (method, route) => {
    const res = await fetch(`${base}${route}`, {
      method: method.toUpperCase(),
      headers: { 'content-type': 'application/json' },
      body: method === 'post' ? JSON.stringify({ any: 'payload' }) : undefined,
    });
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toContain('decommissioned');
    expect(body.error).toContain('/api/v1/workspace/:id/');
  });

  test('the legacy store module is gone from the core barrel', async () => {
    const core = await import('../../core/index.js');
    expect(core.neumaDatabase).toBeUndefined();
  });
});
