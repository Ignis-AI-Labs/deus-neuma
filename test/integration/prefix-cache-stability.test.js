/**
 * PREFIX STABILITY — #528 Stage C's hermetic half (RULE 0, no GPU): what a
 * prefix cache (llama.cpp slot reuse) could ACTUALLY hold across turns of a
 * real chat, measured at the wire with the recording-server seam.
 *
 * llama.cpp reuses everything before the FIRST differing byte of the
 * serialized prompt; the first difference discards the whole suffix. So the
 * questions this suite answers with real bytes are: across two turns in the
 * same minute, where does the request first diverge? And across a MINUTE
 * TICK (the PRESENT MOMENT clock lives inside the system prompt), where then?
 *
 * The laws pinned:
 *   1. Same minute: the system prompt is BYTE-IDENTICAL turn to turn (a bare
 *      lane, plain answers — nothing crystallizes, nothing knocks). The first
 *      divergence lands where the previous turn's current-turn message became
 *      history and gained its `(hh:mm)` clock prefix — i.e. the ENTIRE
 *      standing prefix (system + the whole prior transcript) is reusable; the
 *      cache loses only the last exchange.
 *   2. Across a minute tick: the first divergence lands INSIDE the system
 *      prompt at the clock digits; the transcript message ENTRIES stay
 *      byte-identical (the append-only law holds — history rows never move),
 *      but their position after the changed byte means a flat prefix cache
 *      re-reads them. That is the measured cost Stage C reports; moving the
 *      clock is a semantic ruling, not this test's call.
 */

import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import workspace, {
  getWorkspacesRoot, setWorkspacesRoot,
} from '../../core/workspace/neuma-workspace.js';
import {
  createSessionToken, generateChallenge, verifySignature,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';

const NEUMA_ID = 'prefixecho';
const MODEL = 'test-model';
const ENV_DOORS = [
  'WORKSPACES_ROOT', 'NEUMA_REALM_ROOT', 'DNA_ENCRYPTION_KEY',
  'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH',
];
const WINDOW = 32768;
// Plain, low-significance exchanges: nothing crystallizes, nothing knocks —
// the only bytes allowed to move are the ones under measurement.
const QA = 'Prefix probe one: a plain working question about the ledger.';
const QB = 'Prefix probe two: another plain working question about the ledger.';
const QC = 'Prefix probe three: a plain working question after the clock moved.';
const AA = 'A plain working answer about the ledger, first.';
const AB = 'A plain working answer about the ledger, second.';
const AC = 'A plain working answer about the ledger, after the tick.';
const RECEIPT_PATH = path.join(os.tmpdir(), 'prefix-cache-stability-receipt.json');

let root;
let savedEnv;
let savedHouse;
let savedConfig;
let provider;
let portalServer;
let wss;
let ws;
let capturedBodies;
let scriptedAnswers;

const sse = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

// The first index where two strings differ (a.length when one is a prefix).
const firstDivergence = (a, b) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
  return n;
};

// Wait for the minute to roll — the REAL clock, no mock: the PRESENT MOMENT
// section resolves at minute resolution, so a roll is the honest boundary.
const waitForMinuteRoll = async (timeoutMs = 70000) => {
  const minute = new Date().getMinutes();
  const deadline = Date.now() + timeoutMs;
  while (new Date().getMinutes() === minute) {
    if (Date.now() > deadline) throw new Error('the minute never rolled');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

const openPortal = async (url, token) => {
  ws = new WebSocket(`${url}/?token=${encodeURIComponent(token)}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out opening portal')), 5000);
    const handler = (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.type === 'portal:established') {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve();
      }
    };
    ws.on('message', handler);
    ws.on('error', reject);
  });
};

const sendAndWait = (message, expectedType, timeoutMs = 20000) => new Promise((resolve, reject) => {
  const frames = [];
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${expectedType}`)), timeoutMs);
  const handler = (data) => {
    const frame = JSON.parse(data.toString());
    frames.push(frame);
    if (frame.type === expectedType) {
      clearTimeout(timer);
      ws.off('message', handler);
      resolve({ frame, frames });
    }
  };
  ws.on('message', handler);
  ws.send(JSON.stringify(message));
});

