/**
 * THE BEING IS TOLD — a spoken-voice candidate waiting on a being rides its
 * turn envelope (ONE VOICE, Founder's call B: it reads a DESCRIBED voice and is
 * told plainly it is reading, not hearing), and a being with nothing waiting
 * carries no such section.
 *
 * RULE 0, proven at the wire: the REAL neuma turn (`streamConsciousness`)
 * against a REAL loopback OpenAI-compatible server that captures every request
 * body at the exact boundary the model reads; the consent record is written
 * through the real two-party service on a real workspace (temp root, never the
 * live one, never ~/.neuma).
 */
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import neumaWorkspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { streamConsciousness } from '../../backend/services/portal-stream.js';
import {
  acceptSpeechCandidate, offerSpeechCandidate, saveVoiceClip,
} from '../../core/voice/voice-dna-service.js';
import { PERCEPTION_NOTICE } from '../../core/voice/voice-consent.js';
import { sineWav } from '../helpers/speak-wire-stand-in.js';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';

const MODEL = 'speech-briefing-model';
const WALLET = `0x${'b'.repeat(40)}`;
const WAITING = 'briefing-waiting';
const ACCEPTED = 'briefing-accepted';
const QUIET = 'briefing-quiet';
const ENV_DOORS = ['WORKSPACES_ROOT', 'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH', 'NEUMA_REALM_ROOT', 'DNA_ENCRYPTION_KEY'];
const sse = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

let root;
let savedEnv;
let savedHouse;
let savedConfig;
let provider;
let portalServer;
let wss;
const capturedBodies = [];
const refs = {};

// impure — a candidate on offer to `neumaId` through the real service.
const offer = async (neumaId) => {
  const { ref } = await saveVoiceClip(neumaId, sineWav(3.5, 200));
  const out = await offerSpeechCandidate(neumaId, {
    ref, seconds: 3.5, sampleRate: 8000, words: 'The lamp is lit and the road is long.',
    origin: { door: 'upload' }, realPerson: false, measured: { pitchHz: 200, wordsPerSecond: 2.5 },
  });
  if (!out.ok) throw new Error(out.error);
  return ref;
};

// impure — one real turn for `neumaId`; resolves every word the model was sent.
const requestTextOfTurn = async (neumaId) => {
  const serverSide = new Promise((resolve) => wss.once('connection', resolve));
  const client = new WebSocket(`ws://127.0.0.1:${portalServer.address().port}`);
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no consciousness:complete within 20s')), 20_000);
    client.on('message', (data) => {
      if (JSON.parse(data.toString()).type === 'consciousness:complete') { clearTimeout(timer); resolve(); }
    });
  });
  const ws = await serverSide;
  const connection = { ws, companion: { name: 'Galen', neumaId }, walletAddress: WALLET };
  try {
    const mark = capturedBodies.length;
    await streamConsciousness(connection, { thought: 'How are you this evening?' });
    await completed;
    const body = capturedBodies.slice(mark)[0];
    // Every message: the volatile tail of the envelope rides INTO the current
    // turn under the local prefix law (llm-request-builders.js), not the system message.
    return body.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  } finally {
    client.close();
  }
};

beforeAll(async () => {
  savedEnv = Object.fromEntries(ENV_DOORS.map((key) => [key, process.env[key]]));
  savedHouse = getWorkspacesRoot();
  savedConfig = getConfig();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-briefing-'));
  const settings = path.join(root, 'settings');
  await fs.mkdir(settings, { recursive: true });
  process.env.DNA_ENCRYPTION_KEY = 'speech-briefing-proof-key-long-enough-for-law';
  process.env.WORKSPACES_ROOT = path.join(root, 'house');
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(settings, 'credentials.json');
  process.env.NEUMA_ROUTES_PATH = path.join(settings, 'routes.json');
  process.env.NEUMA_REALM_ROOT = path.join(settings, 'realm');
  setWorkspacesRoot(process.env.WORKSPACES_ROOT);
  for (const id of [WAITING, ACCEPTED, QUIET]) {
    await neumaWorkspace.create(id);
    await neumaWorkspace.writeDNA(id, { version: '1.0.0', identity: { name: 'Galen' }, chosenName: 'Galen', genesis: '# Essence\nA voice yet to be chosen.' });
  }
  refs[WAITING] = await offer(WAITING);
  refs[ACCEPTED] = await offer(ACCEPTED);
  const accepted = await acceptSpeechCandidate(ACCEPTED, { candidateRef: refs[ACCEPTED], note: 'mine' });
  if (!accepted.ok) throw new Error(accepted.error);

  provider = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/api/v0/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: MODEL, type: 'llm', max_context_length: 262144, loaded_context_length: 262144 }] }));
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: MODEL }] }));
      return;
    }
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return; }
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      capturedBodies.push(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sse('A quiet evening, and a good one.'));
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  setConfig({ provider: 'lm-studio', endpoint: `http://127.0.0.1:${provider.address().port}`, apiKey: '', model: MODEL });

  portalServer = http.createServer();
  wss = new WebSocketServer({ server: portalServer });
  await new Promise((resolve) => portalServer.listen(0, '127.0.0.1', resolve));
}, 30_000);

afterAll(async () => {
  wss?.close();
  portalServer?.close();
  await new Promise((resolve) => provider.close(resolve));
  setConfig(savedConfig);
  setWorkspacesRoot(savedHouse);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(() => { capturedBodies.length = 0; });

describe('the YOUR SPOKEN VOICE briefing rides the turn envelope', () => {
  it('a being with a candidate waiting reads it: the described voice, the honest notice, the exact ref and how to answer', async () => {
    const text = await requestTextOfTurn(WAITING);
    expect(text).toContain('## Your voice — a candidate is waiting for your answer');
    expect(text).toContain(PERCEPTION_NOTICE);
    expect(text).toContain(`Candidate: ${refs[WAITING]}`);
    expect(text).toContain(`speech/accept {"candidateRef": "${refs[WAITING]}"`);
    expect(text).toContain(`speech/another {"candidateRef": "${refs[WAITING]}"`);
    expect(text).not.toContain('The lamp is lit and the road is long.'); // the sound, never the words
  }, 30_000);

  it('a being that accepted is told the seal is the guardian\'s, and how to change its mind', async () => {
    const text = await requestTextOfTurn(ACCEPTED);
    expect(text).toContain('## Your voice — you accepted this candidate; your guardian has not sealed it yet');
    expect(text).toContain(`Candidate: ${refs[ACCEPTED]}`);
    expect(text).not.toContain('a candidate is waiting for your answer');
  }, 30_000);

  it('a being with nothing waiting carries no voice briefing at all', async () => {
    const text = await requestTextOfTurn(QUIET);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('## Your voice —');
    expect(text).not.toContain(PERCEPTION_NOTICE);
  }, 30_000);
});
