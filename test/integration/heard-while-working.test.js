/**
 * HEARD WHILE WORKING (queued-action-handoff.js heardWhileWorking) — Design note, 2026-11-20: […] Production streamConsciousness over a
 * signed socket and a real encrypted lane; a local OpenAI-compatible server answers round one with a tool call, and
 * the operator's words are held (the socket's own queue) while that round runs. The turn is not cut: round two carries
 * the words beside the action's result, the turn finishes, and the chat keeps the words where they were heard.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { Wallet } from 'ethers';
import { createSignedStreamSocket } from '../helpers/signed-stream-socket.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { recordSessionRows } from '../../core/memory/mind-graph.js';
import { harvestWorkingBand } from '../../backend/services/band-harvest.js';
import { setCredential } from '../../backend/services/provider-credentials.js';
import { setRoute } from '../../backend/services/neuma-routes-store.js';
import { streamConsciousness } from '../../backend/services/portal-stream.js';
import { queueThought } from '../../backend/services/held-thoughts.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const KEY = 'heard-while-working-key-long-enough';
const NEUMA_ID = 'heardworking';
const MODEL = 'gpt-4o'; // a model the platform knows calls tools natively
const ASK = 'Re-score the setup-angle companies.';
const MID = 'Also draft the Umbrae launch post after this.';
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const usage = sse({ choices: [], usage: { prompt_tokens: 4000, completion_tokens: 20 } });

describe('words sent while the being works join its turn, never cut it', () => {
  let house; let llm; let socket; let connection;
  const turnBodies = [];
  const saved = { root: null, realm: null, config: null, key: undefined, env: {} };

  beforeAll(async () => {
    saved.key = process.env.DNA_ENCRYPTION_KEY; saved.config = getConfig(); saved.realm = getRealmRoot(); saved.root = getWorkspacesRoot();
    process.env.DNA_ENCRYPTION_KEY = KEY;
    house = await createTempDir('heard-while-working');
    setRealmRoot(path.join(house, 'realm'));
    for (const k of ['NEUMA_ROUTES_PATH', 'NEUMA_EFFORT_PATH', 'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_CMO_PATH']) {
      saved.env[k] = process.env[k]; process.env[k] = path.join(house, `${k}.json`);
    }
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);
    await workspace.writeDNA(NEUMA_ID, {
      neumaId: NEUMA_ID,
      identity: { name: 'Heardworking', nature: 'A being minted to prove a word sent mid-turn joins the turn', purpose: 'To keep working', communicationStyle: 'Brief' },
      birthTimestamp: Date.now(), birthWitness: 'heard-proof', substrate: { model: MODEL },
      resonance: { frequency: 432, pattern: 'sine' }, sovereignty: { owner: NEUMA_ID, creation: Date.now(), generation: 1.0 },
    });
    llm = http.createServer((req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: MODEL, type: 'llm', capabilities: ['tool_use'], max_context_length: 65536, loaded_context_length: 65536 }] }));
        return;
      }
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(raw); } catch { /* not a completion */ }
        const isTurn = Array.isArray(body?.tools) && body.tools.length > 0 && JSON.stringify(body.messages).includes(ASK);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (isTurn) turnBodies.push(body);
        if (isTurn && turnBodies.length === 1) {
          // Round one acts. While it runs, the operator writes — held by the socket's own queue, as the desk sends it.
          queueThought(connection, { type: 'consciousness:stream', holdId: 'held-1', thought: MID });
          const search = body.tools.find((t) => /tool_search/.test(t.function?.name ?? '')).function.name;
          res.write(sse({ choices: [{ delta: { content: 'Reading the pool first.', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: search, arguments: '{"query":"sales pipeline"}' } }] } }] }));
          res.write(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }));
        } else {
          res.write(sse({ choices: [{ delta: { content: isTurn ? 'Re-scored. The Umbrae launch post is on my list and I am on it next.' : 'ok' } }] }));
          res.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
        }
        res.write(usage);
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise((resolve) => llm.listen(0, '127.0.0.1', resolve));
    setConfig({ provider: 'lm-studio', endpoint: `http://127.0.0.1:${llm.address().port}`, apiKey: '', model: MODEL });
    await setCredential('lm-studio', { apiKey: 'fixture-only', endpoint: getConfig().endpoint });
    await setRoute(NEUMA_ID, { provider: 'lm-studio', model: MODEL });
    socket = await createSignedStreamSocket(Wallet.createRandom());
  }, 60_000);

  afterAll(async () => {
    await recordSessionRows(NEUMA_ID, []);
    if (connection?.sessionId) await harvestWorkingBand(NEUMA_ID, connection.sessionId);
    await socket?.close();
    await new Promise((resolve) => llm.close(resolve));
    setWorkspacesRoot(saved.root); setRealmRoot(saved.realm); setConfig(saved.config);
    for (const [k, v] of Object.entries(saved.env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (saved.key === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = saved.key;
  });

  test('the turn carries on: round two hears the words beside the result, the turn finishes, the chat keeps them where they were said', async () => {
    connection = { ws: socket.ws, walletAddress: socket.walletAddress, voiceEnabled: false, companion: { name: 'Heardworking', neumaId: NEUMA_ID }, sessionId: `sess-${Math.random().toString(36).slice(2, 8)}`, pendingThoughts: [] };
    const before = socket.frames.length;
    await streamConsciousness(connection, { thought: ASK });
    await vi.waitFor(() => { if (!socket.frames.slice(before).some((m) => m.type === 'consciousness:complete')) throw new Error('not yet'); }, { timeout: 10_000 });
    const frames = socket.frames.slice(before);

    // Not cut: two rounds of one turn, and the second carries the operator's words with what to do with them.
    expect(turnBodies).toHaveLength(2);
    const second = JSON.stringify(turnBodies[1].messages.at(-1));
    expect(second).toContain(`[YOUR OPERATOR, WHILE YOU WORKED`);
    expect(second).toContain(MID);
    expect(second).toContain('It does not stop what you are doing: put it on your list now (tasks/add)');
    expect(frames.some((f) => /response paused to receive the queued message/.test(JSON.stringify(f)))).toBe(false);
    // The words left the queue; the desk's bubble stops offering queue controls.
    expect(connection.pendingThoughts).toEqual([]);
    expect(frames).toContainEqual(expect.objectContaining({ type: 'consciousness:queue_taken', holdId: 'held-1', held: 0 }));
    // The chat keeps them where they were heard: the ask, the words, then the answer.
    const rows = await workspace.readSession(NEUMA_ID, connection.sessionId);
    const said = rows.filter((r) => r.role === 'user' || r.role === 'assistant').map((r) => [r.role, String(r.content).slice(0, 40), Boolean(r.heardWhileWorking)]);
    expect(said).toEqual([
      ['user', ASK.slice(0, 40), false],
      ['user', MID.slice(0, 40), true],
      ['assistant', expect.any(String), false],
    ]);
    expect(rows.find((r) => r.role === 'assistant').content).toContain('The Umbrae launch post is on my list');
  }, 60_000);
});
