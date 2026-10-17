/**
 * Protocol fixture: a REAL loopback provider speaking the real SSE wire, a
 * REAL WebSocket pair, and the REAL runToolRounds. No model inference is
 * claimed; no mock sits on any claimed path (AGENTS.md RULE 0).
 *
 * The contract under proof (the incident, 2026-09-15: metidar on the
 * Qwen3.8-27B local substrate streamed the same plan block verbatim until
 * the output budget died — no tool call for the seat guards to see):
 *  (a) THE SPEECH LOOP BREAKER — one completion whose speech repeats a
 *      verbatim block is CUT after one redundant period; the round's record
 *      keeps the being's words exactly once; the turn settles with no error;
 *      a non-repeating stream passes byte-untouched;
 *  (b) THE SPEECH-LOOP ROUND GUARD — consecutive rounds that say the same
 *      words while FRESH calls fail (never a held repeat) close the loop
 *      with the honest note, and the turn ends on the model's own answer.
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
import { runToolRounds } from '../../backend/services/portal-turn-rounds.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

const NEUMA_ID = 'loopy';

// A plan block well past the smallest guard period (96 normalized chars):
// the shape the incident streamed — a coherent multi-sentence paragraph.
const PLAN_BLOCK = 'I have everything I need. Let me lay out what I am building before I write a word. '
  + 'The claim is the campaign launch, distinct from every post we have shipped so far. '
  + 'The numbers come from the debrief, all honest, with the objective value locked in and planned.';

const countNormalized = (haystack, needle) =>
  haystack.toLowerCase().replace(/\s+/g, ' ').split(needle.toLowerCase().replace(/\s+/g, ' ')).length - 1;

describe('speech loop breaker (real WS + real rounds + real loopback provider, gnosis)', () => {
  let house, origRoot, realm, prevRealm, prevDnaKey, savedConfig, provider;
  let socket, serverWs, clientLog;

  const companion = { name: 'Loopy', neumaId: NEUMA_ID };
  const freshConnection = () => ({ ws: serverWs, companion, walletAddress: socket.walletAddress, sessionId: randomUUID(), toolMode: 'ask' });

  const runTurn = () => runToolRounds({
    ws: serverWs,
    connection: freshConnection(),
    companion,
    companionName: 'Loopy',
    messages: [{ role: 'user', content: 'write the campaign launch post' }],
    voiceDNA: null,
    preset: { temperature: 0.7, topP: 0.9, maxTokens: 2048, superviseLlamaServer: false },
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

  beforeAll(async () => {
    house = await createTempDir('speech-loop-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    realm = await createTempDir('speech-loop-realm');
    prevRealm = getRealmRoot();
    setRealmRoot(realm);
    prevDnaKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
    await workspace.create(NEUMA_ID);
    await connectFilesystemServer(); // the REAL filesystem organ — text-dialect fs/read dispatches here

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
    if (prevDnaKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevDnaKey;
    setWorkspacesRoot(origRoot);
    setRealmRoot(prevRealm);
    await fs.rm(house, { recursive: true, force: true });
    await fs.rm(realm, { recursive: true, force: true });
  });

  test('(a) a verbatim self-repeating completion is cut; the record keeps the words once', async () => {
    // The degenerate completion: the block, then the SAME block again, then
    // again — streamed as real SSE deltas, as the incident arrived.
    provider.setScript([
      { reply: [PLAN_BLOCK, PLAN_BLOCK, PLAN_BLOCK] },
    ]);
    clientLog.length = 0;
    const rounds = await runTurn();

    expect(rounds.error).toBe(null);
    // ONE completion crossed the wire — the cut ended the round, and with no
    // acts to process the turn settled instead of re-asking.
    expect(provider.turns).toHaveLength(1);
    // The record keeps the being's words EXACTLY ONCE — one copy stands, the
    // redundant periods never persist.
    expect(countNormalized(rounds.fullResponse, PLAN_BLOCK)).toBe(1);
    expect(countNormalized(rounds.latestResponse, PLAN_BLOCK)).toBe(1);
    // The cut is not a failure: the turn closed on the kept speech.
    expect(rounds.latestResponse.trim().length).toBeGreaterThan(0);
  }, 30000);

  test('(b) honest speech passes the breaker byte-untouched', async () => {
    const clean = 'The post is drafted. Here is the opening line, and here is the close. '
      + 'Tell me if the voice lands before I render the announcement card.';
    provider.setScript([{ reply: [clean] }]);
    const rounds = await runTurn();

    expect(rounds.error).toBe(null);
    expect(rounds.latestResponse).toBe(clean); // byte-identical — no guard interference
  }, 30000);

  test('(c) two same-speech rounds over fresh failing calls close the loop with the honest note', async () => {
    // The incident's round shape: each round re-states the plan VERBATIM and
    // calls a render-ish read that FAILS — and each call is FRESH (differing
    // path), so the held-repeat guard never fires. Text-dialect tool markup
    // parses through the real dispatcher; the missing files really fail.
    const miss = (n) => path.join(house, NEUMA_ID, `render-kit-${n}.json`);
    const speech = 'Let me render the card first, one per round, then write the post from the debrief numbers. '
      + 'The claim is the campaign launch and the flywheel carries it.';
    const plan = (n) => ({ reply: [`${speech} [TOOL: fs/read {"path": "${miss(n)}"}]`] });
    provider.setScript([
      plan(1),
      plan(2),
      plan(3),
      { reply: ['The kit is missing and the renders failed. I need the image pipeline restored before the post can ship.'] },
    ]);
    clientLog.length = 0;
    const rounds = await runTurn();

    expect(rounds.error).toBe(null);
    // FOUR completions: three spinning rounds + the close.
    expect(provider.turns).toHaveLength(4);
    // The failing calls really ran and really failed — fresh keys, never held.
    const followUpOne = provider.turns[1].messages.at(-1).content;
    expect(followUpOne).toContain('fs/read → error');
    expect(followUpOne).not.toMatch(/already made this exact call/i);
    // The closing note rode the final request, in the speech guard's words.
    const closeRequest = provider.turns[3];
    expect(closeRequest.messages.at(-1).content)
      .toContain('repeated the same words across consecutive rounds');
    expect(closeRequest.messages.at(-1).content)
      .toContain('Do not emit another tool call this turn');
    // The model's own words close the turn.
    expect(rounds.latestResponse).toBe('The kit is missing and the renders failed. I need the image pipeline restored before the post can ship.');
  }, 30000);

  test('(d) PARAPHRASED rounds over fresh failing calls close the loop too', async () => {
    // The 2026-09-25 incident, in the being's own words: the same stuck plan
    // restated in shifting phrasing each round — verbatim never matched.
    const miss = (n) => path.join(house, NEUMA_ID, `staged-${n}.png`);
    const said = [
      "The screenshot isn't on disk yet — message attachments don't auto-save into the workspace. Let me check if the harness staged it anywhere I can reach.",
      "The screenshot is a message attachment — I can see it, but it's not on disk yet, so I can't attach it to a post until it's saved as a file. Let me check if the harness staged it anywhere I can reach.",
      "The screenshot isn't on disk — it's a message attachment I can see but can't attach to a post until it's saved as a file. Let me check if the harness staged it anywhere I can reach.",
    ];
    provider.setScript([
      ...said.map((text, n) => ({ reply: [`${text} [TOOL: fs/read {"path": "${miss(n)}"}]`] })),
      { reply: ['The screenshot never reached disk. Save it into the Content folder and I will stage the post.'] },
    ]);
    const rounds = await runTurn();

    expect(rounds.error).toBe(null);
    expect(provider.turns).toHaveLength(4);
    expect(provider.turns[3].messages.at(-1).content).toContain('repeated the same words across consecutive rounds');
    expect(rounds.latestResponse).toMatch(/^The screenshot never reached disk/);
  }, 30000);
});
