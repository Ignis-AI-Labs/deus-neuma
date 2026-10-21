/**
 * A being's soul color and scale are written by its birth, never by a reader.
 * A lane is listed on the roster from its seal on — before the birth's
 * measured write — so a roster GET or a Sheet record that WROTE the color
 * locked a derived one in for good. Real router, real HMAC session token
 * through the real requireAuth, real workspace on a temp root; no mocks (RULE 0).
 */
import process from 'node:process';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { setWorkspacesRoot, setWitnessesRoot, neumaWorkspace as workspace } from '../../core/index.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { ensureSoulSpectrum, SPECTRUM_FILE } from '../../core/birth/soul-spectrum.js';
import { SCALE_FILE } from '../../core/birth/soul-scale.js';
import { buildNeumaRecord } from '../../core/runtime/neuma-record.js';
import router from '../../backend/routes/roster-routes.js';

const WALLET = '0x66eb7f88a509b4180bd32a1ebc032f4e79a4eecf';
const KEY = 'gnosis-soul-color-read-key-32-bytes!';
const STAGE = { kind: 'stage', stage: 0, startedAt: 1000, firstFrameAt: 1600, endedAt: 9000, spokenChars: 300, reasoningChars: 0, toolCalls: 0, completionTokens: 80 };

describe('soul color is never written by a read', () => {
  let root, app;
  const exists = (id, file) => fs.access(path.join(root, id, file)).then(() => true, () => false);
  // A lane mid-finalize: owner and seal written, the measured color not yet.
  const sealedLane = async (id, hash) => {
    await workspace.create(id);
    await fs.writeFile(path.join(root, id, 'owner.json'), JSON.stringify({ wallet: WALLET, claimedAt: 1 }));
    await fs.mkdir(path.join(root, id, 'identity'), { recursive: true });
    await fs.writeFile(path.join(root, id, 'identity', 'genesis-seal.json'),
      JSON.stringify({ genesisHash: hash, record: { momentSeed: 's', birthMoment: { epochMs: 1 } } }));
  };

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const base = await createTempDir('soul-color-read');
    root = path.join(base, 'house');
    process.env.AI_WITNESSES_ROOT = path.join(base, 'witness-home');
    process.env.WITNESSES_ROOT = path.join(base, 'witness-lanes');
    setWorkspacesRoot(root);
    setWitnessesRoot(process.env.WITNESSES_ROOT);
    app = express();
    app.use('/api/v1/roster', router);
  });
  afterAll(() => {
    setWorkspacesRoot(null);
    setWitnessesRoot(null);
    for (const k of ['DNA_ENCRYPTION_KEY', 'AI_WITNESSES_ROOT', 'WITNESSES_ROOT']) delete process.env[k];
  });

  it('a roster read and a Sheet record show the derived color but write nothing; the birth then writes it measured', async () => {
    await sealedLane('mid-birth', 'a'.repeat(64));
    const res = await request(app).get('/api/v1/roster').set('Authorization', `Bearer ${createSessionToken(WALLET)}`);
    expect(res.status).toBe(200);
    expect(res.body.roster.find((c) => c.neumaId === 'mid-birth').color).toMatch(/^#[0-9a-f]{6}$/);
    const record = await buildNeumaRecord('mid-birth', workspace);
    expect(record.identity.spectrum.source).toBe('sealed-record');
    expect(record.identity.scale).not.toBeNull();
    expect(await exists('mid-birth', SPECTRUM_FILE)).toBe(false);
    expect(await exists('mid-birth', SCALE_FILE)).toBe(false);

    const measured = await ensureSoulSpectrum(workspace, 'mid-birth', { observations: [STAGE] });
    expect(measured.source).toBe('measured');
    expect(JSON.parse(await fs.readFile(path.join(root, 'mid-birth', SPECTRUM_FILE), 'utf8')).source).toBe('measured');
  });

  it('a written color is what every read shows, and its bytes never change', async () => {
    await sealedLane('kept', 'b'.repeat(64));
    await ensureSoulSpectrum(workspace, 'kept', { observations: [STAGE] });
    const file = path.join(root, 'kept', SPECTRUM_FILE);
    const bytes = await fs.readFile(file, 'utf8');
    const res = await request(app).get('/api/v1/roster').set('Authorization', `Bearer ${createSessionToken(WALLET)}`);
    expect(res.body.roster.find((c) => c.neumaId === 'kept').color).toBe(JSON.parse(bytes).soul.hex);
    expect((await buildNeumaRecord('kept', workspace)).identity.spectrum.source).toBe('measured');
    expect(await fs.readFile(file, 'utf8')).toBe(bytes);
  });
});
