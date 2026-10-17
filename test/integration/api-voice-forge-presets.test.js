import express from 'express';
import request from 'supertest';

/**
 * Integration tests for GET /api/v1/voice/forge/presets (FR-2).
 *
 * The real router, the real catalog, the real frozen registry view, and REAL
 * auth (#390 tranche 4): a witness carries a real HMAC session token through
 * the real requireAuth. Asserts the built manifest content over the wire:
 * expresso ids absent (build-time exclusion), badges exact, and no
 * path-shaped strings anywhere in the body. The 401 case needs no dedicated
 * re-mock dance anymore — auth is real everywhere in this file, so simply
 * sending no Authorization header against the same app IS the real 401.
 */

const buildApp = async () => {
  const { default: router } = await import('../../backend/routes/voice-forge-routes.js');
  const app = express();
  app.use('/api/v1/voice/forge', router);
  return app;
};

describe('GET /api/v1/voice/forge/presets', () => {
  let app, body, witness;

  beforeEach(async () => {
    vi.resetModules();
    // Imported AFTER resetModules so the witness mints its token from the
    // same auth.js instance the router will verify against — the token
    // secret is memoized per module instance, so a stale import would 401.
    // No neuma lane on this route; a real wallet with a real session that
    // claims no workspace is exactly the right shape.
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    app = await buildApp();
    const res = await request(app).get('/api/v1/voice/forge/presets').set(witness.header);
    expect(res.status).toBe(200);
    body = res.body;
  });

  test('serves the built manifest: 62 presets (Kokoro 54 + 8 CC0 donations)', () => {
    expect(Array.isArray(body.presets)).toBe(true);
    expect(body.presets).toHaveLength(62);
    expect(body.presets.filter((p) => p.engine === 'kokoro')).toHaveLength(54);
    expect(body.presets.filter((p) => p.engine === 'kyutai')).toHaveLength(8);
  });

  test('license badges are exact and resolved off the registry view', () => {
    for (const p of body.presets.filter((x) => x.engine === 'kokoro')) {
      expect(p.license).toBe('Apache-2.0');
      expect(p.engineName).toBe('Kokoro-82M');
    }
    for (const p of body.presets.filter((x) => x.engine === 'kyutai')) {
      expect(p.license).toBe('CC0');
      expect(p.id.startsWith('voice-donations/')).toBe(true);
    }
  });

  test('expresso ids are absent from the served body', () => {
    expect(JSON.stringify(body)).not.toContain('expresso');
  });

  test('every preset is ids + display names + engine + license badge ONLY', () => {
    for (const p of body.presets) {
      expect(Object.keys(p).sort()).toEqual(['engine', 'engineName', 'id', 'license', 'name']);
    }
  });

  test('no path-shaped strings anywhere in the body', () => {
    const walk = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(walk) : v && typeof v === 'object' ? Object.values(v).flatMap(walk) : []);
    for (const s of walk(body)) {
      expect(s).not.toContain('..');
      expect(s.startsWith('/')).toBe(false);
      expect(s).not.toContain('\\');
      expect(s).not.toContain('voice-engines/');
      expect(s).not.toContain('_models');
      expect(s).not.toContain('workspaces/');
    }
  });

  test('401 without a session token (REAL auth — no passthrough)', async () => {
    const res = await request(app).get('/api/v1/voice/forge/presets');
    expect(res.status).toBe(401);
  });
});
