/**
 * TTS wedge degradation (S-21, threat-model control #7) — a dead or wedged
 * voice sidecar mid-turn must never hang or kill the turn. The production law
 * lives in voice/speech-turn.js: each sentence's synthesis rides .catch (log +
 * release the words), a sentence whose audio never starts releases its words
 * after a bound, and the drain is bounded. There is NO cloud fallback.
 *
 * REAL, no mock anywhere on the claimed path (RULE 0): the REAL speak adapter
 * against (a) a REAL dead loopback port (genuine ECONNREFUSED); the REAL
 * tts-provider (tier → engine-manager adopting a running sidecar → speak) and
 * the REAL _synthesizeAndEmit the turn path calls, against (b) a REAL server
 * speaking the speak protocol that accepts and never answers (the wedge) and
 * (c) one that answers 500; and a REAL ws server/client pair carrying frames.
 *
 * The dead port is driven through the adapter directly, never through the
 * tier: a silent csm port would make engine-manager launch the REAL engine.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { startSpeakWire, pinSpeechToStandIn } from '../helpers/speak-wire-stand-in.js';
import { speak } from '../../backend/services/voice/providers/speak.js';
import { synthesize } from '../../backend/services/tts-provider.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { _synthesizeAndEmit } = __test;
const VOICE = Object.freeze({ ref: `sha256:${'c'.repeat(64)}`, words: 'the words in the clip', wav: Buffer.from('RIFF') });
const SENTENCE = 'The house answers in its own voice.';

const drain = async (gen) => {
  for await (const chunk of gen) void chunk;
};

describe('TTS wedge degradation (S-21) — dead/wedged sidecar never hangs or kills the turn', () => {
  let httpServer;
  let wss;
  let wsPort;
  let wire;
  const pairs = [];

  const openPair = () => new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    const frames = [];
    client.on('message', (raw) => { try { frames.push(JSON.parse(raw.toString())); } catch { /* noise */ } });
    client.on('error', reject);
    wss.once('connection', (serverWs) => {
      client.once('open', () => {
        pairs.push(client);
        resolve({ serverWs, client, frames });
      });
    });
  });

  beforeAll(async () => {
    wire = await startSpeakWire({ mode: 'wedge' });
    await pinSpeechToStandIn(wire.port, path.join(await createTempDir('tts-wedge-settings'), 'voice.json'));
    httpServer = createServer();
    wss = new WebSocketServer({ noServer: true });
    httpServer.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    wsPort = httpServer.address().port;
  });

  afterAll(async () => {
    while (pairs.length) {
      try { pairs.pop().close(); } catch { /* already gone */ }
    }
    wss?.close();
    httpServer?.close();
    await wire?.close();
  });

  test('a dead sidecar rejects promptly — no hang, no retry zombie', async () => {
    const dead = createServer();
    await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
    const { port } = dead.address();
    await new Promise((resolve) => dead.close(resolve)); // a port nothing listens on now
    const t0 = performance.now();
    await expect(drain(speak({ endpoint: `http://127.0.0.1:${port}`, text: SENTENCE, voice: VOICE }))).rejects.toThrow();
    expect(performance.now() - t0).toBeLessThan(5_000);
  });

  test('a wedged sidecar (accepts, never answers) is cut by the abort signal — never a hostage', async () => {
    wire.setMode('wedge');
    const t0 = performance.now();
    await expect(drain(synthesize({ text: SENTENCE, voice: VOICE, signal: AbortSignal.timeout(1_500) }))).rejects.toThrow();
    expect(performance.now() - t0).toBeLessThan(10_000);
    expect(wire.speaks().length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  test('a failing sidecar (500) propagates after ZERO audio frames — the socket stays well', async () => {
    wire.setMode('fail');
    const { serverWs, frames } = await openPair();
    await expect(_synthesizeAndEmit(serverWs, 'wedge-probe', SENTENCE, VOICE)).rejects.toThrow(/speak failed \(500 internal\)/);
    expect(frames.filter((f) => f.type === 'voice:audio')).toEqual([]);
    expect(serverWs.readyState).toBe(serverWs.OPEN);
    serverWs.send(JSON.stringify({ type: 'consciousness:stream', content: 'the turn completes as text' }));
    await expect.poll(() => frames.find((f) => f.type === 'consciousness:stream')?.content, { timeout: 5_000 })
      .toContain('text');
  }, 30_000);
});
