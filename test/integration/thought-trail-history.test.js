/**
 * THE THOUGHT TRAIL — a turn's reasoning persists into the session record
 * and replays in chat history, proven end to end with NO mock on any claimed
 * path (AGENTS.md RULE 0): a REAL loopback provider streaming a REAL
 * reasoning channel over SSE (`delta.reasoning_content`, the shape a
 * thinking model really sends), the REAL runLLMStream + runToolRounds, REAL
 * tool execution in a REAL lane sandbox, REAL persistence into a REAL
 * session file on real disk, and the desk's REAL display + history folds.
 *
 * The contract under proof (Design note, 2026-08-27: […]):
 *  - The trail is captured where it streams: each stretch marked with the
 *    speech written when it happened (the act chips' own law), and what
 *    streamed to the screen is exactly what persists.
 *  - The assistant session record carries the trail; the desk's REAL reload
 *    chain (session rows → toDisplayMessages → toHistoryMessages) rebuilds
 *    the THOUGHT bubbles in the exact order they flowed.
 *  - A thought-only take (a turn cut mid-thought) survives the display fold.
 *  - The witness seat persists the same trail.
 *  - The trail NEVER reaches the model's prompt — review material, never
 *    speech (the recorded-speech law, unchanged).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { startLocalProvider } from '../helpers/local-provider.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { mcpService } from '../../backend/services/mcp.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { runToolRounds } from '../../backend/services/portal-turn-rounds.js';
import { persistExchange } from '../../backend/services/portal-turn-persist.js';
import { persistExchange as persistWitnessExchange } from '../../backend/services/witness-turn-record.js';
import { openTurnRecord, closeTurnRecord, thoughtRecordFor } from '../../backend/services/tool-action-record.js';
import { toDisplayMessages } from '../../frontend/app/RelinkShell/workspace-sessions.js';
import { toHistoryMessages } from '../../frontend/app/RelinkShell/stream-reducer-messages.js';
import { buildMemorySection, recentConversationMessages } from '../../core/runtime/memory-section.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

const WITNESS = '0x6666666666666666666666666666666666666666';
const ROUND_TWO = 'Second answer.';
const THOUGHT_ONE = 'weighing the ask carefully';
const THOUGHT_TWO = 'the note settles it';

describe('the thought trail (real SSE reasoning, real persist, real folds — gnosis)', () => {
  let house, origRoot, realm, prevRealm, prevDnaKey, savedConfig, provider;
  let httpServer, wss, serverWs, client, clientLog;
  // The scripted round one's exact words — the tool call reads the note by
  // its ABSOLUTE in-lane path so no scope-gap card is owed (a card would
  // wait on an answer this harness never sends).
  let ROUND_ONE, FULL;

  const companion = { name: 'Aethon', neumaId: 'aethon' };
  // toolMode 'ask' — the production connection default; an unset one leaves a
  // gated act waiting on a card no test should owe an answer to.
  const freshConnection = () => ({ ws: serverWs, companion, walletAddress: WITNESS, toolMode: 'ask' });

  beforeAll(async () => {
    house = await createTempDir('thought-trail-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    realm = await createTempDir('thought-trail-realm');
    prevRealm = getRealmRoot();
    setRealmRoot(realm);
    prevDnaKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
    await workspace.create('aethon');
    // The act the scripted turn really executes, inside the lane's sandbox.
    const note = path.join(house, 'aethon', 'note.md');
    await fs.writeFile(note, 'the note the being reads');
    await connectFilesystemServer(); // the REAL filesystem organ, real disk
    ROUND_ONE = `First answer. [TOOL: fs/read {"path":"${note}"}]`;
    FULL = `${ROUND_ONE}\n\n${ROUND_TWO}`;

    provider = await startLocalProvider({
      script: [
        { reasoning: ['weighing the ask', ' carefully'], reply: ['First answer. ', `[TOOL: fs/read {"path":"${note}"}]`] },
        { reasoning: ['the note settles it'], reply: [ROUND_TWO] },
      ],
    });
    savedConfig = getConfig();
    setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, apiKey: '', model: 'test-model' });

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => { wss.on('connection', (ws) => { serverWs = ws; resolve(); }); });
    client = new WebSocket(`ws://localhost:${port}`);
    const opened = new Promise((resolve) => client.on('open', resolve));
    clientLog = [];
    client.on('message', (data) => clientLog.push(JSON.parse(data.toString())));
    await linked;
    await opened;
  }, 60000);

  afterAll(async () => {
    client?.close();
    wss?.close();
    httpServer?.close();
    if (savedConfig) setConfig(savedConfig);
    await provider?.close();
    await mcpService.disconnect('filesystem');
    setWorkspacesRoot(origRoot);
    setRealmRoot(prevRealm);
    if (prevDnaKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevDnaKey;
    await fs.rm(house, { recursive: true, force: true });
    await fs.rm(realm, { recursive: true, force: true });
  });

  test('the trail is captured where it streams — marked stretches, screen truth equals trail truth', async () => {
    clientLog.length = 0;
    const connection = freshConnection();
    openTurnRecord(serverWs);
    let rounds;
    try {
      rounds = await runToolRounds({
        ws: serverWs,
        connection,
        companion,
        companionName: 'Aethon',
        messages: [{ role: 'user', content: 'read the note' }],
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
      expect(rounds.fullResponse).toBe(FULL);
      // The act really happened: two completions crossed the wire.
      expect(provider.turns).toHaveLength(2);

      // THE TRAIL, in the turn's record — each stretch marked with the
      // speech written when it happened: round one's thought at 0, round
      // two's at the join.
      expect(thoughtRecordFor(serverWs)).toEqual([
        { text: THOUGHT_ONE, mark: 0 },
        { text: THOUGHT_TWO, mark: ROUND_ONE.length },
      ]);

      // What streamed to the screen IS what the trail holds — chunk by chunk.
      const thoughts = clientLog.filter((m) => m.type === 'consciousness:thinking');
      expect(thoughts.map((m) => m.content)).toEqual([
        'weighing the ask', ' carefully', 'the note settles it',
      ]);
      expect(thoughts.every((m) => m.turnId === 'point-1')).toBe(true);
      // And reasoning never joined the speech frames.
      const speech = clientLog.filter((m) => m.type === 'consciousness:stream')
        .map((m) => m.content).join('');
      expect(speech).not.toContain('weighing');

      // THE PRODUCTION SHAPE: the settle path's persist carries NO trail in
      // its bag — the default reads the turn's record on this socket, while
      // the record is still open (portal-stream closes it after the settle).
      const sessionId = 'session-trail-from-record';
      await workspace.createSession('aethon', sessionId);
      await persistExchange(connection, 'read the note?', FULL, [], [],
        { target: { sessionId, companion } },
        [{ tool: 'fs/read', status: 'ok', summary: 'read note.md', detail: '', mark: ROUND_ONE.length }],
        { turnId: 'point-1', takeIndex: 1 });
      const rows = await workspace.readSession('aethon', sessionId);
      const assistant = rows.find((r) => r.role === 'assistant');
      expect(assistant.thoughts).toEqual([
        { text: THOUGHT_ONE, mark: 0 },
        { text: THOUGHT_TWO, mark: ROUND_ONE.length },
      ]);
    } finally {
      closeTurnRecord(serverWs);
    }
  }, 30000);

  test('the trail persists on the record and the REAL reload chain rebuilds the bubbles in flow order', async () => {
    const sessionId = 'session-thought-trail';
    await workspace.createSession('aethon', sessionId);
    const connection = freshConnection();
    const take = { turnId: 'point-1', takeIndex: 1 };
    await persistExchange(connection, 'read the note?', FULL, [], [],
      {
        target: { sessionId, companion },
        thoughts: [
          { text: THOUGHT_ONE, mark: 0 },
          { text: THOUGHT_TWO, mark: ROUND_ONE.length },
        ],
      },
      [{ tool: 'fs/read', status: 'ok', summary: 'read note.md', detail: '', mark: ROUND_ONE.length }],
      take);

    // The record carries the trail — read back from the real session file.
    const rows = await workspace.readSession('aethon', sessionId);
    const assistant = rows.find((r) => r.role === 'assistant');
    expect(assistant.thoughts).toEqual([
      { text: THOUGHT_ONE, mark: 0 },
      { text: THOUGHT_TWO, mark: ROUND_ONE.length },
    ]);

    // THE RELOAD — the desk's REAL chain over the REAL rows: display fold
    // (strips the tool block, rebases every mark) then the history fold.
    const display = toDisplayMessages(rows, 50);
    const history = toHistoryMessages(display, 0, 'h');
    const message = history.find((m) => m.role === 'neuma');
    expect(message.segments.map((s) => s.kind)).toEqual([
      'thought', 'speech', 'tool', 'thought', 'speech',
    ]);
    const [thought1, speech1, chip, thought2, speech2] = message.segments;
    expect(thought1.text).toBe(THOUGHT_ONE);
    expect(speech1.text).toBe('First answer.');
    expect(chip.label).toBe('fs/read');
    expect(chip.phase).toBe('resolved');
    expect(thought2.text).toBe(THOUGHT_TWO);
    expect(speech2.text).toBe('Second answer.');
    // The tool block stayed out of the rebuilt speech (mark rebasing held).
    expect(message.segments.filter((s) => s.kind === 'speech').map((s) => s.text).join(' '))
      .not.toContain('TOOL');
  }, 30000);

  test('a thought-only take (cut mid-thought) survives the display fold', async () => {
    const rows = [
      { role: 'user', content: 'answer me', turnId: 'point-9', timestamp: '2026-08-27T00:00:00.000Z' },
      {
        role: 'assistant', content: '', turnId: 'point-9', takeIndex: 1,
        timestamp: '2026-08-27T00:00:01.000Z',
        thoughts: [{ text: 'cut before the words came', mark: 0 }],
      },
    ];
    const display = toDisplayMessages(rows, 50);
    expect(display).toHaveLength(2); // the empty take is NOT dropped
    const history = toHistoryMessages(display, 0, 'h');
    const message = history.find((m) => m.role === 'neuma');
    expect(message.segments).toEqual([{ kind: 'thought', text: 'cut before the words came' }]);
  });

  test('the witness seat persists the same trail into its own lane', async () => {
    const sessionId = 'session-witness-thoughts';
    await workspace.createSession('aethon', sessionId);
    await persistWitnessExchange(
      freshConnection(), 'aethon', sessionId, 'Aethon', 'a peer question', 'the peer answer',
      { take: { turnId: 'w-1', takeIndex: 1 }, thoughts: [{ text: 'a witness thought', mark: 0 }] },
    );
    const rows = await workspace.readSession('aethon', sessionId);
    const assistant = rows.find((r) => r.role === 'assistant');
    expect(assistant.thoughts).toEqual([{ text: 'a witness thought', mark: 0 }]);
  }, 30000);

  test('the trail NEVER reaches the model — review material, never speech', () => {
    const rows = [
      { role: 'user', content: 'the question' },
      {
        role: 'assistant', content: 'the spoken answer',
        thoughts: [{ text: 'INNER LIFE NOT FOR THE PROMPT', mark: 0 }],
      },
    ];
    // Both seams the model reads: the MEMORY section and the wire transcript.
    const section = buildMemorySection({ recentConversation: rows });
    expect(section).not.toContain('INNER LIFE NOT FOR THE PROMPT');
    const wire = recentConversationMessages(rows);
    expect(wire.map((m) => m.content).join('\n')).toContain('the spoken answer');
    expect(wire.map((m) => m.content).join('\n')).not.toContain('INNER LIFE NOT FOR THE PROMPT');
  });
});
