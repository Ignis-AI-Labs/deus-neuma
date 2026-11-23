/**
 * HEARD MID-THOUGHT (heard-mid-thought.js) — Design note, 2026-11-20: […] Words sent while a round is still THINKING no longer wait for the thought to end and its
 * action to finish: the round's request is cut before it has said or done anything, the words join the conversation
 * with the same note, and the round runs again. A round that has begun to SPEAK is left to finish.
 * Production streamConsciousness over a signed socket and a real encrypted lane; a local OpenAI-compatible server
 * that thinks slowly, as a busy card does. No mocks (RULE 0).
 */
/* global setTimeout, clearTimeout */
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

const KEY = 'heard-mid-thought-key-long-enough';
const NEUMA_ID = 'heardthinking';
const MODEL = 'gpt-4o'; // a model the platform knows calls tools natively
const ASK = 'Re-score the setup-angle companies.';
const MID = 'Also draft the Umbrae launch post after this.';
const SPOKEN_ASK = `${ASK} List them.`;
const NOW_ASK = `${ASK} Explain the pipeline.`;
const NOW_WORDS = 'For these videos use our own sound pipeline.';
let cutAt = null; let heldAt = null;
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const usage = sse({ choices: [], usage: { prompt_tokens: 4000, completion_tokens: 20 } });

