import express from 'express';
import request from 'supertest';
import { promises as fs } from 'node:fs';
import healthRouter from '../../backend/routes/health-routes.js';
import { createSessionToken } from '../../backend/services/auth.js';

/**
 * Integration tests for health API routes — real modules end to end (#156).
 *
 * Nothing here is mocked (RULE 0): the real router runs the real workspace
 * write probe, real storage assessment, real MCP/LLM checks, and the real
 * requireAuth HMAC verification. Auth is exercised with a token minted by the
 * real createSessionToken — mint and verify share the process-memoized
 * secret, so the round trip is the production path. Component verdicts that
 * depend on the machine (LLM reachability, MCP servers, disk headroom) are
 * asserted against the route's CONTRACT (allowed enums, status-code mapping),
 * never this box's state.
 *
 * Known coverage gaps, stated rather than faked: the workspace-unwritable
 * 503 branch and a forced LLM-degraded verdict cannot be produced for real —
 * the probe path is fixed inside the route and the LLM endpoint is global
 * config. The previous suites reached them by stubbing fs.writeFile and
 * llm-provider at exactly the boundary under claim, which RULE 0 forbids.
 * Testing those branches for real needs a probe-path seam in the route.
 */
describe('Health API routes', () => {
  let app;

  beforeAll(async () => {
    // The route's write probe targets <repo>/workspaces — guaranteed on any
    // booted box (workspace creation mkdirs it) but absent in a fresh
    // checkout. Ensure the same precondition boot provides; the probe write
    // itself stays fully real.
    await fs.mkdir(new URL('../../workspaces/', import.meta.url), { recursive: true });
    app = express();
    app.use('/api/v1/health', healthRouter);
  });

  describe('GET /api/v1/health (public liveness)', () => {
    test('returns 200 healthy after a real workspace write probe — no token sent', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      // Public shape: components carries the bare status string
      expect(res.body.components).toEqual({ workspace: 'healthy' });
      expect(Number.isFinite(Date.parse(res.body.timestamp))).toBe(true);
      expect(res.body.pipeline).toBeNull();
    });

    test('reports the active pipeline lane without exposing runtime paths', async () => {
      const keys = ['NEUMA_PIPELINE_ID', 'NEUMA_PIPELINE_KIND', 'NEUMA_PORT'];
      const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
      Object.assign(process.env, {
        NEUMA_PIPELINE_ID: 'sol:real-health-proof',
        NEUMA_PIPELINE_KIND: 'sol',
        NEUMA_PORT: '47740',
      });
      try {
        const res = await request(app).get('/api/v1/health');
        expect(res.status).toBe(200);
        expect(res.body.pipeline).toEqual({
          id: 'sol:real-health-proof',
          kind: 'sol',
          ports: { start: 47740, end: 47749 },
        });
        expect(JSON.stringify(res.body.pipeline)).not.toContain('root');
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });
  });

  describe('GET /api/v1/health/detailed (auth-required)', () => {
    test('returns 401 without a token — real requireAuth', async () => {
      const res = await request(app).get('/api/v1/health/detailed');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication required');
    });

    test('returns 401 for a structurally valid token with a forged HMAC', async () => {
      const real = Buffer.from(createSessionToken('0xtest'), 'base64').toString();
      // Flip the final hex digit of the HMAC — well-formed token, wrong signature
      const forged = Buffer.from(
        real.replace(/.$/, (c) => (c === '0' ? '1' : '0')),
      ).toString('base64');

      const res = await request(app)
        .get('/api/v1/health/detailed')
        .set('Authorization', `Bearer ${forged}`);

      expect(res.status).toBe(401);
    });

    test('returns per-component status + process stats for a real minted token', async () => {
      const token = createSessionToken('0xtest');
      const res = await request(app)
        .get('/api/v1/health/detailed')
        .set('Authorization', `Bearer ${token}`);

      // Contract: the HTTP code mirrors the overall verdict — 503 only when unhealthy
      expect(res.status).toBe(res.body.status === 'unhealthy' ? 503 : 200);
      expect(['healthy', 'degraded', 'unhealthy']).toContain(res.body.status);

      const { workspace, llm, mcp, storage } = res.body.components;
      // The write probe ran for real against workspaces/
      expect(workspace.status).toBe('healthy');
      // LLM/MCP are non-critical: never worse than degraded, verdict is box-dependent
      expect(['healthy', 'degraded']).toContain(llm.status);
      expect(['healthy', 'degraded']).toContain(mcp.status);
      expect(typeof mcp.servers).toBe('number');
      // Real disk assessment: status derives from the birth-preflight level
      expect(['healthy', 'degraded', 'unhealthy']).toContain(storage.status);
      expect(typeof storage.level).toBe('string');

      expect(res.body.process.heapUsedMB).toBeGreaterThan(0);
      expect(res.body.process.heapTotalMB).toBeGreaterThan(0);
      expect(res.body.process.rssMB).toBeGreaterThan(0);
      expect(res.body.process.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(res.body.uptime).toBeGreaterThan(0);
      expect(Number.isFinite(Date.parse(res.body.timestamp))).toBe(true);
    });
  });
});
