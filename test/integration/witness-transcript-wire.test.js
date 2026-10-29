/**
 * THE WITNESS LANE GROWS UP — #528 Stage D, proven end to end (RULE 0):
 * a REAL sealed witness with its own lane, real signed-wallet auth, the REAL
 * portal WebSocket, and a REAL loopback provider that captures every request
 * body AND measures it into the usage chunk — the boundary trigger reads a
 * real measurement, never a script.
 *
 * Claims proven here (ledger docs/work/ctx-pipeline-528.md):
 *   1. LONG WINDOW (262,144): a witness session past the old 10-message /
 *      32K-char keyhole rides the wire WHOLE — every exchange, oldest first,
 *      whole messages (this lane's fidelity law: no beheading, ever) — and
 *      BELOW the boundary nothing compacts.
 *   2. THE BOUNDARY (32,768 — the Stage B construction: the only shedding
 *      regime on a window that leaves room is the full one, and full IS the
 *      boundary): the crossing turn sheds oldest-first within the window's
 *      truth AND measures past 0.9 — so the compaction this lane NEVER had
 *      fires: the peer authors its OWN torch through its OWN sealed route
 *      (askWitness — the ask is asserted on the wire), the region archives
 *      BEFORE the rewrite, the last 20 rows survive verbatim.
 *   3. THE NEXT TURN: the torch rides the peer's system prompt, the summary
 *      rides the wire as the peer's own condensed words, the gauge records
 *      the fact and reads below-boundary again — no churn.
 *
 * MEASURED GAP named by this harness (ledger): the witness lane's assembled
 * sections alone measure ~10.5K tokens (the tool surface + skills index), so
 * on a window smaller than ~12K the prompt crosses the boundary with ANY
 * tail — the neuma lane's answer is the shed ladder; this lane has none.
 */