describe('words sent while the being is still thinking are heard at once', () => {
  let house; let llm; let socket; let connection;
  const turnBodies = [];
  const saved = { root: null, realm: null, config: null, key: undefined, env: {} };

  beforeAll(async () => {
    saved.key = process.env.DNA_ENCRYPTION_KEY; saved.config = getConfig(); saved.realm = getRealmRoot(); saved.root = getWorkspacesRoot();
    process.env.DNA_ENCRYPTION_KEY = KEY;
    house = await createTempDir('heard-mid-thought');
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
        if (isTurn && JSON.stringify(body.messages).includes(NOW_ASK)) {
          if (JSON.stringify(body.messages).includes(NOW_WORDS)) {
            // Asked again with the operator's words: it carries on from where it stopped.
            res.write(sse({ choices: [{ delta: { content: 'automated. And yes: the sound comes from our own pipeline.' } }] }));
            res.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
            res.write(usage);
            res.end('data: [DONE]\n\n');
            return;
          }
          // MID-SENTENCE when the operator sends NOW: left alone it would talk for ten more seconds.
          res.write(sse({ choices: [{ delta: { content: 'The pipeline is locked. You upload by hand until the posting path is ' } }] }));
          setTimeout(() => { heldAt = Date.now(); cutAt = null; req.socket.on('close', () => { cutAt = cutAt ?? Date.now(); }); queueThought(connection, { type: 'consciousness:stream', holdId: 'held-3', thought: NOW_WORDS }, { now: true }); }, 100);
          const slow = setTimeout(() => { if (!res.writableEnded) { res.write(sse({ choices: [{ delta: { content: 'LATE.' } }] })); res.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] })); res.end('data: [DONE]\n\n'); } }, 10_000);
          req.socket.on('close', () => clearTimeout(slow));
          return;
        }
        if (isTurn && JSON.stringify(body.messages).includes(SPOKEN_ASK)) {
          // This round is already SPEAKING when the operator writes: it is left to finish.
          res.write(sse({ choices: [{ delta: { content: 'Here is the list you asked for. ' } }] }));
          setTimeout(() => {
            queueThought(connection, { type: 'consciousness:stream', holdId: 'held-2', thought: MID });
            res.write(sse({ choices: [{ delta: { content: 'That is all of it.' } }] }));
            res.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
            res.write(usage);
            res.end('data: [DONE]\n\n');
          }, 150);
          return;
        }
        if (isTurn && turnBodies.length === 1) {
          // Round one THINKS, slowly, and has said nothing when the operator writes. The request is cut there.
          req.socket.on('close', () => { cutAt = cutAt ?? Date.now(); });
          res.write(sse({ choices: [{ delta: { reasoning_content: 'Let me think about which companies to re-score first' } }] }));
          setTimeout(() => { heldAt = Date.now(); queueThought(connection, { type: 'consciousness:stream', holdId: 'held-1', thought: MID }); }, 100);
          // Left alone it would think for ten more seconds before doing anything.
          const slow = setTimeout(() => { if (!res.writableEnded) { res.write(sse({ choices: [{ delta: { content: 'Late.' } }] })); res.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] })); res.end('data: [DONE]\n\n'); } }, 10_000);
          req.socket.on('close', () => clearTimeout(slow));
          return;
        }
        res.write(sse({ choices: [{ delta: { content: isTurn ? 'Re-scored. The Umbrae launch post is on my list and I am on it next.' : 'ok' } }] }));
        res.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
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

  test('still thinking: the round is asked again with the words at once, the turn is not cut, and the chat keeps them where they were said', async () => {
    connection = { ws: socket.ws, walletAddress: socket.walletAddress, voiceEnabled: false, companion: { name: 'Heardworking', neumaId: NEUMA_ID }, sessionId: `sess-${Math.random().toString(36).slice(2, 8)}`, pendingThoughts: [] };
    const before = socket.frames.length;
    const started = Date.now();
    await streamConsciousness(connection, { thought: ASK });
    await vi.waitFor(() => { if (!socket.frames.slice(before).some((m) => m.type === 'consciousness:complete')) throw new Error('not yet'); }, { timeout: 10_000 });
    const frames = socket.frames.slice(before);

    // Heard at once: the thinking request was cut within moments of the words, not ten seconds later.
    expect(turnBodies).toHaveLength(2);
    expect(cutAt - heldAt).toBeLessThan(2000);
    expect(Date.now() - started).toBeLessThan(8000);
    // The same round, asked again: everything it was asked before, then the operator's words with what to do with them.
    expect(turnBodies[1].messages.slice(0, turnBodies[0].messages.length)).toEqual(turnBodies[0].messages);
    const last = JSON.stringify(turnBodies[1].messages.at(-1));
    expect(last).toContain('[YOUR OPERATOR, WHILE YOU WORKED');
    expect(last).toContain(MID);
    expect(last).toContain('It does not stop what you are doing: put it on your list now (tasks/add)');
    // The turn was never cut or paused; the words left the queue and their bubble stops offering queue controls.
    expect(frames.some((f) => /response paused to receive the queued message/.test(JSON.stringify(f)))).toBe(false);
    expect(frames.filter((f) => f.type === 'consciousness:complete')).toHaveLength(1);
    expect(frames.find((f) => f.type === 'consciousness:complete').interrupted).not.toBe(true);
    expect(connection.pendingThoughts).toEqual([]);
    expect(connection.onHeldWord).toBeNull();
    expect(frames).toContainEqual(expect.objectContaining({ type: 'consciousness:queue_taken', holdId: 'held-1', held: 0 }));
    const rows = await workspace.readSession(NEUMA_ID, connection.sessionId);
    const said = rows.filter((r) => r.role === 'user' || r.role === 'assistant').map((r) => [r.role, String(r.content).slice(0, 40), Boolean(r.heardWhileWorking)]);
    expect(said).toEqual([
      ['user', ASK.slice(0, 40), false],
      ['user', MID.slice(0, 40), true],
      ['assistant', expect.any(String), false],
    ]);
    expect(rows.find((r) => r.role === 'assistant').content).toBe('Re-scored. The Umbrae launch post is on my list and I am on it next.');
  }, 60_000);

  test('already speaking: the answer is never cut or said twice; the words wait for its end and go next', async () => {
    connection = { ws: socket.ws, walletAddress: socket.walletAddress, voiceEnabled: false, companion: { name: 'Heardworking', neumaId: NEUMA_ID }, sessionId: `sess-${Math.random().toString(36).slice(2, 8)}`, pendingThoughts: [] };
    const before = socket.frames.length;
    const asked = turnBodies.length;
    await streamConsciousness(connection, { thought: SPOKEN_ASK });
    await vi.waitFor(() => { if (!socket.frames.slice(before).some((m) => m.type === 'consciousness:complete')) throw new Error('not yet'); }, { timeout: 10_000 });
    expect(turnBodies.length - asked).toBe(1); // one request: nothing was asked again
    const rows = await workspace.readSession(NEUMA_ID, connection.sessionId);
    expect(rows.find((r) => r.role === 'assistant').content).toBe('Here is the list you asked for. That is all of it.');
    expect(connection.pendingThoughts.map((h) => h.thought)).toEqual([MID]); // still held: the desk's drain sends it as the next turn
  }, 60_000);

  test('SENT NOW, mid-sentence: heard at once — what was said is kept, the words follow it, the same turn runs on and is never cut', async () => {
    connection = { ws: socket.ws, walletAddress: socket.walletAddress, voiceEnabled: false, companion: { name: 'Heardworking', neumaId: NEUMA_ID }, sessionId: `sess-${Math.random().toString(36).slice(2, 8)}`, pendingThoughts: [] };
    const before = socket.frames.length;
    const asked = turnBodies.length;
    const started = Date.now();
    await streamConsciousness(connection, { thought: NOW_ASK });
    await vi.waitFor(() => { if (!socket.frames.slice(before).some((m) => m.type === 'consciousness:complete')) throw new Error('not yet'); }, { timeout: 10_000 });
    const frames = socket.frames.slice(before);
    // At once: the speaking request was cut within moments, not after the ten seconds it had left to say.
    expect(turnBodies.length - asked).toBe(2);
    expect(cutAt - heldAt).toBeLessThan(2000);
    expect(Date.now() - started).toBeLessThan(8000);
    // Asked again with everything as it was, then ITS OWN WORDS SO FAR, then the operator's — told to carry on, not start over.
    const [first, second] = turnBodies.slice(asked);
    expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
    expect(second.messages.at(-2)).toEqual({ role: 'assistant', content: 'The pipeline is locked. You upload by hand until the posting path is' });
    const note = String(second.messages.at(-1).content);
    expect(second.messages.at(-1).role).toBe('user');
    expect(note).toContain(NOW_WORDS);
    expect(note).toContain('It does not stop what you are doing');
    expect(note).toMatch(/You were in the middle of speaking when this arrived: your words so far stand just above\. Do not start over or repeat them — carry on from exactly where you stopped\.$/);
    // One turn, never cut; nothing said is lost or said twice; the words are in the chat where they were heard.
    expect(frames.filter((f) => f.type === 'consciousness:complete')).toHaveLength(1);
    expect(frames.find((f) => f.type === 'consciousness:complete').interrupted).not.toBe(true);
    expect(frames.some((f) => /response paused to receive the queued message|LATE\./.test(JSON.stringify(f)))).toBe(false);
    expect(frames).toContainEqual(expect.objectContaining({ type: 'consciousness:queue_taken', holdId: 'held-3', held: 0, heard: true, thought: NOW_WORDS, at: expect.any(String) }));
    expect(connection.pendingThoughts).toEqual([]);
    const rows = await workspace.readSession(NEUMA_ID, connection.sessionId);
    expect(rows.filter((r) => r.role === 'user').map((r) => [String(r.content), Boolean(r.heardWhileWorking)])).toEqual([[NOW_ASK, false], [NOW_WORDS, true]]);
    const reply = rows.find((r) => r.role === 'assistant').content;
    expect(reply).toContain('The pipeline is locked. You upload by hand until the posting path is');
    expect(reply).toContain('automated. And yes: the sound comes from our own pipeline.');
    expect(reply.match(/The pipeline is locked/g)).toHaveLength(1);
  }, 60_000);
});
