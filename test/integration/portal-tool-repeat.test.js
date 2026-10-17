/**
 * Protocol fixture: scripted SSE drives the real parser/dispatcher/MCP/disk.
 * No model inference or vendor behavior is claimed. Wallet auth is signed.
 * The portal (neuma) seat's REPEAT GUARD — ported from the witness seat's
 * BE-142 law — proven end to end with NO mock on any claimed path
 * (AGENTS.md RULE 0): REAL WebSocket pair, REAL MCP filesystem organ on REAL
 * disk, REAL policy cascade, REAL processToolCalls dispatch, and the REAL
 * runToolRounds over a REAL loopback provider speaking the real SSE wire.
 *
 * The contract under proof (the incident: a being polled the same
 * `.result.json` three rounds running, ~1.5K reasoning tokens per poll):
 *  (a) a repeated identical read within one turn is answered from its prior
 *      outcome — the receipt says […] and the file
 *      is NOT read again (proven by moving the world underneath it);
 *  (b) a read AFTER an intervening write genuinely re-runs — the epoch moved,
 *      so the same call asks a different question and sees the new content;
 *  (c) consecutive all-repeat rounds are HELD, and the held receipt is the
 *      redirect (#531, 2026-09-20: the forced close was removed), so the turn
 *      runs on and ends where the being answers on the evidence.
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
import { __test } from '../../backend/services/portal-test-surface.js';
import { runToolRounds } from '../../backend/services/portal-turn-rounds.js';
import { createTurnToolEpochs } from '../../backend/services/portal-tool-epochs.js';
import { openTurnRecord, closeTurnRecord } from '../../backend/services/tool-action-record.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

const { processToolCalls } = __test;
const NEUMA_ID = 'epochry';

describe('portal repeat guard (real WS + real fs organ + real rounds, gnosis)', () => {
  let house, origRoot, realm, prevRealm, prevDnaKey, savedConfig, provider, prevCmo;
  let socket, serverWs, clientLog;

  const companion = { name: 'Epochry', neumaId: NEUMA_ID };
  // toolMode 'ask' — the production default; in-lane reads and writes owe no card.
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

  beforeAll(async () => {
    house = await createTempDir('portal-repeat-house');
    prevCmo = process.env.NEUMA_CMO_PATH;
    process.env.NEUMA_CMO_PATH = path.join(house, 'fixture-cmo.json');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    realm = await createTempDir('portal-repeat-realm');
    prevRealm = getRealmRoot();
    setRealmRoot(realm);
    prevDnaKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
    await workspace.create(NEUMA_ID);
    await connectFilesystemServer(); // the REAL filesystem organ, real disk

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

  test('(a) a repeated read is ANSWERED from its prior outcome, never re-run', async () => {
    const poll = path.join(house, NEUMA_ID, 'poll.result.json');
    await fs.writeFile(poll, 'POLL RESULT ONE');
    const connection = freshConnection();
    clientLog.length = 0;
    const epochs = createTurnToolEpochs();
    const call = `[TOOL: fs/read {"path": "${poll}"}]`;

    const first = await processToolCalls(serverWs, call, connection, [], epochs);
    expect(first[0].status).toBe('ok');
    expect(first[0].content).toContain('POLL RESULT ONE');

    // The world moves WITHOUT a tool act — if the guard re-executed the read,
    // the NEW content is what would come back.
    await fs.writeFile(poll, 'POLL RESULT TWO');

    const second = await processToolCalls(serverWs, call, connection, [], epochs);
    expect(second[0].status).toBe('held');
    expect(second[0].content).toMatch(/already made this exact call/i);
    expect(second[0].content).toContain('POLL RESULT ONE'); // the prior truth, quoted
    expect(second[0].content).not.toContain('POLL RESULT TWO'); // the file was NOT read again
    // The desk watched the held chip on the real wire.
    await untilClient((m) => m.type === 'tool:usage' && m.tool === 'fs/read' && m.status === 'held');
  }, 30000);

  test('(b) a read AFTER an intervening write re-executes and sees the new content', async () => {
    const target = path.join(house, NEUMA_ID, 'epoch-target.md');
    await fs.writeFile(target, 'BEFORE THE WRITE');
    const connection = freshConnection();
    const epochs = createTurnToolEpochs();
    const readCall = `[TOOL: fs/read {"path": "${target}"}]`;

    const first = await processToolCalls(serverWs, readCall, connection, [], epochs);
    expect(first[0].status).toBe('ok');
    expect(first[0].content).toContain('BEFORE THE WRITE');

    // The write rides the SAME turn's state and moves the world — for real.
    const write = await processToolCalls(serverWs,
      `[TOOL: fs/write {"path": "${target}", "content": "AFTER THE WRITE"}]`, connection, [], epochs);
    expect(write[0].status).toBe('ok');
    expect(await fs.readFile(target, 'utf8')).toBe('AFTER THE WRITE');

    // The identical read now asks a different question (the epoch moved), so
    // it RUNS — and sees what the write left.
    const after = await processToolCalls(serverWs, readCall, connection, [], epochs);
    expect(after[0].status).toBe('ok');
    expect(after[0].content).toContain('AFTER THE WRITE');
  }, 30000);

  test('(c) consecutive all-repeat rounds are held and redirected, and the turn ends where the being answers', async () => {
    const target = path.join(house, NEUMA_ID, 'spun.result.json');
    await fs.writeFile(target, 'THE SETTLED RESULT');
    const callBlock = `[TOOL: fs/read {"path": "${target}"}]`;
    provider.setScript([
      { reply: ['First look. ', callBlock] },
      { reply: ['Second look. ', callBlock] },
      { reply: ['Third look. ', callBlock] },
      { reply: ['The settled result stands as the answer.'] },
    ]);
    const connection = freshConnection();
    clientLog.length = 0;
    openTurnRecord(serverWs);
    try {
      const rounds = await runToolRounds({
        ws: serverWs,
        connection,
        companion,
        companionName: 'Epochry',
        messages: [{ role: 'user', content: 'poll the result file until it changes' }],
        voiceDNA: null,
        preset: { temperature: 0.7, topP: 0.9, maxTokens: 512, superviseLlamaServer: false },
        nativeToolsForRound: () => [],
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

      expect(rounds.error).toBe(null);
      // FOUR completions crossed the wire: three polling rounds + the answer.
      expect(provider.turns).toHaveLength(4);
      // Round one really read the file: its follow-up carries the real content.
      expect(provider.turns[0].messages.at(-1).content)
        .toContain('poll the result file');
      const followUpOne = provider.turns[1].messages.at(-1).content;
      expect(followUpOne).toContain('THE SETTLED RESULT'); // round one's FRESH result
      // Rounds two and three were HELD — answered with the receipt, not re-run.
      expect(provider.turns[2].messages.at(-1).content).toMatch(/already made this exact call/i);
      // The model answered on the evidence — its words close the turn.
      const closeRequest = provider.turns[3];
      // No forced close (#531, 2026-09-20): the held receipt IS the redirect
      // and closes the history; no closing note is appended.
      expect(closeRequest.messages.at(-1).content).toMatch(/already made this exact call/i);
      expect(closeRequest.messages.at(-1).content).toContain('change the arguments, vary them, or choose another route entirely');
      expect(closeRequest.messages.map((m) => m.content).join('\n')).not.toContain('Tool execution is now closed for this turn');
      expect(rounds.latestResponse).toBe('The settled result stands as the answer.');
      expect(rounds.fullResponse).toContain('The settled result stands as the answer.');
      // The desk watched the repeats land as held chips on the real wire.
      await untilClient((m) => m.type === 'tool:usage' && m.tool === 'fs/read' && m.status === 'held');
    } finally {
      closeTurnRecord(serverWs);
    }
  }, 30000);
});