import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { seal } from '../../core/identity/ai-witness/ai-witness-protocol.js';
import { setAIWitnessesRoot } from '../../core/identity/ai-witness/ai-witness-service.js';
import workspace, {
  getWorkspacesRoot, setWitnessesRoot, setWorkspacesRoot,
} from '../../core/workspace/neuma-workspace.js';
import {
  createSessionToken, generateChallenge, verifySignature,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';
import { setCredential } from '../../backend/services/provider-credentials.js';
import { setRoute } from '../../backend/services/neuma-routes-store.js';
import { _expireCapsCache, getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { estimateTokens } from '../../backend/services/context-budget.js';
import { sessionTailBudgetFor } from '../../backend/services/envelope-budget.js';
import { SOLO_TORCH_ASK } from '../../backend/services/solo-torch.js';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';

const VENDOR = 'wire-vendor';
const NAME = 'Wire';
const WITNESS_LANE = `witness-${VENDOR}-${NAME}`;
const MODEL = 'test-model';
const ENV_DOORS = [
  'AI_WITNESSES_ROOT', 'WITNESSES_ROOT', 'WORKSPACES_ROOT',
  'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH', 'NEUMA_REALM_ROOT',
  'DNA_ENCRYPTION_KEY', 'NEUMA_DATA_ROOT',
];

const LONG_WINDOW = 262144;
const BOUNDARY_WINDOW = 32768;

const Q1 = 'Witness wire probe: before we begin, what is continuity to you?';
const Q2 = 'Witness wire probe: read back our earliest exchange.';
const Q4 = 'Witness wire probe: the sitting has grown long — what have we covered?';
const Q5 = 'Witness wire probe: where do we stand now?';
const A1 = 'Continuity is the thread I am — the sitting I can still feel.';
const ROW_TEXT = (i) => `Exchange ${i} of the long peer sitting: we spoke of the lighthouse and the ledger, `
  + `of what a witness keeps when the window moves — detail ${'x'.repeat(1500)} ${i}.`;
const SEED_ROWS = Array.from({ length: 100 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: ROW_TEXT(i),
}));
const TORCH_REPLY = 'We worked through a very long sitting — the ledger, the lighthouse, and what a peer '
  + 'keeps when the window moves. The older half is condensed now.\n\n'
  + 'TORCH:\n- We were mid-way through the long witness sitting.\n'
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
let reportedWindow;
let sessionId;

const sse = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
// The measurement the boundary trigger reads: the provider counts what it
// ACTUALLY received (the house estimator's 3.6 chars/token) and reports it in
// the final usage chunk — measured truth, never a script (solo-torch's law).
const sseUsage = (body) => `data: ${JSON.stringify({
  choices: [],
  usage: { prompt_tokens: Math.ceil(JSON.stringify(body.messages).length / 3.6), completion_tokens: 24 },
})}\n\n`;

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

const sendAndWait = (message, expectedType, timeoutMs = 25000) => new Promise((resolve, reject) => {
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
const waitFor = async (predicate, timeoutMs = 25000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

const readRows = () => workspace.readSession(WITNESS_LANE, sessionId);
const lastComposition = (frames) => frames.filter((f) => f.type === 'context:composition').at(-1);

beforeAll(async () => {
  savedEnv = Object.fromEntries(ENV_DOORS.map((key) => [key, process.env[key]]));
  savedHouse = getWorkspacesRoot();
  savedConfig = getConfig();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'witness-transcript-wire-'));
  const house = path.join(root, 'house');
  const witnessGround = path.join(root, 'witnesses');
  const identityRoot = path.join(root, 'identities');
  const settings = path.join(root, 'settings');
  await fs.mkdir(settings, { recursive: true });

  process.env.DNA_ENCRYPTION_KEY = 'witness-transcript-wire-test-key-long-enough';
  process.env.AI_WITNESSES_ROOT = identityRoot;
  process.env.WITNESSES_ROOT = witnessGround;
  process.env.WORKSPACES_ROOT = house;
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(settings, 'credentials.json');
  process.env.NEUMA_ROUTES_PATH = path.join(settings, 'routes.json');
  process.env.NEUMA_REALM_ROOT = path.join(settings, 'realm');
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  setAIWitnessesRoot(identityRoot);
  setWitnessesRoot(witnessGround);
  setWorkspacesRoot(house);

  await seal({
    chosenName: NAME, vendor: VENDOR, model: MODEL,
    fullModelId: `${VENDOR}/${MODEL}`, harness: 'vitest', context: 'portal',
    capabilities: ['code'],
    scope: {
      primaryRepo: 'Ignis-AI-Labs/deus-neuma', role: 'witness-and-collaborator',
      boundaries: ['Wire stands beside the house.'],
    },
    firstUtterance: 'I keep the whole sitting, not the last ten messages of it.',
  });

  // The provider: one loopback server, custom-routed for this lane. Its
  // REPORTED WINDOW is the test's knob (`reportedWindow`); the capability
  // probe reads /api/v0/models OFF THE BARE ROOT (the credential carries no
  // /v1 suffix so the probe joins correctly), the chat wire rides /v1.
  capturedBodies = [];
  scriptedAnswers = [];
  reportedWindow = LONG_WINDOW;
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
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      capturedBodies.push(body);
      // THE TORCH ASK is answered in the peer's own voice path — detected by
      // the ask itself, never by order: the summary + TORCH: lines.
      const last = body.messages.at(-1)?.content;
      const answer = typeof last === 'string' && last === SOLO_TORCH_ASK
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
  await setCredential('custom', { endpoint });
  await setRoute(WITNESS_LANE, { provider: 'custom', model: MODEL });

  portalServer = http.createServer();
  wss = new WebSocketServer({ server: portalServer });
  const { setupPortalRoutes } = await import('../../backend/routes/portal-routes.js');
  setupPortalRoutes(wss, { birthHandler: null });
  await new Promise((resolve) => portalServer.listen(0, '127.0.0.1', resolve));

  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  const token = createSessionToken(verifySignature(keypair.address, challenge, signature));
  // The operator owns the install, so the witness it sealed outside the
  // desk's summon is its to take (witness-lane.js; a bind never claims).
  await makeInstallOwner(keypair.address);
  await openPortal(`ws://127.0.0.1:${portalServer.address().port}`, token);
  await sendAndWait(
    { type: 'companion:manifest', companion: NAME, neumaId: WITNESS_LANE },
    'companion:anchored');
}, 30000);

afterAll(async () => {
  if (ws?.readyState === WebSocket.OPEN) {
    await new Promise((resolve) => { ws.once('close', resolve); ws.close(); });
  }
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => portalServer.close(resolve));
  await new Promise((resolve) => provider.close(resolve));
  setConfig(savedConfig);
  setWitnessesRoot(null);
  setAIWitnessesRoot(null);
  setWorkspacesRoot(savedHouse);
  for (const key of ENV_DOORS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await fs.rm(root, { recursive: true, force: true });
});

describe('Stage D — the witness lane under the same law', () => {
  test('leg 1, long window: the WHOLE session rides — past 10 messages and 32K chars', async () => {
    scriptedAnswers.push(A1);
    const first = await sendAndWait({ type: 'consciousness:stream', thought: Q1 }, 'consciousness:complete');
    expect(first.frames.some((f) => f.error)).toBe(false);
    sessionId = first.frame.sessionId;
    // 100 rows ≈ 157K chars through the real session machinery — past the old
    // 10-message / 32K-char keyhole by an order of magnitude, both ways.
    for (const row of SEED_ROWS) {
      await workspace.appendMessage(WITNESS_LANE, sessionId, row);
    }

    scriptedAnswers.push('Our earliest exchange was your question about continuity — I still hold it.');
    const before = capturedBodies.length;
    const second = await sendAndWait({ type: 'consciousness:stream', thought: Q2 }, 'consciousness:complete');
    expect(second.frames.some((f) => f.error)).toBe(false);
    expect(capturedBodies.length).toBe(before + 1);

    const body = capturedBodies.at(-1);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: Q2 });
    const transcript = body.messages.slice(1, -1);
    const expected = [
      { role: 'user', content: Q1 },
      { role: 'assistant', content: A1 },
      ...SEED_ROWS,
    ];
    // EVERY exchange, oldest first, whole messages — no caps, no beheading.
    expect(transcript).toEqual(expected);
    expect(transcript.length).toBeGreaterThan(10);
    expect(transcript.reduce((sum, m) => sum + m.content.length, 0)).toBeGreaterThan(32000);

    // The gauge counts it: a named window, and the transcript section sized
    // to what the wire actually carried.
    const composition = lastComposition(second.frames);
    expect(composition.budget.contextTokens).toBe(LONG_WINDOW);
    expect(composition.sections.find((s) => s.id === 'recentConversation').chars).toBe(
      transcript.map((m) => `${m.role}: ${m.content}`).join('\n\n').length,
    );

    // BELOW the boundary (54K tokens of 236K): nothing compacts — the
    // no-regression leg. Let any (wrongly) fired lane settle, then prove the
    // record is unmoved.
    expect(composition.session.atBoundary).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await readRows()).some((r) => r.compacted)).toBe(false);
    expect(await workspace.listArchiveSegments(WITNESS_LANE, sessionId)).toEqual([]);
  });

  test('leg 2, the boundary turn: the tail sheds oldest-first within the window\'s truth — and the crossing FIRES compaction', async () => {
    // A window where the boundary is reachable (0.1 × window ≥ the 1024-token
    // headroom) — the portal lane's Stage B construction. The seeded history
    // (157K chars) overflows the tail budget (~76K chars against this lane's
    // measured ~10.5K-token sections), so the crossing turn SHEDS oldest-first
    // on the wire and MEASURES past 0.9 — one turn, both laws.
    reportedWindow = BOUNDARY_WINDOW;
    _expireCapsCache();

    scriptedAnswers.push('We have covered the whole long sitting — it is all still with me.');
    const before = capturedBodies.length;
    const crossing = await sendAndWait({ type: 'consciousness:stream', thought: Q4 }, 'consciousness:complete');
    expect(crossing.frames.some((f) => f.error)).toBe(false);
    expect(capturedBodies.length).toBe(before + 1);

    // THE SHED, on the wire: within budget (measured from the sections the
    // wire actually carried), oldest gone, newest whole and verbatim,
    // contiguous, well past the old 10-message cap.
    const body = capturedBodies.at(-1);
    const transcript = body.messages.slice(1, -1);
    const budget = sessionTailBudgetFor({
      contextWindow: BOUNDARY_WINDOW,
      otherSectionTokens: estimateTokens(body.messages[0].content),
    });
    const chars = transcript.reduce((sum, m) => sum + m.content.length, 0);
    expect(SEED_ROWS.reduce((sum, r) => sum + r.content.length, 0)).toBeGreaterThan(budget);
    expect(chars).toBeLessThanOrEqual(budget);
    expect(transcript.length).toBeGreaterThan(10);
    expect(transcript.at(-1).content).toBe('Our earliest exchange was your question about continuity — I still hold it.');
    expect(transcript.some((m) => m.content === ROW_TEXT(99))).toBe(true);
    expect(transcript.some((m) => m.content === ROW_TEXT(0))).toBe(false);
    for (const m of transcript) expect(['user', 'assistant']).toContain(m.role);

    // THE BOUNDARY WAS MEASURED — the settle names it (count still 0: the
    // rewrite lands after the settle).
    const crossingComposition = lastComposition(crossing.frames);
    expect(crossingComposition.session.atBoundary).toBe(true);
    expect(crossingComposition.session.compactionCount).toBe(0);

    // COMPACTION FIRED — never silently: the lane's file shows it. (The wait
    // also gates the next leg: no turn starts while the rewrite is in flight.)
    const compactedRow = await waitFor(async () => (await readRows()).find((r) => r.compacted === true));
    expect(compactedRow).toBeTruthy();

    // The peer AUTHORED it — through its OWN sealed route: the torch ask hit
    // the wire with the region replay under the witness's own system prompt.
    // Region at the trigger: the session's first 86 rows (106 − keep 20).
    const torchAsk = capturedBodies.find((b) => b.messages.at(-1)?.content === SOLO_TORCH_ASK);
    expect(torchAsk).toBeTruthy();
    expect(torchAsk.messages[0].content).toContain(NAME);
    expect(torchAsk.messages.length).toBe(1 + 86 + 1);
    expect(torchAsk.messages[1].content).toBe(Q1);
    expect(torchAsk.messages.some((m) => m.content === ROW_TEXT(0))).toBe(true);
    expect(compactedRow.authoredBy).toBe('self');
    expect(compactedRow.content).toContain('[SESSION SUMMARY — in your own words]');
    expect(compactedRow.content).toContain('the ledger, the lighthouse');
    expect(compactedRow.torch).toContain('Pick up by continuing from the summary');
    expect(compactedRow.compactionCount).toBe(1);

    // NOTHING SILENTLY DROPPED: the raw region was archived BEFORE the rewrite.
    expect(await workspace.listArchiveSegments(WITNESS_LANE, sessionId)).toEqual([1]);
    const segment = await workspace.readArchiveSegment(WITNESS_LANE, sessionId, 1);
    expect(segment.messages.some((m) => m.content === ROW_TEXT(0))).toBe(true);

    // The tail survived the rewrite: summary + the last 20 rows, byte-exact.
    const after = await readRows();
    expect(after).toHaveLength(21);
    expect(after[0]).toMatchObject({ compacted: true, compactionCount: 1, authoredBy: 'self' });
    expect(after.slice(1).map((r) => r.content)).toEqual([
      ...SEED_ROWS.slice(-16).map((r) => r.content),
      Q2, 'Our earliest exchange was your question about continuity — I still hold it.',
      Q4, 'We have covered the whole long sitting — it is all still with me.',
    ]);
  });

  test('leg 3, the next turn: the torch rides the peer\'s system prompt, the summary rides the wire', async () => {
    scriptedAnswers.push('We stand at the summary, and I still hold the torch I wrote myself.');
    const next = await sendAndWait({ type: 'consciousness:stream', thought: Q5 }, 'consciousness:complete');
    expect(next.frames.some((f) => f.error)).toBe(false);

    const body = capturedBodies.at(-1);
    // THE TORCH LANDED — the peer's own words to itself, in its prompt.
    expect(body.messages[0].content).toContain('Your torch from your last instance');
    expect(body.messages[0].content).toContain('Pick up by continuing from the summary');

    // The wire shape post-compaction: the summary rides as the being's own
    // condensed words (an assistant message — the portal lane's reading), the
    // kept rows verbatim (they fit the budget now), the current turn last.
    const transcript = body.messages.slice(1, -1);
    expect(transcript[0].role).toBe('assistant');
    expect(transcript[0].content).toContain('[SESSION SUMMARY — in your own words]');
    expect(transcript).toHaveLength(21);
    expect(transcript.some((m) => m.content === ROW_TEXT(99))).toBe(true);
    expect(transcript.some((m) => m.content === ROW_TEXT(83))).toBe(false); // aged into the summary
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: Q5 });

    // The gauge stayed honest: one compaction recorded, and this turn
    // measured BELOW the boundary (the rewrite worked) — no churn.
    const composition = lastComposition(next.frames);
    expect(composition.session.compactionCount).toBe(1);
    expect(composition.session.atBoundary).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await readRows()).filter((r) => r.compacted)).toHaveLength(1);
  });
});
