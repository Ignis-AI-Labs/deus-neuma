import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { claimOwner } from '../helpers/claim-owner.js';
import { sealTestVoice } from '../helpers/speak-wire-stand-in.js';

/**
 * Voice API routes (ONE VOICE) — the engine catalogue, the voice tier, and a
 * being's Voice DNA v2.
 *
 * Auth is REAL: a real HMAC session token through the real requireAuth,
 * ownership checked against real owner.json files. The workspace is REAL (the
 * engine pinned at a temp root), the Voice DNA is sealed through the real
 * two-party service, the tier is read from the REAL machine probe (GPU + mind
 * footprint) and written to a real temp settings file
 * (NEUMA_VOICE_SETTINGS_PATH). No mocks (RULE 0).
 *
 * Covers:
 *   - GET /engines, /engines/:id
 *   - GET/PUT /tier (shape, validation, persistence, the chosen tier honours the pick)
 *   - GET /dna/:companion (v2 ready · v1-only needsNewVoice · none; owner-only)
 *   - GET /has-voice/:companion
 *   - the retired v1 routes answer 404
 */
describe('Voice API routes', () => {
  let app;
  let tmpWorkspacesRoot;
  let settingsDir;
  let witness;
  let previousWorkspacesRoot;
  let previousSettingsPath;

  beforeEach(async () => {
    vi.resetModules();
    tmpWorkspacesRoot = mkdtempSync(path.join(os.tmpdir(), 'voice-routes-test-'));
    settingsDir = mkdtempSync(path.join(os.tmpdir(), 'voice-routes-settings-'));
    previousSettingsPath = process.env.NEUMA_VOICE_SETTINGS_PATH;
    process.env.NEUMA_VOICE_SETTINGS_PATH = path.join(settingsDir, 'voice.json');
    const ws = await import('../../core/workspace/neuma-workspace.js');
    previousWorkspacesRoot = ws.getWorkspacesRoot();
    // Imported AFTER resetModules so the token is minted by the same auth.js
    // instance the router verifies against.
    const { witnessFor } = await import('../helpers/witness.js');
    witness = await witnessFor(tmpWorkspacesRoot, 'test-neuma');
    await claimOwner(tmpWorkspacesRoot, 'v1-neuma', witness.address);
    await claimOwner(tmpWorkspacesRoot, 'unseen-neuma', witness.address);
    ws.setWorkspacesRoot(tmpWorkspacesRoot);

    const { default: router } = await import('../../backend/routes/voice-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/voice', router);
  });

  afterEach(async () => {
    const { setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
    setWorkspacesRoot(previousWorkspacesRoot);
    if (previousSettingsPath === undefined) delete process.env.NEUMA_VOICE_SETTINGS_PATH;
    else process.env.NEUMA_VOICE_SETTINGS_PATH = previousSettingsPath;
    rmSync(tmpWorkspacesRoot, { recursive: true, force: true });
    rmSync(settingsDir, { recursive: true, force: true });
  });

  describe('engine catalogue', () => {
    it('GET /engines returns the public manifest, internal paths stripped', async () => {
      const res = await request(app).get('/api/v1/voice/engines').set(witness.header);
      expect(res.status).toBe(200);
      expect(res.body.engines.csm.capabilities.context).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('startModule');
    });

    it('GET /engines/:id returns one engine; unknown is 404', async () => {
      const res = await request(app).get('/api/v1/voice/engines/csm').set(witness.header);
      expect(res.status).toBe(200);
      expect(res.body.engine.id).toBe('csm');
      expect((await request(app).get('/api/v1/voice/engines/does-not-exist').set(witness.header)).status).toBe(404);
    });

    it('requires auth', async () => {
      expect((await request(app).get('/api/v1/voice/engines')).status).toBe(401);
      expect((await request(app).get('/api/v1/voice/tier')).status).toBe(401);
    });
  });

  describe('the voice tier', () => {
    it('GET /tier: auto by default, with the reason, the machine, and every tier with its memory', async () => {
      const res = await request(app).get('/api/v1/voice/tier').set(witness.header);
      expect(res.status).toBe(200);
      expect(res.body.setting).toEqual({ tier: 'auto', profile: null });
      expect(res.body.chosen).toEqual(res.body.auto);
      expect(['light', 'standard']).toContain(res.body.chosen.tier);
      expect(res.body.reason).toBe(res.body.chosen.reason);
      expect(res.body.machine).toHaveProperty('mindSource');
      expect(res.body.tiers.map((t) => t.id)).toEqual(['light', 'standard']);
      const standard = res.body.tiers.find((t) => t.id === 'standard');
      expect(standard).toMatchObject({ engine: 'csm', model: 'csm-1b', device: 'cuda', defaultProfile: 'full' });
      expect(standard.profiles.lean.memMB).toBeGreaterThan(0);
      expect(standard.profiles.lean.needGB).toBeGreaterThan(standard.profiles.lean.memMB / 1024);
      expect(res.body.tiers.find((t) => t.id === 'light').profiles.cpu.needGB).toBe(null);
    }, 30_000);

    it('PUT /tier persists the pick and the chosen tier honours it', async () => {
      const res = await request(app).put('/api/v1/voice/tier').set(witness.header).send({ tier: 'standard', profile: 'lean' });
      expect(res.status).toBe(200);
      expect(res.body.setting).toEqual({ tier: 'standard', profile: 'lean' });
      expect(res.body.chosen).toMatchObject({ tier: 'standard', profile: 'lean' });
      expect(res.body.chosen.reason).toMatch(/^Chosen by you/);
      expect(JSON.parse(readFileSync(process.env.NEUMA_VOICE_SETTINGS_PATH, 'utf8'))).toEqual({ tier: 'standard', profile: 'lean' });
      const back = await request(app).put('/api/v1/voice/tier').set(witness.header).send({ tier: 'auto' });
      expect(back.body.chosen).toEqual(back.body.auto);
    }, 30_000);

    it('PUT /tier refuses an unknown tier or a profile the tier lacks (400), leaving the setting', async () => {
      expect((await request(app).put('/api/v1/voice/tier').set(witness.header).send({ tier: 'ultra' })).status).toBe(400);
      expect((await request(app).put('/api/v1/voice/tier').set(witness.header).send({ tier: 'high' })).status).toBe(400);
      const bad = await request(app).put('/api/v1/voice/tier').set(witness.header).send({ tier: 'light', profile: 'lean' });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toMatch(/light tier has profiles/);
      const now = await request(app).get('/api/v1/voice/tier').set(witness.header);
      expect(now.body.setting).toEqual({ tier: 'auto', profile: null });
    }, 30_000);
  });

  describe("a being's voice (Voice DNA v2)", () => {
    it('GET /dna and /has-voice: a sealed v2 voice is ready', async () => {
      const sealed = await sealTestVoice('test-neuma');
      const res = await request(app).get('/api/v1/voice/dna/test-neuma').set(witness.header);
      expect(res.status).toBe(200);
      expect(res.body.standing).toBe('ready');
      expect(res.body.dna.clip.ref).toBe(sealed.ref);
      expect(res.body.dna.words).toBe(sealed.words);
      const has = await request(app).get('/api/v1/voice/has-voice/test-neuma').set(witness.header);
      expect(has.body).toEqual({ hasVoice: true, standing: 'ready' });
    });

    it('a v1-only being reads as needing a new voice — never a voice', async () => {
      const svc = await import('../../core/voice/voice-dna-service.js');
      await svc.forgeVoiceDNA('v1-neuma', { witness: witness.address, provider: 'zonos' });
      const res = await request(app).get('/api/v1/voice/dna/v1-neuma').set(witness.header);
      expect(res.body).toEqual({ standing: 'needsNewVoice', dna: null, errors: [] });
      const has = await request(app).get('/api/v1/voice/has-voice/v1-neuma').set(witness.header);
      expect(has.body).toEqual({ hasVoice: false, standing: 'needsNewVoice' });
    });

    it('a being with no voice reads as none', async () => {
      const res = await request(app).get('/api/v1/voice/dna/unseen-neuma').set(witness.header);
      expect(res.status).toBe(200);
      expect(res.body.standing).toBe('none');
      expect((await request(app).get('/api/v1/voice/has-voice/unseen-neuma').set(witness.header)).body.hasVoice).toBe(false);
    });

    it('GET /dna is owner-only (403 for another wallet)', async () => {
      await claimOwner(tmpWorkspacesRoot, 'test-neuma', '0x' + 'b'.repeat(40));
      expect((await request(app).get('/api/v1/voice/dna/test-neuma').set(witness.header)).status).toBe(403);
    });

    it('rejects an invalid companion name (400)', async () => {
      const res = await request(app).get('/api/v1/voice/dna/bad name!').set(witness.header);
      expect(res.status).toBe(400);
    });
  });

  describe('the retired v1 surface', () => {
    it.each([
      ['get', '/api/v1/voice/provider'],
      ['put', '/api/v1/voice/provider'],
      ['post', '/api/v1/voice/test'],
      ['post', '/api/v1/voice/synthesize'],
      ['put', '/api/v1/voice/dna/test-neuma'],
      ['patch', '/api/v1/voice/dna/test-neuma'],
      ['put', '/api/v1/voice/seed/test-neuma'],
    ])('%s %s answers 404', async (method, url) => {
      expect((await request(app)[method](url).set(witness.header).send({})).status).toBe(404);
    });
  });
});
