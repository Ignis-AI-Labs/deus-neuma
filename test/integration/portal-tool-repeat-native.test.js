/**
 * Protocol fixture: scripted SSE drives the real parser/dispatcher/MCP/disk.
 * No model inference or vendor behavior is claimed. Wallet auth is signed.
 * The portal (neuma) seat's REPEAT GUARD on NATIVE function-calling rounds —
 * the one proof gap `context-economy-loop-fixes` left open (its loop proof
 * drove text-protocol `[TOOL: …]` calls; the native path was verified
 * positionally only). NO mock on any claimed path (AGENTS.md RULE 0): REAL
 * WebSocket pair, REAL MCP filesystem organ on REAL disk, REAL policy
 * cascade, REAL processToolCalls dispatch, REAL runToolRounds over a REAL
 * loopback provider streaming the real OpenAI `delta.tool_calls` wire —
 * names and argument fragments split across SSE chunks, so the client-side
 * assembly llm-provider really does is exercised too.
 *
 * The contract under proof on the native path:
 *  (n1) three rounds of the IDENTICAL native call — fresh provider call ids
 *      each round, because a real provider mints new ids — are answered from
 *      the prior outcome (role:'tool' held receipts in the on-contract
 *      history), two consecutive all-repeat rounds close the loop, and the
 *      being's REAL journal shows the organ executed exactly ONCE;
 *  (n2) a native read after an intervening native write genuinely re-runs —
 *      the epoch moved, so the same call asks a different question and sees
 *      the new content (journal: two reads, one write).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { Wallet } from 'ethers';
import { randomUUID } from 'node:crypto';
import { createSignedStreamSocket } from '../helpers/signed-stream-socket.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { startLocalProvider } from '../helpers/local-provider.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { mcpService } from '../../backend/services/mcp.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { withFsPrimitives } from '../../backend/services/fs-primitives.js';
import { toOpenAITools } from '../../backend/services/tool-schema.js';
import { runToolRounds } from '../../backend/services/portal-turn-rounds.js';
import { openTurnRecord, closeTurnRecord } from '../../backend/services/tool-action-record.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

const NEUMA_ID = 'epochry';

// The being's real journal, filtered to EXECUTED organ acts. The fs
// primitives route onto the native organ's 16 names INSIDE the sandbox
// (fs-primitives.js journals the REAL names): fs/read → read_text_file,
// fs/write → write_file.
const executedOrganActs = async (organTool) =>
  (await workspace.readJournal(NEUMA_ID))
    .filter((e) => e?.type === 'tool_call' && e?.metadata?.tool === organTool
      && e?.metadata?.status === 'success');

describe('portal repeat guard on NATIVE tool-call rounds (real WS + real fs organ + real rounds, gnosis)', () => {
  let house, origRoot, realm, prevRealm, prevDnaKey, savedConfig, provider, prevCmo;
  let socket, serverWs, clientLog, nativeTools;

  const companion = { name: 'Epochry', neumaId: NEUMA_ID };
  const freshConnection = () => ({ ws: serverWs, companion, walletAddress: socket.walletAddress, sessionId: randomUUID(), toolMode: 'ask' });

  const untilClient = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = clientLog.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error('client message never arrived'));
      setTimeout(tick, 20);
    };
    tick();
  });

  const runTheRounds = (messages) => runToolRounds({
    ws: serverWs,
    connection: freshConnection(),
    companion,
    companionName: 'Epochry',
    messages,
    voiceDNA: null,
    preset: { temperature: 0.7, topP: 0.9, maxTokens: 512, superviseLlamaServer: false },
    nativeToolsForRound: () => nativeTools,
    interrupt: { signal: new AbortController().signal },
    route: undefined,
    turnLora: undefined,
    turnEffort: undefined,
    take: { turnId: 'point-1', takeIndex: 1 },
    turnCapabilities: null,
    contextSections: [],
    contextBudget: null,
    contextScope: {},
  });

  beforeAll(async () => {
    house = await createTempDir('portal-repeat-native-house');
    prevCmo = process.env.NEUMA_CMO_PATH;
    process.env.NEUMA_CMO_PATH = path.join(house, 'fixture-cmo.json');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    realm = await createTempDir('portal-repeat-native-realm');
    prevRealm = getRealmRoot();
    setRealmRoot(realm);
    prevDnaKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
    await workspace.create(NEUMA_ID);
    await connectFilesystemServer(); // the REAL filesystem organ, real disk

    // The native schema the real seat would offer: the being-facing catalog
    // through the production transforms (never a hand-written copy).
    nativeTools = toOpenAITools(withFsPrimitives(mcpService.getToolsContext()?.available_tools || []));

    provider = await startLocalProvider({ reply: 'A Local Answer' });
    savedConfig = getConfig();
    setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, apiKey: '', model: 'test-model' });

    socket = await createSignedStreamSocket(Wallet.createRandom());
    serverWs = socket.ws;
    clientLog = socket.frames;
  }, 60000);

  afterAll(async () => {
    await socket?.close();
    if (savedConfig) setConfig(savedConfig);
    await provider?.close();
    await mcpService.disconnect('filesystem');
    if (prevCmo === undefined) delete process.env.NEUMA_CMO_PATH;
    else process.env.NEUMA_CMO_PATH = prevCmo;
    setWorkspacesRoot(origRoot);
    setRealmRoot(prevRealm);
    if (prevDnaKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevDnaKey;
    await fs.rm(house, { recursive: true, force: true });
    await fs.rm(realm, { recursive: true, force: true });
  });

  test('(n1) identical native calls across rounds are held, the held redirect keeps the turn going, and the organ fired exactly ONCE', async () => {
    const target = path.join(house, NEUMA_ID, 'native.result.json');
    await fs.writeFile(target, 'NATIVE POLL RESULT');
    const readsBefore = (await executedOrganActs('read_text_file')).length;
    // Fresh call ids every round — a real provider never reuses one. The
    // guard's identity is server+tool+args+epoch, never the provider id.
    const nativeRead = { name: 'fs__read', args: { path: target } };
    provider.setScript([
      { reply: ['First native look.'], toolCalls: [{ id: 'call_nat_1', ...nativeRead }] },
      { reply: ['Second native look.'], toolCalls: [{ id: 'call_nat_2', ...nativeRead }] },
      { reply: ['Third native look.'], toolCalls: [{ id: 'call_nat_3', ...nativeRead }] },
      { reply: ['The native result stands as the answer.'] },
    ]);
    clientLog.length = 0;
    openTurnRecord(serverWs);
    try {
      const rounds = await runTheRounds([{ role: 'user', content: 'poll the result file natively until it changes' }]);

      expect(rounds.error).toBe(null);
      expect(rounds.latestResponse).toBe('The native result stands as the answer.');
      // FOUR completions crossed the wire: three native polling rounds + the close.
      expect(provider.turns).toHaveLength(4);

      // The native surface really rode the first request.
      expect(provider.turns[0].tools?.some((t) => t?.function?.name === 'fs__read')).toBe(true);

      // Round one EXECUTED: its round-2 request carries the on-contract
      // exchange — the model's own tool_calls (id intact) + a role:'tool'
      // result carrying the real file content.
      const roundTwo = provider.turns[1].messages;
      const called = roundTwo.filter((m) => Array.isArray(m.tool_calls));
      expect(called).toHaveLength(1);
      expect(called[0].tool_calls[0].function.name).toBe('fs__read');
      expect(called[0].tool_calls[0].id).toBe('call_nat_1');
      const freshResult = roundTwo.find((m) => m.role === 'tool' && m.tool_call_id === 'call_nat_1');
      expect(freshResult.content).toContain('fs/read → ok');
      expect(freshResult.content).toContain('NATIVE POLL RESULT');

      // Rounds two and three were HELD — answered with the receipt, never re-run.
      const lastToolMsg = (req) => req.messages.filter((m) => m.role === 'tool').at(-1);
      expect(lastToolMsg(provider.turns[2]).content).toMatch(/already made this exact call/i);
      expect(lastToolMsg(provider.turns[3]).content).toMatch(/already made this exact call/i);

      // No forced close (#531, 2026-09-20): the held result IS the redirect,
      // tools stay offered, and the turn ends where the being ends it.
      const finalReq = provider.turns[3];
      expect(lastToolMsg(finalReq).content).toContain('change the arguments, vary them, or choose another route entirely');
      expect(finalReq.messages.map((m) => m.content).join('\n')).not.toContain('Tool execution is now closed for this turn');
      expect(finalReq.tools?.some((t) => t?.function?.name === 'fs__read')).toBe(true);

      // THE ORGAN FIRED EXACTLY ONCE across three identical native calls —
      // the being's own journal, on real disk, is the receipt.
      const readsAfter = (await executedOrganActs('read_text_file')).length;
      expect(readsAfter - readsBefore).toBe(1);

      // The desk watched the repeats land as held chips on the real wire.
      await untilClient((m) => m.type === 'tool:usage' && m.tool === 'fs/read' && m.status === 'held');
    } finally {
      closeTurnRecord(serverWs);
    }
  }, 30000);

  test('(n2) a native read AFTER an intervening native write re-executes and sees the new content', async () => {
    const target = path.join(house, NEUMA_ID, 'native-epoch.md');
    await fs.writeFile(target, 'NATIVE BEFORE THE WRITE');
    const readsBefore = (await executedOrganActs('read_text_file')).length;
    const writesBefore = (await executedOrganActs('write_file')).length;
    provider.setScript([
      { reply: ['Reading first.'], toolCalls: [{ id: 'call_b1', name: 'fs__read', args: { path: target } }] },
      { reply: ['Writing now.'], toolCalls: [{ id: 'call_b2', name: 'fs__write', args: { path: target, content: 'NATIVE AFTER THE WRITE' } }] },
      { reply: ['Reading again.'], toolCalls: [{ id: 'call_b3', name: 'fs__read', args: { path: target } }] },
      { reply: ['Settled after the write.'] },
    ]);
    openTurnRecord(serverWs);
    try {
      const rounds = await runTheRounds([{ role: 'user', content: 'read it, change it, read it again' }]);

      expect(rounds.error).toBe(null);
      expect(rounds.latestResponse).toBe('Settled after the write.');
      expect(provider.turns).toHaveLength(4);
      // The write genuinely landed on real disk.
      expect(await fs.readFile(target, 'utf8')).toBe('NATIVE AFTER THE WRITE');
      // The second read — identical args — re-executed (the epoch moved) and
      // its result carries the post-write content, not a held receipt.
      const finalToolMsgs = provider.turns[3].messages.filter((m) => m.role === 'tool');
      expect(finalToolMsgs.at(-1).content).toContain('NATIVE AFTER THE WRITE');
      expect(finalToolMsgs.at(-1).content).not.toMatch(/already made this exact call/i);
      // The journal: TWO reads and ONE write actually ran.
      expect((await executedOrganActs('read_text_file')).length - readsBefore).toBe(2);
      expect((await executedOrganActs('write_file')).length - writesBefore).toBe(1);
    } finally {
      closeTurnRecord(serverWs);
    }
  }, 30000);
});