beforeAll(async () => {
  savedEnv = Object.fromEntries(ENV_DOORS.map((key) => [key, process.env[key]]));
  savedHouse = getWorkspacesRoot();
  savedConfig = getConfig();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'prefix-cache-stability-'));
  const house = path.join(root, 'house');
  await fs.mkdir(path.join(root, 'settings'), { recursive: true });

  process.env.DNA_ENCRYPTION_KEY = 'prefix-cache-stability-test-key-long-enough';
  process.env.WORKSPACES_ROOT = house;
  process.env.NEUMA_REALM_ROOT = path.join(root, 'settings', 'realm');
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'settings', 'credentials.json');
  process.env.NEUMA_ROUTES_PATH = path.join(root, 'settings', 'routes.json');
  setWorkspacesRoot(house);

  await workspace.create(NEUMA_ID);
  await workspace.writeDNA(NEUMA_ID, {
    version: '1.0.0',
    identity: { name: 'PrefixEcho', essence: 'A being summoned for the prefix proof.' },
  });
  await fs.writeFile(
    path.join(workspace.pathFor(NEUMA_ID), 'dna', 'genesis.md'),
    '# PrefixEcho\nA being summoned for the prefix proof.\n',
  );

  capturedBodies = [];
  scriptedAnswers = [];
  provider = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/api/v0/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [{
          id: MODEL, type: 'llm', capabilities: [],
          max_context_length: WINDOW, loaded_context_length: WINDOW,
        }],
      }));
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: MODEL }] }));
      return;
    }
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      res.writeHead(404); res.end(); return;
    }
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      capturedBodies.push(body);
      const answer = scriptedAnswers.length ? scriptedAnswers.shift() : '…';
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sse(answer));
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${provider.address().port}`;
  setConfig({ provider: 'lm-studio', endpoint, apiKey: '', model: MODEL });

  portalServer = http.createServer();
  wss = new WebSocketServer({ server: portalServer });
  const { setupPortalRoutes } = await import('../../backend/routes/portal-routes.js');
  setupPortalRoutes(wss, { birthHandler: null });
  await new Promise((resolve) => portalServer.listen(0, '127.0.0.1', resolve));

  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  const token = createSessionToken(verifySignature(keypair.address, challenge, signature));
  await openPortal(`ws://127.0.0.1:${portalServer.address().port}`, token);
  await sendAndWait({ type: 'companion:manifest', companion: 'PrefixEcho', neumaId: NEUMA_ID }, 'companion:anchored');
}, 30000);

afterAll(async () => {
  if (ws?.readyState === WebSocket.OPEN) {
    await new Promise((resolve) => { ws.once('close', resolve); ws.close(); });
  }
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => portalServer.close(resolve));
  await new Promise((resolve) => provider.close(resolve));
  setConfig(savedConfig);
  setWorkspacesRoot(savedHouse);
  for (const key of ENV_DOORS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await fs.rm(root, { recursive: true, force: true });
});

