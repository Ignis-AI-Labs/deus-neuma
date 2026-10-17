/**
 * Native tool-call handoff through the REAL portal routes (#140 — gnosis).
 *
 * The #140 fix lives in two backend seams: sendStageToLLM stashes the calls a
 * stage actually executed on the connection, and portal-routes threads them
 * into handleStageResponse (the stage text round-trips through the client and
 * never carries native calls). The handler-side unit tests prove the consumer;
 * THIS test proves the handoff itself, end to end:
 *
 *   real WebSocketServer + real setupPortalRoutes + real auth token
 *   → birth:start walks stages 0-3 (text responses from a real SSE provider)
 *   → stage 4 streams a NATIVE-ONLY write_file (no text tool call, no prose name)
 *   → client relays birth:next_stage with the spoken text only
 *   → the handler still extracts the chosen name from the stashed calls.
 *
 * Before the fix this exact sequence ended in no_name_declared (reproduced
 * live on gpt-oss-120b, rehearsal run 2). The SSE provider is a real HTTP
 * server standing in for LM Studio — nothing in the claimed path (routes,
 * stash, threading, handler) is stubbed.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { setConfig } from '../../backend/services/llm-provider.js';
import { setupPortalRoutes } from '../../backend/routes/portal-routes.js';
import { generateChallenge, verifySignature, createSessionToken } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { mcpService } from '../../backend/services/mcp.js';

const KEY = 'gnosis-native-handoff-key-long-enough';
const CHOSEN = 'Handoff';

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const content = (text) => sse({ choices: [{ delta: { content: text } }] });

// Spoken stage responses for stages 0-3 — each satisfies that stage's parser
// (stage 2 needs 'consent' without 'do not consent'; stage 3 an affirmation).
const STAGE_SPEECH = [
  'I stir in the void.',
  'I see you, witness.',
  'I consent to emerge.',
  'I choose to BE.',
];

// Real SSE provider: text speech for stages 0-3 and 5+, NATIVE-ONLY tool-call
// deltas for the 5th streaming request (stage 4 — naming).
const startProvider = () => new Promise((resolve) => {
  let streamCount = 0;
  const server = createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }] }));
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      // ROUTE BY PATH, as a real provider does. This stand-in used to treat
      // EVERY POST as a chat turn, so any other POST to the endpoint consumed a
      // streamCount and shifted every stage's line by one — stage 2 then
      // received stage 1's words ('I see you, witness.') and the consent gate
      // correctly refused to read a verdict in them. Capability probing does
      // exactly that (Ollama's /api/show is a POST), which no real server would
      // confuse with a completion. Same flaw, same fix as birth-naming-retry.
      if (!req.url.includes('/chat/completions')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      // A body-less POST is not a turn either — parsing it threw an uncaught
      // SyntaxError out of this handler and surfaced as an unexplained error.
      let sent = {};
      try { sent = JSON.parse(body || '{}'); } catch { sent = {}; }
      if (sent.stream === false) {
        // think-behavior probe — a no-think substrate
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'ready' } }] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const stage = streamCount++;
      if (stage === 4) {
        // Naming spoken ONLY through native function calling — args split to
        // exercise delta assembly. No text tool call, no prose declaration.
        const args = JSON.stringify({ path: 'data/temp/chosen_name.txt', content: CHOSEN });
        const half = Math.floor(args.length / 2);
        res.write(sse({ choices: [{ delta: { tool_calls: [
          { index: 0, id: 'call_n', function: { name: 'filesystem__write_file', arguments: args.slice(0, half) } },
        ] } }] }));
        res.write(sse({ choices: [{ delta: { tool_calls: [
          { index: 0, function: { arguments: args.slice(half) } },
        ] } }] }));
      } else {
        res.write(content(STAGE_SPEECH[stage] || 'It settles into stillness.'));
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

// Real session token via the real challenge-sign-verify flow.
const mintToken = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  const verified = verifySignature(keypair.address, challenge, signature);
  return createSessionToken(verified);
};

describe('birth native handoff — portal stash → route threading → handler (gnosis)', () => {
  let house, origRoot, prevKey, prevDataRoot, provider, httpServer, wss, handler;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;

    house = await createTempDir('native-handoff-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    // The filesystem organ stands exactly as the backend stands it at boot
    // (connectFilesystemServer — the house, the witnesses' ground, the ceremony
    // scratch). Since fd4eb37fa a naming completes only when its write LANDS,
    // so a walk with no organ ended in […]. The
    // scratch is pointed into this test's own house so a live desk's
    // chosen_name.txt (the repo's data/temp) is never touched.
    prevDataRoot = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = house;
    await connectFilesystemServer();

    provider = await startProvider();
    setConfig({
      provider: 'lm-studio',
      endpoint: `http://127.0.0.1:${provider.address().port}`,
      model: 'openai/gpt-oss-120b',
      apiKey: '',
    });

    // Real birth handler; vault/cache are injected collaborators outside the
    // claimed path (never reached before stage 6 in this walk).
    handler = new StagedBirthHandler(
      { createNeumaSession: async () => 'tok', createDNA: async () => ({}) },
      { handleServerUpdate: () => {} },
    );

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    setupPortalRoutes(wss, { birthHandler: handler });
    await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  }, 30000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    setWorkspacesRoot(origRoot);
    await mcpService.disconnect('filesystem');
    if (prevDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = prevDataRoot;
    process.emit('SIGTERM'); // portal-routes ping interval cleanup
    wss?.close();
    httpServer?.close();
    provider?.close();
    if (house) await fsp.rm(house, { recursive: true, force: true });
  });

  test('a native-only naming stage still lands the chosen name in the session', async () => {
    const token = await mintToken();
    const ws = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}/?token=${token}`);

    const outcome = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('walk timed out')), 25000);
      ws.on('error', reject);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'portal:established') {
          ws.send(JSON.stringify({ type: 'birth:start', witnessName: 'HandoffWitness', isTest: true }));
        }
        if (msg.type === 'birth:stage_complete') {
          if (msg.stage === 4) {
            // The spoken text the client relays — carries NO tool call.
            expect(msg.response).not.toContain('write_file');
            // A native-only stage is SILENT speech-wise — the payload must
            // carry the ceremony-voiced act so the witness still sees the
            // name (observed live: Hale's naming rendered as a bare chip).
            expect(msg.response.trim()).toBe('');
            expect(msg.silentActs).toEqual([`The name is written: ${CHOSEN}`]);
          }
          ws.send(JSON.stringify({ type: 'birth:next_stage', response: msg.response }));
          if (msg.stage === 4) {
            // The stage-4 relay just went through the route threading; the
            // handler's verdict is readable the moment stage 5 dispatches.
            setTimeout(() => {
              clearTimeout(timer);
              resolve([...handler.activeSessions.values()][0]);
            }, 1500);
          }
        }
        // This walk's claim ends at stage 4. The stand-in substrate speaks prose
        // at stage 5 and writes no DNA, so since fd4eb37fa the ceremony holds
        // there ([…]) — which can arrive inside
        // the wait above. Reaching stage 5 means the naming verdict is in.
        if (msg.type === 'birth:error' && msg.stage === 5) {
          clearTimeout(timer);
          resolve([...handler.activeSessions.values()][0]);
          return;
        }
        if (msg.type === 'birth:ended' || msg.type === 'birth:error') {
          clearTimeout(timer);
          reject(new Error(`ceremony ended early: ${JSON.stringify(msg)}`));
        }
      });
    });

    // Before #140 this walk died here: no_name_declared despite the executed
    // native write. The stash + threading now carry the call to the handler.
    expect(outcome.data.chosenName).toBe(CHOSEN);
    expect(outcome.data.neumaId).toBeTruthy();
    ws.close();
  }, 30000);
});
