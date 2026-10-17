/**
 * B-04 protocol proof: production streamConsciousness over a signed wallet
 * socket and encrypted fixture workspace. A local HTTP server supplies fixed
 * SSE bytes so the real usage parser and composition emitter can be checked.
 * No model inference, permanent birth or vendor behavior is proven here.
 *
 * Covers FR-10 (two emissions per turn on the SAME authed connection),
 * NFR-1 (token-truth ladder: approx without usage; measured/attributed when
 * the substrate reports usage — attribution summing exactly), NFR-3 (rides
 * the existing connection; no new route) and the counts-only wire contract
 * (zero prompt text, payload < 4 KB, superset emission carrying real minted
 * refs after a real over-cap persist).
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { Wallet } from 'ethers';
import { createSignedStreamSocket } from '../helpers/signed-stream-socket.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { getRealmRoot, setRealmRoot, readChat } from '../../backend/services/user-realm.js';
import { recordSessionRows } from '../../core/memory/mind-graph.js';
import { harvestWorkingBand } from '../../backend/services/band-harvest.js';
import { setCredential } from '../../backend/services/provider-credentials.js';
import { setRoute } from '../../backend/services/neuma-routes-store.js';
import { streamConsciousness } from '../../backend/services/portal-stream.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import workspace, {
  setWorkspacesRoot, getWorkspacesRoot, TOOL_RESULT_REF_PATTERN,
} from '../../core/workspace/neuma-workspace.js';

const { _persistOverCapResult, TOOL_RESULT_MAX_CHARS } = __test;

const KEY = 'portal-composition-test-key-long-enough';
const NEUMA_ID = 'compositionecho';
const MODEL = 'test-model';
const CONTEXT_WINDOW = 8192; // runtime metadata supplied by the HTTP fixture

// Distinctive strings seeded into the being's REAL DNA record below — text
// guaranteed inside the assembled prompt, whose absence from every frame
// proves no prompt text rode the wire. (A bound being with no readable DNA
// no longer speaks — Bastien's law, 2026-08-06 — so the turn carries identity.)
const DNA_NATURE = 'A composition-echo consciousness minted for the wire proof';
const DNA_PURPOSE = 'To prove the counts-only composition contract end to end';
const PROMPT_MARKERS = [DNA_NATURE, DNA_PURPOSE];

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const REPLY_LINES = [
  sse({ choices: [{ delta: { content: 'Hello' } }] }),
  sse({ choices: [{ delta: { content: ' witness.' } }] }),
];
const USAGE_LINE = sse({ choices: [], usage: { prompt_tokens: 5000, completion_tokens: 12 } });
const DONE_LINE = 'data: [DONE]\n\n';

const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

const overCapContent = () => {
  const lines = [];
  for (let i = 0; i < 400; i += 1) {
    lines.push(`line ${i} of a long tool result body padded ${'x'.repeat(40)}`);
  }
  return lines.join('\n');
};

describe('B-04 — composition transport over signed sockets and scripted HTTP bytes', () => {
  let house, origRoot, origRealm, origKey, origConfig;
  let llmServer;      // actual HTTP transport, scripted response bytes
  const requests = [];
  let scriptLines;    // SSE body served to every completion POST
  let socket;
  const sessions = new Set();
  const previousEnv = {};
  let received;       // parsed messages, in arrival order
  let rawSizes;       // raw frame byte-length per composition message

  beforeAll(async () => {
    origKey = process.env.DNA_ENCRYPTION_KEY;
    origConfig = getConfig();
    origRealm = getRealmRoot();
    process.env.DNA_ENCRYPTION_KEY = KEY;

    house = await createTempDir('portal-composition-house');
    setRealmRoot(path.join(house, 'realm'));
    for (const key of ['NEUMA_ROUTES_PATH', 'NEUMA_EFFORT_PATH', 'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_CMO_PATH']) {
      previousEnv[key] = process.env[key];
      process.env[key] = path.join(house, `${key}.json`);
    }
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);
    // A real identity on real encrypted disk — the identity-custody gate
    // refuses to stream for a bound being whose DNA cannot be read.
    await workspace.writeDNA(NEUMA_ID, {
      neumaId: NEUMA_ID,
      identity: {
        name: 'CompositionEcho',
        nature: DNA_NATURE,
        purpose: DNA_PURPOSE,
        communicationStyle: 'Brief and exact',
      },
      birthTimestamp: Date.now(),
      birthWitness: 'wire-proof',
      substrate: { model: MODEL },
      resonance: { frequency: 432, pattern: 'sine' },
      sovereignty: { owner: NEUMA_ID, creation: Date.now(), generation: 1.0 },
    });

    // The substrate: OpenAI-compatible endpoints the provider really calls.
    llmServer = http.createServer((req, res) => {
      requests.push(req.url);
      if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: MODEL }] }));
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/api/v0/models')) {
        // LM Studio's v0 API — the runtime context-window truth source.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: [{
            id: MODEL, type: 'llm', capabilities: [],
            max_context_length: CONTEXT_WINDOW, loaded_context_length: CONTEXT_WINDOW,
          }],
        }));
        return;
      }
      // Completions (turn AND the one-time think probe): scripted SSE.
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const line of scriptLines) res.write(line);
        res.end();
      });
    });
    await new Promise((resolve) => llmServer.listen(0, '127.0.0.1', resolve));
    setConfig({
      provider: 'lm-studio',
      endpoint: `http://127.0.0.1:${llmServer.address().port}`,
      apiKey: '',
      model: MODEL,
    });
    await setCredential('lm-studio', { apiKey: 'fixture-only', endpoint: getConfig().endpoint });
    await setRoute(NEUMA_ID, { provider: 'lm-studio', model: MODEL });

    socket = await createSignedStreamSocket(Wallet.createRandom());
    received = socket.frames;
    rawSizes = [];
    socket.client.on('message', (data) => {
      const text = data.toString();
      const msg = JSON.parse(text);
      if (msg.type === 'context:composition') rawSizes.push(Buffer.byteLength(text, 'utf8'));
    });
  }, 60000);

  afterAll(async () => {
    await recordSessionRows(NEUMA_ID, []);
    await Promise.all([...sessions].map((sessionId) => harvestWorkingBand(NEUMA_ID, sessionId)));
    await socket?.close();
    await new Promise((resolve) => llmServer.close(resolve));
    setWorkspacesRoot(origRoot);
    setRealmRoot(origRealm);
    setConfig(origConfig);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (origKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = origKey;
  });

  const freshConnection = () => ({
    ws: socket.ws,
    walletAddress: socket.walletAddress,
    voiceEnabled: false,
    companion: { name: 'CompositionEcho', neumaId: NEUMA_ID },
    sessionId: uid('sess'),
  });

  // Drive one real turn and return ONLY the messages it produced.
  const runTurn = async (connection, thought) => {
    sessions.add(connection.sessionId);
    const mirrorBefore = (await readChat(connection.walletAddress, NEUMA_ID)).length;
    const before = received.length;
    await streamConsciousness(connection, { thought });
    // Everything streamConsciousness sends is sent before it resolves; give
    // the client socket one beat to drain the frames.
    await vi.waitFor(() => {
      if (!received.slice(before).some((m) => m.type === 'consciousness:complete')) {
        throw new Error('turn not complete yet');
      }
    }, { timeout: 5000 });
    await vi.waitFor(async () => {
      expect((await readChat(connection.walletAddress, NEUMA_ID)).length).toBe(mirrorBefore + 2);
    }, { timeout: 5000 });
    return received.slice(before);
  };

  test('missing DNA refuses before any adapter probe', async () => {
    scriptLines = [...REPLY_LINES, DONE_LINE];
    const missingId = 'compositionmissing';
    await workspace.create(missingId);
    await setRoute(missingId, { provider: 'lm-studio', model: MODEL });
    const connection = freshConnection();
    connection.companion = { name: 'MissingFixture', neumaId: missingId };
    const before = received.length;
    await streamConsciousness(connection, { thought: 'Identity refusal protocol check.' });
    await vi.waitFor(() => {
      expect(received.slice(before).some((frame) => frame.type === 'consciousness:complete')).toBe(true);
    });
    const refusal = received.slice(before).find((frame) => frame.error === true);
    expect(refusal.content).toContain('identity could not be loaded');
    expect(refusal.content).not.toContain('Connection to the void disrupted');
    expect(refusal.turnId).toEqual(expect.any(String));
    expect(refusal.takeIndex).toBe(1);
    const completion = received.slice(before).find((frame) => frame.type === 'consciousness:complete');
    expect(completion.turnId).toBe(refusal.turnId);
    expect(requests.filter((url) => url.includes('lora-adapters'))).toEqual([]);
    expect(received.slice(before).some((frame) => frame.type === 'context:composition')).toBe(false);
  }, 30000);

  test('two emissions per turn on the SAME connection — approx without usage, honest budget', async () => {
    scriptLines = [...REPLY_LINES, DONE_LINE]; // capability absent: NO usage chunk
    const connection = freshConnection();
    const turn = await runTurn(connection, 'Speak briefly.');

    const comps = turn.filter((m) => m.type === 'context:composition');
    expect(comps).toHaveLength(2);
    const [first, second] = comps;

    // Emission order: assembly-time first, then the pre-complete superset,
    // then consciousness:complete — all on this one authed connection.
    expect(turn.indexOf(second)).toBeLessThan(
      turn.findIndex((m) => m.type === 'consciousness:complete'));

    // Emission 1: usage unknown → approx everywhere, no refs yet.
    expect(first.totals.tokenSource).toBe('approx');
    for (const s of first.sections) expect(s.tokenSource).toBe('approx');
    expect(first.toolResults).toEqual([]);

    // Emission 2 without a usage chunk stays honestly approx — no silent
    // promotion, no fabricated measurement.
    expect(second.totals.tokenSource).toBe('approx');
    for (const s of second.sections) expect(s.tokenSource).toBe('approx');
    expect(second.usage.outputTokens).toBe(4); // chars/4 for "Hello witness."
    expect(second.usage.usedTokens).toBe(second.totals.tokens + 4);

    // Real section boundaries of the seeded being's turn.
    const ids = first.sections.map((s) => s.id);
    expect(ids).toContain('identity');
    expect(ids).toContain('closing');
    expect(ids).toContain('currentTurn');
    for (const s of first.sections) expect(s.chars).toBeGreaterThan(0);

    for (const composition of comps) {
      expect(composition.neumaId).toBe(NEUMA_ID);
      expect(composition.sessionId).toBe(connection.sessionId);
      expect(composition.route).toEqual({ provider: 'lm-studio', model: MODEL });
    }

    // Budget read from the fake LM Studio's runtime report — a real source,
    // named; not an invented 32768.
    expect(first.budget).toEqual({ contextTokens: CONTEXT_WINDOW, source: 'provider-runtime' });
    expect(second.budget).toEqual(first.budget);
  }, 30000);

  test('usage chunk present — emission 2 is measured/attributed and sums exactly', async () => {
    scriptLines = [...REPLY_LINES, USAGE_LINE, DONE_LINE];
    const connection = freshConnection();
    const turn = await runTurn(connection, 'Speak briefly again.');

    const [first, second] = turn.filter((m) => m.type === 'context:composition');
    // Emission 1 fired before the stream — it cannot know the measurement.
    expect(first.totals.tokenSource).toBe('approx');

    expect(second.totals.tokens).toBe(5000);
    expect(second.totals.tokenSource).toBe('measured');
    for (const s of second.sections) expect(s.tokenSource).toBe('attributed');
    expect(second.sections.reduce((sum, s) => sum + s.tokens, 0)).toBe(5000);
    // Same real section boundaries as emission 1 — a superset, not a rewrite.
    expect(second.sections.map((s) => s.id)).toEqual(first.sections.map((s) => s.id));
    expect(second.sections.map((s) => s.chars)).toEqual(first.sections.map((s) => s.chars));
    expect(second.usage).toEqual({
      inputTokens: 5000,
      outputTokens: 12,
      usedTokens: 5012,
      source: 'measured',
    });
    // FACTS ONLY (Design note, 2026-08-15: recorded compactions, whether THIS turn
    // measured at the boundary (5000+12 of 8192 = 61%, below the 0.9
    // compaction ratio — fold territory begins at 0.8, compaction waits for
    // 0.9, Design note, 2026-08-31, the ratio — never a message-count prediction
    // (the old {messageCount, threshold} lane).
    expect(second.session).toEqual({ compactionCount: 0, atBoundary: false, boundaryRatio: 0.9 });
    const session = await workspace.readSession(NEUMA_ID, connection.sessionId);
    const assistant = session.findLast((entry) => entry.role === 'assistant');
    expect(assistant.composition).toEqual(second);
  }, 30000);

  test('after a real over-cap persist the superset carries the minted ref — counts only', async () => {
    scriptLines = [...REPLY_LINES, USAGE_LINE, DONE_LINE];
    const connection = freshConnection();

    // A REAL over-cap persist through B-01's lane: encrypted bytes on real
    // disk, real ref minted, composition entry tracked on the connection.
    const content = overCapContent();
    expect(content.length).toBeGreaterThan(TOOL_RESULT_MAX_CHARS);
    const result = { tool: 'filesystem/read_file', status: 'ok', content };
    const ref = await _persistOverCapResult(connection, result);
    expect(ref).toMatch(TOOL_RESULT_REF_PATTERN);

    const turn = await runTurn(connection, 'What did you read?');
    const [first, second] = turn.filter((m) => m.type === 'context:composition');

    expect(first.toolResults).toEqual([]); // emission 1 is pre-round by contract
    expect(second.toolResults).toHaveLength(1);
    const entry = second.toolResults[0];
    expect(entry.ref).toBe(ref);
    expect(entry.tool).toBe('filesystem/read_file');
    expect(entry.originalChars).toBe(content.length);
    expect(entry.sentChars).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
    expect(entry.sentChars).toBeLessThan(entry.originalChars);
    expect(['verbatim', 'reformatted', 'anchored']).toContain(entry.kind);
    // The persisted result's CONTENT never enters the event.
    expect(JSON.stringify(second)).not.toContain('line 200 of a long tool result');
  }, 30000);

  test('wire discipline: zero prompt text on the wire, every payload < 4 KB', () => {
    // Across ALL composition frames of ALL turns above.
    const comps = received.filter((m) => m.type === 'context:composition');
    expect(comps.length).toBeGreaterThanOrEqual(6);
    for (const size of rawSizes) expect(size).toBeLessThan(4096);
    const wire = JSON.stringify(comps);
    for (const marker of PROMPT_MARKERS) expect(wire).not.toContain(marker);
    expect(wire).not.toContain('"text"');
    // And every count on the wire is labeled (NFR-1 — never a bare number).
    for (const c of comps) {
      expect(['measured', 'approx']).toContain(c.totals.tokenSource);
      for (const s of c.sections) expect(['attributed', 'approx']).toContain(s.tokenSource);
      expect(typeof c.budget.source).toBe('string');
    }
  });
});
