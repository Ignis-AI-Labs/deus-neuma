/**
 * #240 UX-012 — the STANDBY switch must ask a path that exists.
 *
 * The desk asked `/api/v1/llm/substrate/standby`; the route is mounted at
 * `/api/v1/substrate/standby`. Every call 404'd, `getStandby`'s catch turned
 * that into `null`, and `null` means "cannot confirm" — so the control drew
 * nothing. A switch Founder asked for on 2026-07-26 never rendered once, and
 * standby stayed silently on at 15 minutes.
 *
 * A test that merely compares two string literals would have passed the whole
 * time it was broken, because both literals would have been wrong together.
 * So BOTH ends come from real source here: the path from the frontend client
 * module, the mount prefix parsed out of `backend/server.js`. Then a real
 * Express app serves the real router and a real request is made. If either end
 * moves, this goes red.
 *
 * Real Express, real listen, real session token. No mocks (RULE 0).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import substrateRouter from '../../backend/routes/substrate-routes.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { BASE } from '../../frontend/services/standby.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The prefix the server actually mounts the substrate router at — read from
 * the file rather than restated, so a move in the mount surface is caught
 * here. The mount block lives in backend/routes/route-mounts.js since the
 * 2026-08-26 size-law extraction (SIZE-019 #366).
 * @returns {string}
 */
const mountedPrefix = () => {
  const src = readFileSync(path.join(repo, 'backend/routes/route-mounts.js'), 'utf8');
  const m = src.match(/app\.use\(\s*['"]([^'"]+)['"]\s*,\s*substrateRouter\s*\)/);
  if (!m) throw new Error('substrateRouter mount not found in backend/routes/route-mounts.js');
  return m[1];
};

let server = null;
let port = 0;
let token = '';

beforeAll(async () => {
  token = createSessionToken('0x1111111111111111111111111111111111111111');
  const app = express();
  app.use(express.json());
  app.use(mountedPrefix(), substrateRouter); // mounted exactly as the server does
  await new Promise((res) => { server = app.listen(0, res); });
  port = server.address().port;
});

afterAll(() => new Promise((res) => (server ? server.close(res) : res())));

const hit = (method = 'GET', body) =>
  fetch(`http://localhost:${port}${BASE}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

describe('#240 — the path the desk asks is the path the server answers', () => {
  it('GET reaches the route instead of 404ing', async () => {
    const res = await hit('GET');
    // The precise assertion: NOT 404. A 404 is the bug — the desk asking a
    // path nothing serves. Any other status means the request found the route.
    expect(res.status).not.toBe(404);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('enabled');
    expect(typeof body.enabled).toBe('boolean');
  });

  it('PUT reaches the route, and its validation answers — proof it is the real handler', async () => {
    // A 400 with the route's OWN words can only come from the route itself; a
    // missing mount would give an Express 404 HTML body instead.
    const res = await hit('PUT', { enabled: 'yes-please' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/enabled must be true or false/);
  });

  it('the client path is the mounted prefix plus /standby — not the llm router', () => {
    expect(BASE).toBe(`${mountedPrefix()}/standby`);
    // The specific wrong path this issue was filed for, pinned so it cannot return.
    expect(BASE).not.toBe('/api/v1/llm/substrate/standby');
  });
});
