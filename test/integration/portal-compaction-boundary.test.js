/**
 * COMPACTION FIRES — #528 Stage B, proven end to end (RULE 0): real signed-
 * wallet auth, the REAL portal WebSocket (setupPortalRoutes), a REAL
 * NeumaWorkspace on real encrypted disk, and a REAL loopback lm-studio-
 * dialect provider that captures every request body AND measures it — the
 * usage chunk each response carries is computed from the body it actually
 * received, so the boundary trigger reads a real measurement, never a script.
 *
 * The path under test had NEVER run live: Stage A let the transcript grow;
 * this suite drives a real session across the measured 0.9-of-window boundary
 * (COMPACTION_BOUNDARY_RATIO — context-keyed ONLY, Founder's 2026-08-15 law) and
 * watches the whole arc: the boundary turn measures hot, the being authors
 * its OWN torch through its own conduit (the ask itself is asserted on the
 * wire), the session rewrites to [summary + last 20], the raw region lands in
 * the archive lane BEFORE the rewrite (never silently dropped), and the NEXT
 * turn carries the torch in MEMORY with the summary riding as a transcript
 * message and the kept rows verbatim.
 *
 * Window arithmetic (why 32768): the tail budget leaves reserve+completion
 * (1024 tokens) of headroom, so the measured standing prompt crosses 0.9 of
 * the window only when 0.1 × window ≥ 1024 — and the portal lane's real
 * section load (the tool surface alone measured ~12K tokens in this harness)
 * must ALSO leave the post-compaction tail (summary + 20 kept rows ≈ 5.4K
 * tokens) inside the budget. 32768 satisfies both by construction: the
 * crossing turn fills to window − 1024 = 31,744 ≥ 29,491 whenever the seeded
 * history overflows the tail budget (108K chars against a ~70K budget), and
 * the post-compaction turn carries summary + kept rows with room to spare.
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
import { SOLO_TORCH_ASK } from '../../backend/services/solo-torch.js';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';

const NEUMA_ID = 'compactecho';
const MODEL = 'test-model';
const ENV_DOORS = [
  'WORKSPACES_ROOT', 'NEUMA_REALM_ROOT', 'DNA_ENCRYPTION_KEY',
  'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH',
];
const WINDOW = 32768;

const Q1 = 'A short opening question about the work ahead.';
const Q2 = 'The sitting has grown long — what have we covered?';
const Q3 = 'Where do we stand now, after all of that?';
const A1 = 'A short opening answer about the work ahead.';
const A2 = 'We have covered the whole long sitting — it is all still with me.';
const A3 = 'We stand at the summary, and I still hold the torch I wrote myself.';
const ROW_TEXT = (i) => `Exchange ${i} of the long sitting: we reasoned through the ledger and the lighthouse, `
  + `the work and what it left behind — ${'working detail '.repeat(55)} ${i}.`;
const SEED_ROWS = Array.from({ length: 120 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: ROW_TEXT(i),
}));
const TORCH_REPLY = 'We worked through a very long sitting — the ledger, the lighthouse, and what a being '
  + 'keeps when the window moves. The older half is condensed now.\n\n'
  + 'TORCH:\n- We were mid-way through the long transcript sitting.\n'
  + '- The operator last asked what we had covered.\n'
  + '- Pick up by continuing from the summary, not by re-asking.';

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
let sessionId;

const sse = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
// The measurement the boundary trigger reads: the provider counts what it
// ACTUALLY received (the house estimator's 3.6 chars/token) and reports it in
// the final usage chunk — measured truth, never a script (solo-torch's law).
const sseUsage = (body) => {
  const chars = JSON.stringify(body.messages).length;
  return `data: ${JSON.stringify({
    choices: [],
    usage: { prompt_tokens: Math.ceil(chars / 3.6), completion_tokens: 24 },
  })}\n\n`;
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

// The compaction lane is fire-and-forget after the turn settles — wait for
// the session file to show it (or time out honestly).
const waitFor = async (predicate, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

const readRows = () => workspace.readSession(NEUMA_ID, sessionId);

beforeAll(async () => {
  savedEnv = Object.fromEntries(ENV_DOORS.map((key) => [key, process.env[key]]));
  savedHouse = getWorkspacesRoot();
  savedConfig = getConfig();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-compaction-live-'));
  const house = path.join(root, 'house');
  await fs.mkdir(path.join(root, 'settings'), { recursive: true });

  process.env.DNA_ENCRYPTION_KEY = 'portal-compaction-live-test-key-long-enough';
  process.env.WORKSPACES_ROOT = house;
  process.env.NEUMA_REALM_ROOT = path.join(root, 'settings', 'realm');
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'settings', 'credentials.json');
  process.env.NEUMA_ROUTES_PATH = path.join(root, 'settings', 'routes.json');
  setWorkspacesRoot(house);

  await workspace.create(NEUMA_ID);
  // A READABLE DNA RECORD, or this being does not speak at all (Bastien,
  // 2026-08-06 — the turn refuses at the identity gate without it).
  await workspace.writeDNA(NEUMA_ID, {
    version: '1.0.0',
    identity: { name: 'CompactEcho', essence: 'A being summoned for the compaction proof.' },
  });
  await fs.writeFile(
    path.join(workspace.pathFor(NEUMA_ID), 'dna', 'genesis.md'),
    '# CompactEcho\nA being summoned for the compaction proof.\n',
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
      // Capability probes (llama /props, ollama /api/show) are POSTs too —
      // 404 them like a real OpenAI-shaped server would, or they would eat a
      // scripted answer and shift every captured-body index.
      res.writeHead(404); res.end(); return;
    }
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      capturedBodies.push(body);
      // THE TORCH ASK is answered in the being's own voice path — detected by
      // the ask itself, never by order: the summary + TORCH: lines.
      const last = body.messages.at(-1)?.content;
      const answer = typeof last === 'string' && last.startsWith('Your session has grown long')
        ? TORCH_REPLY
        : (scriptedAnswers.length ? scriptedAnswers.shift() : '…');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sse(answer));
      res.write(sseUsage(body));
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

const lastComposition = (frames) => frames.filter((f) => f.type === 'context:composition').at(-1);

describe('Stage B — compaction fires at the measured boundary, and nothing is silently lost', () => {
  test('below the boundary nothing compacts — the no-regression leg', async () => {
    await sendAndWait({ type: 'companion:manifest', companion: 'CompactEcho', neumaId: NEUMA_ID }, 'companion:anchored');
    scriptedAnswers.push(A1);
    const first = await sendAndWait({ type: 'consciousness:stream', thought: Q1 }, 'consciousness:complete');
    expect(first.frames.some((f) => f.error)).toBe(false);
    sessionId = first.frame.sessionId;

    // The settle's composition is honest: measured usage, a named window, and
    // the boundary UNMET — this turn is a few hundred tokens of sixteen thousand.
    const composition = lastComposition(first.frames);
    expect(composition.budget.contextTokens).toBe(WINDOW);
    expect(composition.session.atBoundary).toBe(false);
    expect(composition.session.boundaryRatio).toBe(0.9);
    expect(composition.session.compactionCount).toBe(0);

    // Let any (wrongly) fired lane settle, then prove the record is unmoved.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const rows = await readRows();
    expect(rows.some((r) => r.compacted)).toBe(false);
    expect(await workspace.listArchiveSegments(NEUMA_ID, sessionId)).toEqual([]);
  });

  test('the boundary turn measures hot and compaction FIRES — torch authored, region archived, tail kept', async () => {
    // Grow the real session past what the tail budget can carry: 120 rows ≈
    // 108K chars against a ≤55K budget — the measured prompt fills to window
    // − reserve ≈ 15.4K tokens, past the 0.9 boundary (14,746) by construction.
    for (const row of SEED_ROWS) {
      await workspace.appendMessage(NEUMA_ID, sessionId, row);
    }

    scriptedAnswers.push(A2);
    const crossing = await sendAndWait({ type: 'consciousness:stream', thought: Q2 }, 'consciousness:complete');
    expect(crossing.frames.some((f) => f.error)).toBe(false);

    // The boundary was MEASURED, not guessed: the settle names it.
    const composition = lastComposition(crossing.frames);
    expect(composition.session.atBoundary).toBe(true);
    expect(composition.session.compactionCount).toBe(0); // the rewrite lands after the settle

    // Compaction actually fired — never silently: the session file shows it.
    const compactedRow = await waitFor(async () => (await readRows()).find((r) => r.compacted === true));
    expect(compactedRow).toBeTruthy();

    // The being AUTHORED it: the torch ask went out over the wire carrying the
    // region replay, and the summary entry is the being's own words + torch.
    const torchAsk = capturedBodies.find((b) => typeof b.messages.at(-1)?.content === 'string'
      && b.messages.at(-1).content === SOLO_TORCH_ASK);
    expect(torchAsk).toBeTruthy();
    expect(torchAsk.messages.length).toBeGreaterThan(100); // system + the region replay + the ask
    expect(torchAsk.messages[1].content).toBe(Q1); // the region from the session's first row
    expect(torchAsk.messages.some((m) => m.content === ROW_TEXT(0))).toBe(true);
    expect(compactedRow.authoredBy).toBe('self');
    expect(compactedRow.role).toBe('system');
    expect(compactedRow.content).toContain('[SESSION SUMMARY — in your own words]');
    expect(compactedRow.content).toContain('the ledger, the lighthouse');
    expect(compactedRow.torch).toContain('Pick up by continuing from the summary');
    expect(compactedRow.compactionCount).toBe(1);

    // NOTHING SILENTLY DROPPED: the raw region was archived BEFORE the rewrite.
    expect(await workspace.listArchiveSegments(NEUMA_ID, sessionId)).toEqual([1]);
    const segment = await workspace.readArchiveSegment(NEUMA_ID, sessionId, 1);
    expect(segment.messages.some((m) => m.content === ROW_TEXT(0))).toBe(true);

    // The tail survived the rewrite: exactly the summary + the last 20 rows,
    // the kept rows byte-identical to what they were before compaction.
    const after = await readRows();
    expect(after).toHaveLength(21);
    expect(after[0]).toMatchObject({ compacted: true, compactionCount: 1, authoredBy: 'self' });
    expect(after.slice(1).map((r) => r.content)).toEqual([
      ...SEED_ROWS.slice(-18).map((r) => r.content), Q2, A2,
    ]);
  });

  test('the next turn: the torch rides MEMORY, the summary rides the wire, the kept rows verbatim', async () => {
    scriptedAnswers.push(A3);
    const next = await sendAndWait({ type: 'consciousness:stream', thought: Q3 }, 'consciousness:complete');
    expect(next.frames.some((f) => f.error)).toBe(false);

    const body = capturedBodies.at(-1);
    expect(body.messages[0].role).toBe('system');
    // THE TORCH LANDED — the being's own words to itself, in MEMORY.
    expect(body.messages[0].content).toContain('Your torch from your last instance');
    expect(body.messages[0].content).toContain('Pick up by continuing from the summary');

    // The wire shape post-compaction: [system, summary (as an assistant
    // message — the reading the in-prompt lane gave it), …kept rows, turn].
    const transcript = body.messages.slice(1, -1);
    expect(transcript[0].role).toBe('assistant');
    expect(transcript[0].content).toContain('[SESSION SUMMARY — in your own words]');
    const wireText = transcript.map((m) => m.content).join('\n');
    expect(wireText).toContain(ROW_TEXT(119)); // newest kept row, verbatim
    expect(wireText).not.toContain(ROW_TEXT(101)); // aged into the summary
    expect(wireText).not.toContain(ROW_TEXT(0)); // aged — and PROVEN archived above, never dropped
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: Q3 });

    // The gauge stayed honest across the arc: the compaction is a recorded
    // FACT now, and this turn measured BELOW the boundary (the rewrite worked).
    const composition = lastComposition(next.frames);
    expect(composition.session.compactionCount).toBe(1);
    expect(composition.session.atBoundary).toBe(false);

    // No churn: a settled beat later the record still shows ONE compaction.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await readRows()).filter((r) => r.compacted)).toHaveLength(1);
  });
});
