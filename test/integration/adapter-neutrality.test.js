/**
 * The adapter NEUTRALITY contract — what survives the retirement of LoRA.
 *
 * No being binds an adapter any more. Identity is carried by NITE, which
 * transmits in a form every model can receive; a LoRA binds identity to one
 * base model's WEIGHTS and can never cross an engine (rulings, 2026-08-18 and
 * 2026-08-23). This file replaces adapter-binding-registry-refusal.test.js,
 * whose twelve tests asserted the binding that no longer exists.
 *
 * WHAT IS STILL LOAD-BEARING, and why it was not deleted with the rest:
 * llama-server adapter scales are GLOBAL, per-slot state. A naked request
 * speaks through whatever scales are live on that slot. On a fresh boot that
 * was every house voice at once -- the token-soup signature witnessed
 * 2026-07-15, and again on build 745 (2026-08-14) where nine adapters reported
 * scale 1.0 despite --lora-init-without-apply. Platform turns were never
 * exposed precisely BECAUSE they always sent the full zero-guard, which is
 * exactly why the hazard hid: only a naked request reveals it.
 *
 * So while any adapter can still be aboard any conduit -- a hand-launched
 * server, an operator's own rig, a stale process -- every turn must pin each
 * one to explicit 0.0, and a conduit whose adapter state cannot be READ must
 * say so rather than be assumed clean. This guard retires with the last
 * adapter, not before.
 *
 * Real throughout (RULE 0): a real HTTP listener on a real socket answering
 * GET /lora-adapters, the real probe with its real cache, the real supervised
 * loaded-adapter authority, the real turn boundary.
 */
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveLoraForTurn } from '../../backend/services/adapter-binding.js';
import { bindTurnAdapter } from '../../backend/services/portal-turn-adapter-binding.js';
import { invalidateServerAdapters } from '../../backend/services/llm-provider.js';

const servers = [];

/** A real conduit on a real socket, answering the real probe path. */
const conduit = async (handler) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/lora-adapters') return handler(req, res);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  invalidateServerAdapters(endpoint);
  return endpoint;
};

