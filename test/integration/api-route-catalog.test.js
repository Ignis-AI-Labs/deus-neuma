/**
 * The route catalog (RULE 0: the real routers, real HTTP requests).
 *
 * Two things are proven. The committed page is exactly what the code says
 * today, so it cannot drift. And the Guards column is TRUE: every endpoint it
 * lists behind `requireAuth` is sent a real request with no credentials and
 * must answer 401 — a catalog that claimed a guard the server does not run
 * would be worse than no catalog.
 */
import fs from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import { describe, expect, test, beforeAll } from 'vitest';
import { mountApiRoutes } from '../../backend/routes/route-mounts.js';
import { catalogRoutes, catalogMarkdown, walkRouter } from '../../backend/routes/route-catalog.js';
import { requireAuth } from '../../backend/services/auth.js';
import { requireInstallOwner } from '../../backend/services/install-owner.js';

const PAGE = new URL('../../docs/reference/API-ROUTES.md', import.meta.url);
const KNOWN = new Map([[requireAuth, 'requireAuth'], [requireInstallOwner, 'requireInstallOwner']]);

let routes;
beforeAll(() => {
  routes = catalogRoutes(mountApiRoutes, KNOWN);
});

describe('the walker, on routers made here', () => {
  test('mount paths, nested routers, params, route guards and router-level guards are all read', () => {
    const guard = (req, res, next) => next();
    const inner = express.Router();
    inner.get('/leaf/:id', (req, res) => res.end());
    const outer = express.Router();
    outer.get('/open', (req, res) => res.end());
    outer.use(guard);
    outer.post('/closed', guard, (req, res) => res.end());
    outer.use('/inner/:team', inner);
    expect(walkRouter(outer, '/api/x', [], new Map())).toEqual([
      { method: 'GET', path: '/api/x/open', guards: [] },
      { method: 'POST', path: '/api/x/closed', guards: ['guard', 'guard'] },
      { method: 'GET', path: '/api/x/inner/:team/leaf/:id', guards: ['guard'] },
    ]);
  });

  test('a router-level guard also stands in front of what is mounted after it under the same prefix', () => {
    const blanket = express.Router();
    blanket.use(function gate(req, res, next) { next(); });
    blanket.get('/mine', (req, res) => res.end());
    const later = express.Router();
    later.get('/theirs', (req, res) => res.end());
    const found = catalogRoutes((app) => {
      app.get('/api/before', (req, res) => res.end());
      app.use('/api', blanket);
      app.use('/api/later', later);
      app.get('/elsewhere', (req, res) => res.end());
    });
    expect(found).toEqual([
      { method: 'GET', path: '/api/before', guards: [] },
      { method: 'GET', path: '/api/later/theirs', guards: ['gate'] },
      { method: 'GET', path: '/api/mine', guards: ['gate'] },
      { method: 'GET', path: '/elsewhere', guards: [] },
    ]);
  });
});

describe('the catalog of the real backend', () => {
  test('the committed page is exactly what the routers say today', async () => {
    const standing = await fs.readFile(PAGE, 'utf8');
    expect(standing, 'run: node scripts/api-catalog.mjs').toBe(catalogMarkdown(routes));
  });

  test('it is whole: hundreds of endpoints, the public doors among them, no unreadable paths', () => {
    expect(routes.length).toBeGreaterThan(500);
    const keys = new Set(routes.map((r) => `${r.method} ${r.path}`));
    for (const door of ['GET /api/v1/auth/challenge', 'POST /api/v1/auth/verify', 'GET /api/v1/health', 'POST /api/v1/mcp/connect']) {
      expect(keys.has(door), door).toBe(true);
    }
    // Plain segments and Express parameters (`:name`, `:name(a|b)`) only — no regex leftovers.
    for (const r of routes) expect(r.path, r.path).toMatch(/^(\/(?:[A-Za-z0-9_.*-]+|:[A-Za-z0-9_]+(?:\([A-Za-z0-9_|]+\))?)?)+$/);
  });

  test('every endpoint listed behind requireAuth refuses a request with no credentials', async () => {
    const app = express();
    mountApiRoutes(app);
    const guarded = routes.filter((r) => r.guards.includes('requireAuth') && r.method !== 'ALL');
    expect(guarded.length).toBeGreaterThan(400);
    let asked = 0;
    const wrong = [];
    for (const r of guarded) {
      const url = r.path.replace(/:[A-Za-z0-9_]+/g, 'catalog-probe').replace(/\*/g, 'x');
      const res = await request(app)[r.method.toLowerCase()](url);
      asked += 1;
      if (res.status !== 401) wrong.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
    expect(asked).toBe(guarded.length);
  }, 120_000);

  test('the sign-in doors are listed without requireAuth, and they really answer without credentials', async () => {
    const app = express();
    mountApiRoutes(app);
    const challenge = routes.find((r) => r.method === 'GET' && r.path === '/api/v1/auth/challenge');
    expect(challenge.guards).not.toContain('requireAuth');
    const health = routes.find((r) => r.method === 'GET' && r.path === '/api/v1/health');
    expect(health.guards).not.toContain('requireAuth');
    expect((await request(app).get('/api/v1/health')).status).not.toBe(401);
  });
});
