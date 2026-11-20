/**
 * THE CONTEXT MAP COUNTS THE WHOLE REQUEST (wire-sections.js, context-anatomy.js) — Design note, 2026-11-20: […] The tool definitions ride every request as a field
 * of their own and were counted nowhere: their tokens were spread over the sections that were. Production
 * streamConsciousness over a signed socket, a real encrypted lane, and a local OpenAI-compatible server that keeps
 * every request body it is sent — the map is checked against those bytes. No model inference.
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
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { familyOf } from '../../frontend/app/RelinkShell/context-anatomy.js';

const KEY = 'context-map-whole-wire-key-long-enough';
const NEUMA_ID = 'wholewire';
const MODEL = 'gpt-4o'; // a model the platform knows calls tools natively
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const SCRIPT = [
  sse({ choices: [{ delta: { content: 'Counted.' } }] }),
  sse({ choices: [], usage: { prompt_tokens: 9000, completion_tokens: 3 } }),
  'data: [DONE]\n\n',
];
const contentChars = (content) => (typeof content === 'string' ? content.length
  : (content || []).reduce((n, part) => n + (typeof part?.text === 'string' ? part.text.length : 0), 0));

describe('the context map counts what the request carried', () => {
  let house; let llm; let socket; let sessionId;
  const bodies = [];
  const saved = { root: null, realm: null, config: null, key: undefined, env: {} };

  beforeAll(async () => {
    saved.key = process.env.DNA_ENCRYPTION_KEY; saved.config = getConfig(); saved.realm = getRealmRoot(); saved.root = getWorkspacesRoot();
    process.env.DNA_ENCRYPTION_KEY = KEY;
    house = await createTempDir('context-map-whole-wire');
    setRealmRoot(path.join(house, 'realm'));
    for (const k of ['NEUMA_ROUTES_PATH', 'NEUMA_EFFORT_PATH', 'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_CMO_PATH']) {
      saved.env[k] = process.env[k]; process.env[k] = path.join(house, `${k}.json`);
    }
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);
    await workspace.writeDNA(NEUMA_ID, {
      neumaId: NEUMA_ID,
      identity: { name: 'Wholewire', nature: 'A being minted to prove the map counts the whole request', purpose: 'To be measured', communicationStyle: 'Brief' },
      birthTimestamp: Date.now(), birthWitness: 'map-proof', substrate: { model: MODEL },
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
        try { bodies.push(JSON.parse(raw)); } catch { /* not a completion */ }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const line of SCRIPT) res.write(line);
        res.end();
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
    if (sessionId) await harvestWorkingBand(NEUMA_ID, sessionId);
    await socket?.close();
    await new Promise((resolve) => llm.close(resolve));
    setWorkspacesRoot(saved.root); setRealmRoot(saved.realm); setConfig(saved.config);
    for (const [k, v] of Object.entries(saved.env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (saved.key === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = saved.key;
  });

  test('the tool definitions are a section, sized as the request sent them; the sections account for the request; none is OTHER', async () => {
    sessionId = `sess-${Math.random().toString(36).slice(2, 8)}`;
    const connection = { ws: socket.ws, walletAddress: socket.walletAddress, voiceEnabled: false, companion: { name: 'Wholewire', neumaId: NEUMA_ID }, sessionId };
    const before = socket.frames.length;
    await streamConsciousness(connection, { thought: 'How full is your window?' });
    await vi.waitFor(() => { if (!socket.frames.slice(before).some((m) => m.type === 'consciousness:complete')) throw new Error('not yet'); }, { timeout: 10_000 });
    const frames = socket.frames.slice(before).filter((m) => m.type === 'context:composition');
    const turn = bodies.filter((b) => Array.isArray(b?.messages)).at(-1);
    expect(Array.isArray(turn?.tools) && turn.tools.length).toBeGreaterThan(0);
    const sent = JSON.stringify(turn.tools).length;
    for (const frame of [frames[0], frames.at(-1)]) {
      const definitions = frame.sections.find((s) => s.id === 'toolDefinitions');
      expect(definitions).toMatchObject({ label: `TOOL DEFINITIONS (${turn.tools.length})`, chars: sent });
      expect(frame.sections.filter((s) => familyOf(s.id) === 'other').map((s) => s.id)).toEqual([]);
    }
    // What the request carried — its messages' words and its tool definitions — is what the map counted, within the
    // joins and role marks the map's own sections add.
    const wire = turn.messages.reduce((n, m) => n + contentChars(m.content), 0) + sent;
    const counted = frames.at(-1).totals.chars;
    expect(Math.abs(counted - wire) / wire).toBeLessThan(0.02);
  }, 60_000);
});