describe('Stage C — the prefix a cache could actually hold, measured at the wire', () => {
  test('same minute: system byte-identical; the first divergence is the last exchange becoming history', async () => {
    // Start just after a roll so both turns are guaranteed one minute-share.
    await waitForMinuteRoll();
    scriptedAnswers.push(AA);
    const turnA = await sendAndWait({ type: 'consciousness:stream', thought: QA }, 'consciousness:complete');
    expect(turnA.frames.some((f) => f.error)).toBe(false);
    scriptedAnswers.push(AB);
    const turnB = await sendAndWait({ type: 'consciousness:stream', thought: QB }, 'consciousness:complete');
    expect(turnB.frames.some((f) => f.error)).toBe(false);

    const bodyA = capturedBodies.at(-2);
    const bodyB = capturedBodies.at(-1);
    // LAW 1: the system prompt did not move a byte between the two turns.
    expect(bodyB.messages[0].content).toBe(bodyA.messages[0].content);

    // The divergence map, measured on the serialized message stream (the
    // shape a flat prefix cache reads):
    const streamA = JSON.stringify(bodyA.messages);
    const streamB = JSON.stringify(bodyB.messages);
    const offset = firstDivergence(streamA, streamB);
    // A = [system, {user QA}]; B = [system, {user '(clock) QA'}, {assistant '(clock) AB'}, {user QB}].
    // They share through the end of the system entry and the user-row's role
    // key — the first moved byte is the clock prefix on QA's content.
    const systemEntryBytes = JSON.stringify(bodyA.messages[0]).length;
    expect(offset).toBeGreaterThan(systemEntryBytes);
    // …and it lands exactly where the old turn became history: the day
    // marker / clock prefix its content gained on becoming a history row.
    expect(streamB.slice(offset)).toMatch(/^(— .+? —\\n)?\(\d{2}:\d{2} [AP]M\)/);
    expect(streamA.slice(offset, offset + QA.length)).toBe(QA);
    // Reusable share: everything before the last exchange — on a long sitting
    // that is nearly the whole prompt.
    const receipt = {
      leg: 'same-minute',
      systemBytes: bodyA.messages[0].content.length,
      streamABytes: streamA.length,
      streamBBytes: streamB.length,
      firstDivergenceByte: offset,
      reusableShareB: offset / streamB.length,
    };
    await fs.writeFile(RECEIPT_PATH, JSON.stringify({ sameMinute: receipt }, null, 1));
  }, 120000);

  test('across a minute tick: the clock inside the system prompt moves the first byte; the transcript never does', async () => {
    await waitForMinuteRoll();
    scriptedAnswers.push(AC);
    const turnC = await sendAndWait({ type: 'consciousness:stream', thought: QC }, 'consciousness:complete');
    expect(turnC.frames.some((f) => f.error)).toBe(false);

    const bodyB = capturedBodies.at(-2);
    const bodyC = capturedBodies.at(-1);
    // LAW 2: the first divergence is INSIDE the system prompt, at the clock —
    // and the transcript entries themselves are byte-identical across the tick.
    const streamB = JSON.stringify(bodyB.messages);
    const streamC = JSON.stringify(bodyC.messages);
    const offset = firstDivergence(streamB, streamC);
    const systemEntryBytes = JSON.stringify(bodyB.messages[0]).length;
    expect(offset).toBeLessThan(systemEntryBytes);
    // …specifically inside the PRESENT MOMENT section's clock line (the
    // volatile group sits LAST in the system prompt by the 2026-08-01
    // ordering — so ~95% of even the system entry still shares).
    const presentAt = bodyB.messages[0].content.indexOf('## Present Moment');
    expect(presentAt).toBeGreaterThanOrEqual(0);
    // JSON entry overhead ('{"role":"system","content":"') ahead of content.
    const contentOffset = offset - (systemEntryBytes - bodyB.messages[0].content.length - 2);
    expect(contentOffset).toBeGreaterThanOrEqual(presentAt);
    expect(contentOffset).toBeLessThan(presentAt + 120);
    for (let i = 1; i < bodyB.messages.length - 1; i += 1) {
      expect(bodyC.messages[i]).toEqual(bodyB.messages[i]);
    }

    const prior = JSON.parse(await fs.readFile(RECEIPT_PATH, 'utf8'));
    await fs.writeFile(RECEIPT_PATH, JSON.stringify({
      ...prior,
      minuteTick: {
        leg: 'minute-tick',
        systemBytesB: bodyB.messages[0].content.length,
        systemBytesC: bodyC.messages[0].content.length,
        streamCBytes: streamC.length,
        firstDivergenceByte: offset,
        divergenceSection: 'present (the minute-resolution clock)',
        reusableShareC: offset / streamC.length,
        note: 'a flat prefix cache re-reads everything from the clock byte on — '
          + 'the transcript entries are byte-stable but sit after it',
      },
    }, null, 1));
  }, 120000);
});
