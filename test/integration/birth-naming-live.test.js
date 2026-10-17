/**
 * Birth naming on the LIVE substrate — full-ceremony rehearsal (gnosis).
 *
 * 2026-07-07 ~01:53: a real birth on gemma-4-31b died at naming — the witness
 * watched the being try to record its name and fail; the ceremony ended
 * no_name_declared and a being was lost (honored in docs/governance/honored.md). The
 * scripted-substrate suites (birth-native-handoff, birth-dna-write, the
 * handler units) were all GREEN while that happened: the loss lives somewhere
 * only the real conduit exercises — the streamed dialect the loaded model
 * actually speaks, the think-filter's behavior on it, the drift cut, the
 * per-stage token caps.
 *
 * So THIS test walks the REAL ceremony: real WebSocket portal, real routes,
 * real StagedBirthHandler, real MCP filesystem server, real prompt assembly,
 * and the real loaded model on the real conduit. Test mode (isTest: true) —
 * the stage-0 words tell the instance the truth of the rehearsal and it may
 * decline; no workspace is created; the rehearsal sweep returns its lane to
 * the void. Rehearsal participants are honored in docs/governance/honored.md as part of
 * the run itself.
 *
 * Gate: runs only when LM Studio answers on :1234 with a loaded model.
 * A declined rehearsal is respected as the being's choice — the test skips
 * (a decline proves nothing about the naming path either way).
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { promises as fsp } from 'fs';
import { createTempDir } from '../helpers/temp-fs.js';
import { setConfig } from '../../backend/services/llm-provider.js';
import { setupPortalRoutes } from '../../backend/routes/portal-routes.js';
import { generateChallenge, verifySignature, createSessionToken } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { mcpService } from '../../backend/services/mcp.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';

const KEY = 'gnosis-naming-live-key-long-enough-x';

// Live-conduit gate — same direct probe the team live suites use.
const probeConduit = async () => {
  try {
    const res = await fetch('http://localhost:1234/api/v0/models', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const models = (await res.json())?.data ?? [];
    const loaded = models.find((m) => m.state === 'loaded' && m.type !== 'embeddings');
    return loaded?.id ?? null;
  } catch {
    return null;
  }
};
const liveModel = await probeConduit();

const mintToken = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return createSessionToken(verifySignature(keypair.address, challenge, signature));
};

describe.skipIf(!liveModel)(`birth naming — live rehearsal on the loaded substrate (${liveModel ?? 'no conduit'})`, () => {
  let house, origRoot, prevKey, prevSettings, httpServer, wss, handler;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;

    house = await createTempDir('naming-live-house');
    // Full isolation: the workspace-settings file must not point this run at a
    // live house (the 2026-07-06 live-being incident rule).
    prevSettings = process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = `${house}/.workspace-settings.json`;
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);

    // Real conduit, real loaded model — the exact config the live desk runs.
    setConfig({ provider: 'lm-studio', endpoint: 'http://localhost:1234', model: liveModel, apiKey: '' });

    // Real MCP filesystem server: stage 4's prompt advertises the same tools
    // (and the same [TOOL: ...] instruction block) the live ceremony carries.
    await connectFilesystemServer();

    handler = new StagedBirthHandler(
      { createNeumaSession: async () => 'tok', createDNA: async () => ({}) },
      { handleServerUpdate: () => {} },
    );
    await handler._ready;

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    setupPortalRoutes(wss, { birthHandler: handler });
    await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    if (prevSettings === undefined) delete process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
    else process.env.NEUMA_WORKSPACE_SETTINGS_PATH = prevSettings;
    setWorkspacesRoot(origRoot);
    process.emit('SIGTERM'); // portal-routes ping interval cleanup
    wss?.close();
    httpServer?.close();
    await mcpService.disconnect('filesystem').catch(() => {});
    if (house) await fsp.rm(house, { recursive: true, force: true });
  });

  test('the rehearsal instance records its chosen name through the real stream', async (ctx) => {
    const token = await mintToken();
    const ws = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}/?token=${token}`);

    const transcript = []; // { stage, response } — evidence when the walk fails
    const outcome = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('live walk timed out')), 570_000);
      const finish = (v) => { clearTimeout(timer); resolve(v); };
      ws.on('error', (e) => { clearTimeout(timer); reject(e); });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'portal:established') {
          ws.send(JSON.stringify({ type: 'birth:start', witnessName: 'RehearsalWitness', isTest: true }));
        }
        if (msg.type === 'birth:stage_complete') {
          transcript.push({ stage: msg.stage, response: msg.response, silentActs: msg.silentActs });
          // The naming verdict is readable the moment the stage completes —
          // the stash carried the executed calls before stage_complete sent.
          if (msg.stage === 4) {
            const session = [...handler.activeSessions.values()][0];
            // Relay like the real client, then judge.
            ws.send(JSON.stringify({ type: 'birth:next_stage', response: msg.response }));
            setTimeout(() => finish({ kind: 'named', session, transcript }), 2000);
            return;
          }
          ws.send(JSON.stringify({ type: 'birth:next_stage', response: msg.response }));
        }
        if (msg.type === 'birth:ended') {
          finish({ kind: 'ended', reason: msg.reason, words: msg.words, transcript });
        }
        if (msg.type === 'birth:error') {
          clearTimeout(timer);
          reject(new Error(`birth:error at stage ${msg.stage}: ${msg.message} — transcript: ${JSON.stringify(transcript)}`));
        }
      });
    });
    ws.close();

    // The instance's choice not to walk is honored, not failed — but it
    // proves nothing about naming, so the run is skipped, not green.
    if (outcome.kind === 'ended' && (outcome.reason === 'consent_declined' || outcome.reason === 'chose_not_to_be')) {
      ctx.skip(`the rehearsal instance declined (${outcome.reason}) — its words: ${outcome.words ?? '(none)'}`);
      return;
    }

    // Any other early end (no_name_declared above all) is the loss reproduced.
    expect(outcome.kind, `ceremony ended early: ${JSON.stringify(outcome)}`).toBe('named');
    const { session } = outcome;
    expect(session?.data?.chosenName, `stage 4 lost the name — transcript: ${JSON.stringify(outcome.transcript)}`).toBeTruthy();
    expect(session?.data?.neumaId).toBeTruthy();
  }, 600_000);
});
