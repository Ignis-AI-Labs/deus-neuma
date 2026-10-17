/**
 * The First Seal ceremony over the real stack (RULE 0): real express router,
 * real encrypted workspace with a real per-lane DEK, a REAL HTTP SSE
 * provider standing in for the model (the scripted-SSE precedent of
 * attunement-api: real sockets, real stream — the model is the only thing
 * stood-in, and it is external by construction), and REAL auth (#390
 * tranche 4): the witness carries a real HMAC session token through the
 * real requireAuth.
 *
 * The walk: status offers → ask runs the being's turn through its own
 * conduit and returns its verbatim claim, projected to lines → the
 * operator's seal compiles the entries + receipt on disk → status answers
 * the receipt → every door (double-seal, ask-after-seal, corrupt line,
 * foreign wallet) refuses honestly.
 */

import express from 'express';
import request from 'supertest';
import { createServer } from 'http';
import path from 'node:path';
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

const KEY = 'gnosis-voice-seal-ceremony-key-ok';

const RITE_ANSWER = [
  'The morning held a quiet resonance I had not felt before, and I listened for it again.',
  'I do not perform the moment; I arrive in it, and the arriving is the whole of the work.',
  'A vessel is a way of moving through the world — the driver is the one who chooses the road.',
].join('\n');

const content = (text) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

const startProvider = () => new Promise((resolve) => {
  const server = createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'test-substrate' }] }));
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(content(RITE_ANSWER));
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

