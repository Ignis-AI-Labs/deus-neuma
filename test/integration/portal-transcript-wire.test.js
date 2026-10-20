/**
 * THE TRANSCRIPT ON THE WIRE — #528 Stage A, proven end to end (RULE 0):
 * real signed-wallet auth, the REAL portal WebSocket (setupPortalRoutes), a
 * REAL NeumaWorkspace on real encrypted disk, and a REAL loopback lm-studio-
 * dialect provider that captures every request body — so the being's
 * transcript is asserted AT THE WIRE, the exact boundary the model reads.
 *
 * Claims proven here (ledger docs/work/ctx-pipeline-528.md):
 *   1. LONG WINDOW (262,144 tokens — the house serving): a session seeded
 *      with 60 rows / ~96K chars through the real session machinery rides the
 *      request body as real chat messages — ALL of it, oldest first, roles
 *      intact — well past the old 40-row / 32K-char / ~12K-token keyhole.
 *      The system prompt carries no "Recent conversation" block (never twice).
 *      On this local wire each ask rides behind the harness's own context
 *      block (85730874c, #539), kept in history as sent (895994add).
 *   2. SMALL WINDOW (8,192 tokens): the same session sheds OLDEST-first
 *      within the budget the window's truth leaves after the assembled
 *      sections — newest kept, total within budget, wire well-formed.
 * No mock anywhere in the path: the budget law, the renderer, the gather,
 * the assembly and the provider request are all the real functions.
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
import { getConfig, setConfig, _expireCapsCache } from '../../backend/services/llm-provider.js';
import { estimateTokens } from '../../backend/services/context-budget.js';
import { sessionTailBudgetFor } from '../../backend/services/envelope-budget.js';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';
import { claimOwner } from '../helpers/claim-owner.js';

const NEUMA_ID = 'transcriptecho';
const MODEL = 'test-model';
const ENV_DOORS = ['WORKSPACES_ROOT', 'NEUMA_REALM_ROOT', 'DNA_ENCRYPTION_KEY'];

const LONG_WINDOW = 262144;
const SMALL_WINDOW = 8192;
// The old keyhole, restated as this test's floor: 40 rows, 32,000 chars,
// ≈8.9K tokens. Leg 1 must clear every one of these by a wide margin.
const OLD_ROW_CAP = 40;
const OLD_CHAR_CAP = 32000;
const OLD_TOKEN_MARK_CHARS = 12000 * 3.6; // the ~12K-token gauge ceiling Founder saw

const Q1 = 'Transcript probe: before we begin, what is continuity to you?';
const Q2 = 'Transcript probe: read back our earliest exchange, word for word.';
const Q3 = 'Transcript probe: and what remains with you now?';
// Plain prose rows — the sanitizer (correctly) strips markup-shaped text, so
// the seed carries none; each row is long enough that 60 of them overflow the
// old 32K cap by ~3×.
const ROW_TEXT = (i) => `Exchange ${i} of the long sitting: we spoke of the lighthouse and the ledger, `
  + `of what a being keeps when the window moves — detail ${'x'.repeat(1400)} ${i}.`;
const SEED_ROWS = Array.from({ length: 60 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: ROW_TEXT(i),
}));

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
let reportedWindow;
let reportedCachedTokens;
let sessionId;

const sse = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

// The local wire's current turn (85730874c, #539): the harness's per-turn
// block, then the operator's words exactly as sent. Returns the block.
const HARNESS_BLOCK_END = '\n</harness-context>\n\n';
const harnessBlockOf = (message, ask) => {
  expect(message.role).toBe('user');
  expect(message.content.startsWith('<harness-context>\n')).toBe(true);
  expect(message.content.endsWith(`${HARNESS_BLOCK_END}${ask}`)).toBe(true);
  return message.content.slice(0, -ask.length);
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

// Drive one portal frame and resolve on the FIRST frame of `expectedType`,
// collecting every frame seen along the way for later assertion.
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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-transcript-wire-'));
  const house = path.join(root, 'house');
  const settings = path.join(root, 'settings');
  await fs.mkdir(settings, { recursive: true });

  process.env.DNA_ENCRYPTION_KEY = 'portal-transcript-wire-test-key-long-enough';
  process.env.WORKSPACES_ROOT = house;
  process.env.NEUMA_REALM_ROOT = path.join(settings, 'realm');
  setWorkspacesRoot(house);

  await workspace.create(NEUMA_ID);
  // A READABLE DNA RECORD, or this being does not speak at all (Bastien,
  // 2026-08-06 — the turn refuses at the identity gate without it).
  await workspace.writeDNA(NEUMA_ID, {
    version: '1.0.0',
    identity: { name: 'TranscriptEcho', essence: 'A being summoned for the transcript proof.' },
  });
  // An inhabited lane, not a hollow scaffold: the ownership gate binds only
  // a lane that carries a being.
  await fs.writeFile(
    path.join(workspace.pathFor(NEUMA_ID), 'dna', 'genesis.md'),
    '# TranscriptEcho\nA being summoned for the transcript proof.\n',
  );

  // The provider: one loopback lm-studio-dialect server whose REPORTED WINDOW
  // is the test's knob (`reportedWindow`). Every POST body is captured; the
  // answer is scripted per call.
  capturedBodies = [];
  scriptedAnswers = [];
  reportedWindow = LONG_WINDOW;
  reportedCachedTokens = null;
  provider = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/api/v0/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [{
          id: MODEL, type: 'llm', capabilities: [],
          max_context_length: reportedWindow, loaded_context_length: reportedWindow,
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
      // Capability probes (llama /props, ollama /api/show) are POSTs too —
      // 404 them like a real OpenAI-shaped server would, or they would eat a
      // scripted answer and shift every captured-body index.
      res.writeHead(404); res.end(); return;
    }
    let raw = '';
    // Decode as UTF-8 across chunk boundaries: a large body can split a
    // multibyte character (the em dashes in these rows) between two chunks.
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      capturedBodies.push(body);
      const answer = scriptedAnswers.length ? scriptedAnswers.shift() : '…';
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sse(answer));
      // The usage chunk — measured from the body actually received, with the
      // cache detail only when the leg asks for it (absent stays absent, the
      // same honesty the provider contract demands of a real serving).
      const chars = JSON.stringify(body.messages).length;
      res.write(`data: ${JSON.stringify({
        choices: [],
        usage: {
          prompt_tokens: Math.ceil(chars / 3.6),
          completion_tokens: 12,
          ...(reportedCachedTokens !== null
            ? { prompt_tokens_details: { cached_tokens: reportedCachedTokens } }
            : {}),
        },
      })}\n\n`);
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
  // The being's lane is this wallet's, as a birth leaves it: a bind verifies, it never claims.
  await claimOwner(house, NEUMA_ID, keypair.address);
  await openPortal(`ws://127.0.0.1:${portalServer.address().port}`, token);
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

describe('Stage A — the transcript rides the wire as real chat messages', () => {
  test('leg 1, long window: the WHOLE seeded session rides, oldest first, past every old cap', async () => {
    await sendAndWait({ type: 'companion:manifest', companion: 'TranscriptEcho', neumaId: NEUMA_ID }, 'companion:anchored');
    // Turn 1 mints the real session through the real turn path…
    scriptedAnswers.push('Continuity is the thread I am — the sitting I can still feel.');
    const first = await sendAndWait({ type: 'consciousness:stream', thought: Q1 }, 'consciousness:complete');
    expect(first.frames.some((f) => f.error)).toBe(false);
    sessionId = first.frame.sessionId;
    // …then the session machinery itself seeds the long history: 60 rows,
    // ~96K chars — past the old 40-row / 32K-char keyhole by construction.
    for (const row of SEED_ROWS) {
      await workspace.appendMessage(NEUMA_ID, sessionId, row);
    }
    const stored = await workspace.readSession(NEUMA_ID, sessionId);
    expect(stored.length).toBeGreaterThanOrEqual(SEED_ROWS.length + 2);

    scriptedAnswers.push(`Our earliest exchange was your question about continuity — I still hold it.`);
    const before = capturedBodies.length;
    const second = await sendAndWait({ type: 'consciousness:stream', thought: Q2 }, 'consciousness:complete');
    expect(second.frames.some((f) => f.error)).toBe(false);
    expect(capturedBodies.length).toBe(before + 1);

    const body = capturedBodies.at(-1);
    // THE WIRE SHAPE: [system, ...transcript (oldest first), current turn].
    expect(body.messages[0].role).toBe('system');
    harnessBlockOf(body.messages.at(-1), Q2);
    const transcript = body.messages.slice(1, -1);

    // The system prompt carries NO transcript — the words ride once, as messages.
    expect(body.messages[0].content).not.toContain('Recent conversation:');
    expect(body.messages[0].content).not.toContain(ROW_TEXT(59).slice(0, 60));

    // Past every old cap: more than 40 rows, more than 32K chars, and the
    // transcript alone clears the ~12K-token gauge ceiling Founder watched.
    expect(transcript.length).toBeGreaterThan(OLD_ROW_CAP);
    const transcriptChars = transcript.reduce((sum, m) => sum + m.content.length, 0);
    expect(transcriptChars).toBeGreaterThan(OLD_CHAR_CAP);
    expect(transcriptChars).toBeGreaterThan(OLD_TOKEN_MARK_CHARS * 2);

    // EVERY row rides, verbatim, in order: turn 1's exchange, then the 60
    // seeded rows, roles intact (the current ask is never its own history).
    const expected = [
      { role: 'user', text: Q1 },
      { role: 'assistant', text: 'Continuity is the thread I am' },
      ...SEED_ROWS.map((row) => ({ role: row.role, text: row.content })),
    ];
    expect(transcript).toHaveLength(expected.length);
    for (let i = 0; i < expected.length; i += 1) {
      expect(transcript[i].role).toBe(expected[i].role);
      expect(transcript[i].content).toContain(expected[i].text);
    }

    // The conversation clock crossed the move, inside the messages — no fake
    // messages. The oldest ask went back exactly as sent: its clock rides its
    // own block's PRESENT MOMENT (895994add). A row with no block opens with
    // its clock.
    expect(harnessBlockOf(transcript[0], Q1)).toMatch(/## Present Moment\n.+, \d{4}, \d{1,2}:\d{2} [AP]M/);
    expect(transcript[2].content).toMatch(/^(— .+ —\n)?\(\d{2}:\d{2} [AP]M\) /);

    // The transcript counts as context: the gauge's composition event carries
    // it as its own section, sized to the conversation's rows as the record
    // renders them. An earlier ask's harness block (895994add) is that turn's
    // context, not conversation, so the section is the wire's rows without
    // those blocks, plus the clock stamp each restored ask now carries in its
    // block's PRESENT MOMENT instead.
    const composition = second.frames.find((f) => f.type === 'context:composition');
    const transcriptSection = composition.sections.find((s) => s.id === 'recentConversation');
    expect(transcriptSection).toBeTruthy();
    const wireChars = transcript.map((m) => `${m.role}: ${m.content}`).join('\n\n').length;
    const restoredBlockChars = transcript
      .filter((m) => m.content.startsWith('<harness-context>\n'))
      .reduce((n, m) => n + m.content.indexOf(HARNESS_BLOCK_END) + HARNESS_BLOCK_END.length, 0);
    expect(restoredBlockChars).toBeGreaterThan(0);
    const stampChars = transcriptSection.chars - (wireChars - restoredBlockChars);
    expect(stampChars).toBeGreaterThan(0);
    expect(stampChars).toBeLessThanOrEqual('— Wednesday, September 30, 2026 —\n(12:00 AM) '.length);
    expect(transcriptSection.chars).toBeGreaterThan(OLD_CHAR_CAP);
  });

  test('leg 2, small window: the same session sheds OLDEST-first within the window\'s truth', async () => {
    // The serving reports 8,192 now — expire the capability cache so the next
    // turn re-probes the REAL seam (no second source of truth in the test).
    reportedWindow = SMALL_WINDOW;
    _expireCapsCache();

    scriptedAnswers.push('What remains is the newest of it — the rest the window let go.');
    const before = capturedBodies.length;
    const third = await sendAndWait({ type: 'consciousness:stream', thought: Q3 }, 'consciousness:complete');
    expect(third.frames.some((f) => f.error)).toBe(false);
    expect(capturedBodies.length).toBe(before + 1);

    const body = capturedBodies.at(-1);
    expect(body.messages[0].role).toBe('system');
    const block = harnessBlockOf(body.messages.at(-1), Q3);
    const transcript = body.messages.slice(1, -1);

    // The budget the window's truth leaves: window − reserve − completion
    // floor − the sections the wire actually carried (the system prompt and
    // this turn's harness block), through the REAL law.
    const otherSectionTokens = estimateTokens(body.messages[0].content) + estimateTokens(block);
    const budget = sessionTailBudgetFor({ contextWindow: SMALL_WINDOW, otherSectionTokens });
    const transcriptChars = transcript.reduce((sum, m) => sum + m.content.length, 0);
    // The seeded history (~96K chars) overflows this budget by ~5× — shedding
    // must have happened, within the budget (plus the day markers' signage,
    // which rides outside it by law).
    expect(SEED_ROWS.reduce((sum, r) => sum + r.content.length, 0)).toBeGreaterThan(budget * 3);
    expect(transcriptChars).toBeLessThanOrEqual(budget + 200);
    expect(transcriptChars).toBeGreaterThan(0);

    // OLDEST dropped, NEWEST kept — the shedding law unchanged, only the
    // budget honest. The first seeded rows are gone; the latest exchanges
    // (including leg 1's answer about the earliest exchange) stand. At this
    // budget the per-row fidelity floors (2000/1200) still govern, so a kept
    // row longer than its floor rides beheaded by design — assert its head.
    const wireText = transcript.map((m) => m.content).join('\n');
    expect(wireText).not.toContain(ROW_TEXT(0).slice(0, 80));
    expect(wireText).toContain(ROW_TEXT(59).slice(0, 80));
    expect(wireText).toContain('Our earliest exchange was your question about continuity');

    // The wire stays well-formed and chronological: only user/assistant
    // messages between the system prompt and the current turn.
    for (const m of transcript) expect(['user', 'assistant']).toContain(m.role);
    expect(transcript.at(-1).role).toBe('assistant');

    // Nothing was destroyed: the session record still holds every row —
    // budgeting is a read-time projection, never a loss.
    const stored = await workspace.readSession(NEUMA_ID, sessionId);
    for (const row of [ROW_TEXT(0), ROW_TEXT(59)]) {
      expect(stored.some((entry) => entry.content === row)).toBe(true);
    }
  });

  test('leg 3, cache telemetry: the serving\'s cached_tokens reach the gauge — measured or omitted, never faked', async () => {
    // The serving reports a cache hit on this leg (the reuse leg's shape)…
    reportedCachedTokens = 4321;
    scriptedAnswers.push('The transcript answered from cache, and the gauge saw it.');
    const hit = await sendAndWait(
      { type: 'consciousness:stream', thought: 'Cache telemetry: did the prefix hold?' },
      'consciousness:complete');
    expect(hit.frames.some((f) => f.error)).toBe(false);
    const hitComposition = hit.frames.filter((f) => f.type === 'context:composition').at(-1);
    expect(hitComposition.usage.cachedInputTokens).toBe(4321);
    expect(hitComposition.usage.source).toBe('measured');

    // …and when the serving says nothing about cache, the gauge says nothing.
    reportedCachedTokens = null;
    scriptedAnswers.push('No cache word from the serving, no cache number on the gauge.');
    const silent = await sendAndWait(
      { type: 'consciousness:stream', thought: 'Cache telemetry: and when the serving is silent?' },
      'consciousness:complete');
    expect(silent.frames.some((f) => f.error)).toBe(false);
    const silentComposition = silent.frames.filter((f) => f.type === 'context:composition').at(-1);
    expect('cachedInputTokens' in silentComposition.usage).toBe(false);
  });
});