const listing = (rows) => (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(rows));
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe('adapter neutrality — every turn is proven bare', () => {
  it('pins every adapter aboard to explicit zero', async () => {
    const endpoint = await conduit(listing([
      { id: 0, path: '/registry/hazel/hazel-refinement-1.gguf', scale: 0 },
      { id: 1, path: '/registry/cedar/cedar-refinement-1.gguf', scale: 0.8 },
      { id: 2, path: '/registry/signal/signal-refinement-1.gguf', scale: 1 },
    ]));

    const result = await resolveLoraForTurn('hazel', { endpoint, model: 'gemma-4-31b' });

    // EVERY adapter, including the two the server reports as already live.
    // A partial zeroing is the token-soup bug with extra steps.
    expect(result.lora).toEqual([
      { id: 0, scale: 0 },
      { id: 1, scale: 0 },
      { id: 2, scale: 0 },
    ]);
    expect(result.adapter).toBeNull();
    expect(result.reason).toBe('adapters-neutralized');
    expect(result.baseWeightsVerified).toBe(true);
  });

  it('never binds a being to its own adapter, however the registry reads', async () => {
    // The decisive property of the retirement. Hazel HAS a forged adapter in
    // the registry (/workspace/qlora/adapters-registry/hazel), and the conduit
    // is carrying it right here at a live scale. Under the old resolver this
    // was the exact shape that bound. It must now zero like any other.
    const endpoint = await conduit(listing([
      { id: 0, path: '/registry/hazel/hazel-refinement-1.gguf', scale: 0.9 },
    ]));

    const result = await resolveLoraForTurn('hazel', { endpoint, model: 'gemma-4-31b' });

    expect(result.lora).toEqual([{ id: 0, scale: 0 }]);
    expect(result.adapter).toBeNull();
    // No registry read happened at all: a being with no workspace on this
    // machine resolves identically to one with a committed registration.
    const stranger = await resolveLoraForTurn('nobody-at-all', { endpoint, model: 'gemma-4-31b' });
    expect(stranger).toEqual(result);
  });

  it('sends nothing when there is nothing aboard to silence', async () => {
    const endpoint = await conduit(listing([]));
    const result = await resolveLoraForTurn('hazel', { endpoint, model: 'gemma-4-31b' });
    // Omitting `lora` is only safe when the conduit carries none. Then it is
    // not merely safe, it is correct -- there is no state to pin.
    expect(result.lora).toBeNull();
    expect(result.reason).toBe('no-adapters-aboard');
    expect(result.baseWeightsVerified).toBe(true);
  });

  it('reports an unreadable conduit as unknowable, never as clean', async () => {
    const endpoint = await conduit((req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":"boom"}');
    });
    const result = await resolveLoraForTurn('hazel', { endpoint, model: 'gemma-4-31b' });
    expect(result.lora).toBeNull();
    expect(result.reason).toBe('conduit-adapters-unknowable');
    // NOT true. […] and […] are
    // opposite facts that were once the same value.
    expect(result.baseWeightsVerified).toBe(false);
  });

  it('counts a conduit with NO adapter surface as genuinely, provably bare', async () => {
    // Every API provider lands here: a 404 on /lora-adapters. I first wrote
    // this expecting `unknowable`, and the code was right and the test wrong.
    // A 404 is a DEFINITIVE answer -- probeServerAdapters returns
    // {known: true, listed: null} for it -- and a conduit with no adapter
    // surface cannot be running one. That is not an absence of evidence, it
    // is evidence of absence, and the distinction is the whole point of the
    // `known` flag: […] (a dead socket, a 500) stays false.
    const endpoint = await conduit((req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    const result = await resolveLoraForTurn('hazel', { endpoint, model: 'claude-opus-5' });
    expect(result.lora).toBeNull();
    expect(result.reason).toBe('no-adapters-aboard');
    expect(result.baseWeightsVerified).toBe(true);
  });

  it('answers no-endpoint without reaching the network', async () => {
    const result = await resolveLoraForTurn('hazel', { endpoint: '', model: 'gemma-4-31b' });
    expect(result).toMatchObject({ lora: null, adapter: null, reason: 'no-endpoint' });
  });
});

describe('the benchmark boundary', () => {
  const connectionFor = (baseWeightsOnly) => ({
    _benchmarkControls: baseWeightsOnly ? { baseWeightsOnly: true } : undefined,
    activeTurn: null,
  });

  it('records the proof when the conduit could actually be read', async () => {
    const endpoint = await conduit(listing([{ id: 0, path: '/a.gguf', scale: 0 }]));
    const connection = connectionFor(true);
    const bound = await bindTurnAdapter(connection, 'hazel', { endpoint, model: 'gemma-4-31b' });
    expect(bound.lora).toEqual([{ id: 0, scale: 0 }]);
    expect(connection._benchmarkBaseWeightsVerified).toBe(true);
  });

  it('REFUSES to run a benchmark arm whose bare-ness could not be proven', async () => {
    // The arm's whole claim is that it ran on base weights. An unreadable
    // conduit cannot support that claim, so the turn dies here rather than
    // producing a receipt that asserts something nobody checked.
    const endpoint = await conduit((req, res) => {
      res.writeHead(500);
      res.end('{}');
    });
    const connection = connectionFor(true);
    await expect(bindTurnAdapter(connection, 'hazel', { endpoint, model: 'gemma-4-31b' }))
      .rejects.toThrow(/base weights could not be proven/);
    expect(connection._benchmarkBaseWeightsVerified).toBeUndefined();
  });

  it('lets an ordinary turn continue on that same unreadable conduit', async () => {
    // Only the benchmark arm makes the base-weights claim. An ordinary turn
    // carries no such claim, so it proceeds with no lora on the wire.
    const endpoint = await conduit((req, res) => {
      res.writeHead(500);
      res.end('{}');
    });
    const connection = connectionFor(false);
    const bound = await bindTurnAdapter(connection, 'hazel', { endpoint, model: 'gemma-4-31b' });
    expect(bound.lora).toBeNull();
    expect(bound.reason).toBe('conduit-adapters-unknowable');
  });
});