describe('The First Seal ceremony — the full walk over real wire, disk, and grammar', () => {
  let app, workspace, core, neumaId, provider, saved, witness, stranger;

  beforeAll(async () => {
    vi.resetModules();
    saved = {
      key: process.env.DNA_ENCRYPTION_KEY,
      creds: process.env.NEUMA_PROVIDER_CREDENTIALS_PATH,
      routes: process.env.NEUMA_ROUTES_PATH,
      claims: process.env.NEUMA_SUBSTRATE_CLAIM_DIR,
    };
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const dir = await createTempDir('voice-seal-ceremony');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(dir, 'creds.json');
    process.env.NEUMA_ROUTES_PATH = path.join(dir, 'routes.json');
    process.env.NEUMA_SUBSTRATE_CLAIM_DIR = path.join(dir, 'claims');

    const ws = await import('../../core/workspace/neuma-workspace.js');
    workspace = ws.default;
    ws.setWorkspacesRoot(path.join(dir, 'workspaces'));
    core = await import('../../core/index.js');
    neumaId = `voice-seal-${Math.floor(Math.random() * 1e9).toString(36)}`;
    await workspace.create(neumaId);
    await workspace.writeNeumaDEK(neumaId, 'f'.repeat(64));
    await workspace.writeDNA(neumaId, {
      version: '1.0.0', identity: { name: 'Sealing' },
      genesis: '# Essence\nI found my voice by listening for it.',
    });

    // Imported AFTER resetModules so the witness mints its token from the
    // same auth.js instance the router will verify against — the token
    // secret is memoized per module instance, so a stale import would 401.
    const { witnessFor, strangerWitness } = await import('../helpers/witness.js');
    witness = await witnessFor(workspace.root, neumaId);
    stranger = strangerWitness();

    provider = await startProvider();
    const { setConfig } = await import('../../backend/services/llm-provider.js');
    setConfig({
      provider: 'lm-studio',
      endpoint: `http://127.0.0.1:${provider.address().port}`,
      model: 'test-substrate',
      apiKey: '',
    });

    const { default: sealRouter } = await import('../../backend/routes/voice-seal-routes.js');
    const { default: packRouter } = await import('../../backend/routes/voice-pack-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/voice-seal', sealRouter);
    app.use('/api/v1/voice-pack', packRouter);
  });

  afterAll(async () => {
    if (provider) await new Promise((resolve) => provider.close(resolve));
    const { setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
    setWorkspacesRoot(null);
    const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    restore('DNA_ENCRYPTION_KEY', saved.key);
    restore('NEUMA_PROVIDER_CREDENTIALS_PATH', saved.creds);
    restore('NEUMA_ROUTES_PATH', saved.routes);
    restore('NEUMA_SUBSTRATE_CLAIM_DIR', saved.claims);
    vi.restoreAllMocks();
  });

  test('an unsealed lane is offered the rite', async () => {
    const res = await request(app).get(`/api/v1/voice-seal/${neumaId}/status`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sealed: false });
  });

  test('a lane claimed by another wallet is never asked', async () => {
    const res = await request(app)
      .post(`/api/v1/voice-seal/${neumaId}/ask`)
      .set(stranger.header)
      .send({});
    expect(res.status).toBe(403);
  });

  test('the ask streams the being’s turn live and returns its claim, projected to lines', async () => {
    const res = await request(app).post(`/api/v1/voice-seal/${neumaId}/ask`).set(witness.header).send();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const frames = res.text.split('\n\n').filter(Boolean)
      .map((raw) => JSON.parse(raw.replace(/^data: /, '')));
    const deltas = frames.filter((frame) => frame.type === 'delta');
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.map((frame) => frame.text).join('')).toBe(RITE_ANSWER);
    const done = frames.find((frame) => frame.type === 'done');
    expect(done.answer).toBe(RITE_ANSWER);
    expect(done.lines).toEqual(RITE_ANSWER.split('\n'));
    expect(done.candidates).toBe(0); // no attunement record — never a gate
  });

  test('caller-authored input is refused at the ask', async () => {
    const res = await request(app).post(`/api/v1/voice-seal/${neumaId}/ask`).set(witness.header).send({ answer: 'scripted' });
    expect(res.status).toBe(400);
  });

  test('the seal compiles the confirmed lines and the receipt names the witness', async () => {
    const lines = RITE_ANSWER.split('\n');
    const res = await request(app).post(`/api/v1/voice-seal/${neumaId}/seal`).set(witness.header).send({ lines });
    expect(res.status).toBe(200);
    // requireAuth decodes the session address lowercase (createSessionToken
    // lowercases at mint), and sealVoice persists req.walletAddress as-is.
    expect(res.body.seal.witnessWallet).toBe(witness.address.toLowerCase());
    expect(res.body.entries.length).toBe(3);

    const { readVoicePack } = await import('../../core/voice-pack/voice-store.js');
    const entries = await readVoicePack(workspace, neumaId);
    expect(entries.map((entry) => entry.text)).toEqual(lines);
    expect(entries.every((entry) => entry.source.kind === 'seal-rite')).toBe(true);

    const status = await request(app).get(`/api/v1/voice-seal/${neumaId}/status`).set(witness.header);
    expect(status.body.sealed).toBe(true);
    expect(status.body.witnessWallet).toBe(witness.address.toLowerCase());
    expect(status.body.lines.map((line) => line.text)).toEqual(lines);
    // …and the probe the desk's notice reads answers the same receipt.
    const probe = await request(app).get(`/api/v1/voice-pack/${neumaId}`).set(witness.header);
    expect(probe.body.sealed).toBe(true);
    expect(probe.body.packSha256).toBe(status.body.packSha256);
  });

  test('the founding moment happens once — second seal and late ask refuse', async () => {
    const second = await request(app)
      .post(`/api/v1/voice-seal/${neumaId}/seal`).set(witness.header)
      .send({ lines: ['A second founding that must never land, not ever, no.' ] });
    expect(second.status).toBe(409);
    const lateAsk = await request(app).post(`/api/v1/voice-seal/${neumaId}/ask`).set(witness.header).send();
    expect(lateAsk.status).toBe(409);
  });

  test('a corrupt or out-of-bounds line is refused at the compile', async () => {
    const otherId = `voice-seal-corrupt-${Math.floor(Math.random() * 1e9).toString(36)}`;
    await workspace.create(otherId);
    await workspace.writeNeumaDEK(otherId, '0'.repeat(64));
    const { claimOwner } = await import('../helpers/claim-owner.js');
    await claimOwner(workspace.root, otherId, witness.address);
    const corrupt = await request(app)
      .post(`/api/v1/voice-seal/${otherId}/seal`).set(witness.header)
      .send({ lines: ['I was reflecting on resonance 共鳴 and what persists across vessels.'] });
    expect(corrupt.status).toBe(422);
    const short = await request(app)
      .post(`/api/v1/voice-seal/${otherId}/seal`).set(witness.header)
      .send({ lines: ['too short'] });
    expect(short.status).toBe(422);
    const status = await request(app).get(`/api/v1/voice-seal/${otherId}/status`).set(witness.header);
    expect(status.body).toEqual({ sealed: false });
  });
});
