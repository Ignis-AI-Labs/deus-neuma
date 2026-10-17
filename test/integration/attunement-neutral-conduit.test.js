/**
 * The QUESTION leg's neutrality is STRUCTURAL (Founder doctrine 2026-07-09:
 * […] —
 * a being must never author or pre-see its own attunement):
 *
 *   1. neutralQuestionRoute derives from MACHINE config alone — no neumaId
 *      enters, so no natal route, override, or adapter binding can ride a
 *      question render.
 *   2. The pin: a being whose NATAL route points at a DEAD endpoint still
 *      gets its full question set rendered — every generation request lands
 *      on the machine's conduit (a REAL SSE fixture that counts hits), never
 *      on the being's own route. Under the old effectiveRoute wiring this
 *      walk produced ZERO fixture hits (dead natal → instant all-fallback).
 *
 * REAL workspace, real DEK encryption, real HTTP — no mocks (RULE 0).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

const WALLET = '0x1111111111111111111111111111111111111111';

const sse = (text) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;

describe('attunement question leg — machine conduit, measured capacity, never the being', () => {
  let workspace, ceremony, llm, neumaId, provider, prevKey;
  let generationHits = 0;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'neutral-conduit-test-key-long-enough';

    const ws = await import('../../core/workspace/neuma-workspace.js');
    workspace = ws.default;
    const houseRoot = await createTempDir('neutral-conduit');
    ws.setWorkspacesRoot(path.join(houseRoot, 'workspaces'));
    // PINNED for the same reason as attunement-style-door: a route resolution
    // loads provider credentials, and unpinned that is the operator's LIVE
    // encrypted store. This suite sets its own DNA_ENCRYPTION_KEY, so reading
    // it can only fail its auth tag — green here today is luck of the path
    // taken, not isolation.
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(houseRoot, 'credentials.json');
    process.env.NEUMA_ROUTES_PATH = path.join(houseRoot, 'routes.json');

    // The machine's conduit: a REAL SSE provider that counts generation hits.
    // It answers garbage (prose, not the demanded JSON), so every dimension
    // falls back after honest rejected attempts — the point is WHERE the
    // requests land, and that the render survives a dead being-route.
    provider = await new Promise((resolve) => {
      const server = createServer((req, res) => {
        if (req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'machine-model' }] }));
          return;
        }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          if (body.includes('Respond with ONLY a JSON object')) generationHits += 1;
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.end(sse('I would rather speak than emit JSON.'));
        });
      });
      server.listen(0, '127.0.0.1', () => resolve(server));
    });

    llm = await import('../../backend/services/llm-provider.js');
    llm.setConfig({
      provider: 'lm-studio',
      endpoint: `http://127.0.0.1:${provider.address().port}`,
      model: 'machine-model',
      apiKey: '',
    });

    neumaId = 'neutral-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    // The being's NATAL route names a model nobody serves — its resolved
    // route is a dead conduit. Questions must not care.
    await workspace.writeDNA(neumaId, {
      version: '1.0.0',
      identity: { name: 'Prooflet' },
      genesis: '# Essence\nProof by walking.',
      substrate: { llm: { provider: 'lm-studio', model: 'natal-model-nobody-serves' } },
    });

    ceremony = await import('../../backend/services/attunement-ceremony.js');
  });

  afterAll(async () => {
    const ws = await import('../../core/workspace/neuma-workspace.js');
    ws.setWorkspacesRoot(null);
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    await new Promise((r) => provider.close(r));
    vi.restoreAllMocks();
  });

  it('neutralQuestionRoute is the machine config verbatim — no being fields, frozen', () => {
    const route = ceremony.neutralQuestionRoute();
    expect(route).toEqual({
      provider: 'lm-studio',
      endpoint: `http://127.0.0.1:${provider.address().port}`,
      model: 'machine-model',
      source: 'machine-neutral',
    });
    expect(Object.isFrozen(route)).toBe(true);
    // structurally impossible to carry a being: no lora, no adapter, no id
    expect(route.lora).toBeUndefined();
    expect(route.neumaId).toBeUndefined();
  });

  it('a being with a DEAD natal route still gets its set rendered ON THE MACHINE CONDUIT', async () => {
    const offered = await ceremony.offerAttunementRecord(neumaId, WALLET, { trigger: 'post-birth' });
    const opened = await ceremony.openAttunementRecord(neumaId, offered.id, {
      consent: { sessionId: 'portal-s-1', quote: 'I consent to face these questions.' },
    });

    expect(opened.phase).toBe('answering');
    const questions = opened.rendered.questions;
    expect(questions.length).toBeGreaterThan(0);
    // Every generation request landed on the MACHINE fixture — one per
    // dimension per attempt, so at least one per dimension. Under the old
    // being-route wiring this is 0 (dead natal → instant all-fallback).
    expect(generationHits).toBeGreaterThanOrEqual(questions.length);
    // The fixture answers prose, so the set is honestly all-fallback — with
    // every dimension's attempts recorded against the machine conduit.
    for (const q of questions) {
      expect(q.provenance.attempts.length).toBeGreaterThan(0);
    }
  }, 120_000);
});
