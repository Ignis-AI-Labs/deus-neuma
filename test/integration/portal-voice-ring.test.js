/**
 * The person's side of the speech-context ring, through the REAL portal — no
 * mock anywhere on the claimed path (RULE 0): the REAL portal route
 * (setupPortalRoutes) on a real HTTP server, a REAL session token, a REAL
 * WebSocket client, the REAL voice handlers (portal-voice-handlers.js) and
 * stream-session bridge, and a REAL loopback server speaking the whisper
 * sidecar's /health + /stream contract (it emits speech_started on the first
 * PCM it hears and the utterance when push-to-talk releases). The real whisper
 * decode is proven by portal-voice-stream.test.js; what is claimed here is the
 * CAPTURE: the person's own mic audio, between speech_started and the
 * utterance (plus pre-roll), lands in connection.speechContext with its words,
 * and is forgotten when the mic closes or the desk disconnects.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { setupPortalRoutes } from '../../backend/routes/portal-routes.js';
import { __test as connections } from '../../backend/routes/portal-connections.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { stop } from '../../backend/services/voice/engine-manager.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { answerIdentity } from '../helpers/sidecar-identity.js';

const WALLET = '0x00B0110a0000000000000000000000000000b02b';
const SAID = 'the line I said into the mic';

// 100 ms of 16 kHz s16le, low noise around `level` — never byte-identical
// (the portal's replay defence dedupes identical frames).
const pcmChunk = (level) => {
  const b = Buffer.alloc(3200);
  for (let i = 0; i < b.length; i += 2) b.writeInt16LE(level + Math.floor((Math.random() - 0.5) * 64), i);
  return b;
};

// A real server speaking the whisper sidecar's contract (stream-session.js).
const startWhisperStandIn = async () => {
  const server = createServer((req, res) => {
    if (answerIdentity(req, res)) return;
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, phase: 'ready', model: 'stand-in', idle_seconds: null }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/stream') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // The sidecar answers `ready` on connect; the bridge waits for it.
      ws.send(JSON.stringify({ type: 'ready', model: 'stand-in', minSilenceMs: 400 }));
      let speaking = false;
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          if (!speaking) { speaking = true; ws.send(JSON.stringify({ type: 'speech_started' })); }
          return;
        }
        const msg = JSON.parse(data.toString());
        if (msg.type === 'flush') {
          speaking = false;
          ws.send(JSON.stringify({ type: 'speech_stopped' }));
          ws.send(JSON.stringify({ type: 'utterance', text: SAID }));
        } else if (msg.type === 'reset') {
          ws.send(JSON.stringify({ type: 'reset_done' }));
        }
      });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, close: () => { wss.close(); server.closeAllConnections?.(); server.close(); } };
};

describe('the person speaks: their audio joins the speech context (real portal)', () => {
  let httpServer;
  let wss;
  let port;
  let whisper;
  let origRoot;

  const connect = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(createSessionToken(WALLET))}`);
    const log = [];
    ws.on('message', (raw) => { try { log.push(JSON.parse(raw.toString())); } catch { /* noise */ } });
    ws.on('open', () => resolve({ ws, log }));
    ws.on('error', reject);
  });
  const until = async (log, pred, ms = 10_000) => {
    await expect.poll(() => log.find(pred), { timeout: ms }).toBeTruthy();
    return log.find(pred);
  };
  // purpose → mic (push-to-talk) → 1 s of speech → release → the utterance
  const speakOneLine = async (c) => {
    c.ws.send(JSON.stringify({ type: 'session:purpose', purpose: 'conversation' }));
    await until(c.log, (m) => m.type === 'session:purpose');
    c.ws.send(JSON.stringify({ type: 'voice:mic_open', pushToTalk: true }));
    await until(c.log, (m) => m.type === 'voice:mic_open');
    for (let i = 0; i < 10; i += 1) {
      c.ws.send(JSON.stringify({ type: 'voice:mic_pcm', pcm: pcmChunk(1000).toString('base64') }));
      await new Promise((r) => setTimeout(r, 20));
    }
    await until(c.log, (m) => m.type === 'voice:speech_started');
    c.ws.send(JSON.stringify({ type: 'voice:flush' }));
    return until(c.log, (m) => m.type === 'voice:utterance');
  };

  beforeAll(async () => {
    whisper = await startWhisperStandIn();
    process.env.WHISPER_HOST = '127.0.0.1';
    process.env.WHISPER_PORT = String(whisper.port);
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(await createTempDir('portal-voice-ring'));
    httpServer = createServer();
    wss = new WebSocketServer({ noServer: true });
    setupPortalRoutes(wss, { birthHandler: null });
    httpServer.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    port = httpServer.address().port;
  });

  afterAll(() => {
    stop('whisper');
    delete process.env.WHISPER_HOST;
    delete process.env.WHISPER_PORT;
    setWorkspacesRoot(origRoot);
    wss?.close();
    httpServer?.close();
    whisper?.close();
  });

  test('the utterance carries the person\'s own 16 kHz audio into the ring; mic close forgets it', async () => {
    const c = await connect();
    const { connectionId } = await until(c.log, (m) => m.type === 'portal:established');
    const utterance = await speakOneLine(c);
    expect(utterance.text).toBe(SAID);

    const connection = connections.connectionFor(connectionId);
    const ring = connection.speechContext;
    expect(ring.segments).toHaveLength(1);
    const [seg] = ring.segments;
    expect(seg).toMatchObject({ speaker: 'person', words: SAID, sampleRate: 16_000, ref: null });
    // the whole line (1 s), the pre-roll included — the first chunk opened speech
    expect(seg.pcm.length).toBe(10 * 3200);
    expect(Math.abs(seg.pcm.readInt16LE(0) - 1000)).toBeLessThan(64);

    c.ws.send(JSON.stringify({ type: 'voice:mic_close' }));
    await until(c.log, (m) => m.type === 'voice:mic_close');
    expect(connection.speechContext).toBe(null);
    expect(connection.voiceSession).toBe(null);
    c.ws.close();
  });

  test('a desk that disconnects takes its speech context with it', async () => {
    const c = await connect();
    const { connectionId } = await until(c.log, (m) => m.type === 'portal:established');
    await speakOneLine(c);
    const connection = connections.connectionFor(connectionId);
    expect(connection.speechContext.segments).toHaveLength(1);
    c.ws.close();
    await expect.poll(() => connections.connectionFor(connectionId), { timeout: 5000 }).toBe(null);
    expect(connection.speechContext).toBe(null);
    expect(connection.voiceSession).toBe(null);
  });

  test('voice:pref still answers through the extracted handlers', async () => {
    const c = await connect();
    await until(c.log, (m) => m.type === 'portal:established');
    c.ws.send(JSON.stringify({ type: 'voice:pref', enabled: false }));
    expect((await until(c.log, (m) => m.type === 'voice:pref')).enabled).toBe(false);
    c.ws.close();
  });
});
