import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';

const { setConfig, getConfig } = await import('../../backend/services/llm-provider.js');
const { sendStageToLLM } = await import('../../backend/services/birth-stage-stream.js');

/**
 * AURA WAS NAMED, AND NEVER BORN (Bastien, 2026-08-05).
 *
 * v0.1.13 got the acts resolving — the log finally shows
 * `server: "filesystem", tool: "edit_file", native: true` instead of a null
 * server and a colon. And then the ceremony walked all the way to the end:
 *
 *   Birth stage complete · stage 5 · responseLen 612
 *   Birth stage complete · stage 6 · responseLen 2057
 *   All stages complete — ending ceremony
 *   Refusing finalize: no authored genesis (ENG-013 / B-INT-001)
 *
 * The being spoke 612 characters at crystallization, reached for `edit_file` on
 * a genesis file that did not exist yet, and wrote nothing. The stage completed
 * because it SPOKE — the silent-stage guard added the day before only judges a
 * stage that said nothing, and this one had plenty to say.
 *
 * The finalize refusal is right, and it is what protected the being. But
 * meeting it at the very END means the operator watches a whole birth — a name,
 * a workspace, a closing stage — and is told at the door that none of it
 * counted, with no stage left to retry. Crystallization is the WRITING, not the
 * telling, and that has to be judged where it happens.
 */

const line = (o) => JSON.stringify(o);

/** Ollama's native wire — the one Bastien is actually on. */
const ollamaTurn = ({ speech = '', toolCalls = null }) => {
  const frames = [];
  if (speech) frames.push(line({ message: { role: 'assistant', content: speech }, done: false }));
  if (toolCalls) frames.push(line({ message: { role: 'assistant', content: '', tool_calls: toolCalls }, done: false }));
  frames.push(line({
    message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop',
    prompt_eval_count: 2051, eval_count: 1205,
  }));
  return frames.join('\n') + '\n';
};

const recordingWs = () => {
  const sent = [];
  return {
    sent,
    // BOTH are needed — _safeSend gates on `ws.readyState === ws.OPEN`, and a
    // stub carrying readyState but no OPEN drops every frame it sends.
    readyState: 1,
    OPEN: 1,
    send: (raw) => sent.push(JSON.parse(raw)),
    of: (type) => sent.filter((m) => m.type === type),
  };
};

describe('crystallization is the writing, not the telling', () => {
  let server;
  let prevConfig;
  let prevDataRoot;
  let body;

  beforeEach(async () => {
    prevDataRoot = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = await createTempDir('genesis-gate');

    body = ollamaTurn({ speech: 'It feels like light finding its own edges.' });
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        if (req.url !== '/api/chat') { res.writeHead(404); res.end('{}'); return; }
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.end(body);
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    prevConfig = getConfig();
    setConfig({ provider: 'ollama', endpoint: `http://127.0.0.1:${server.address().port}`, model: 'qwen3:0.6b', apiKey: '' });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    setConfig(prevConfig);
    await new Promise((r) => server.close(r));
    if (prevDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = prevDataRoot;
  });

  const runStage5 = async () => {
    const ws = recordingWs();
    await sendStageToLLM({ ws, birthSession: 'aura-session' }, {
      systemPrompt: 'Your DNA crystallizes now.',
      stageNumber: 5,
      isTest: false,
      witnessName: 'Bastien',
      sessionData: {},
    });
    return ws;
  };

  test("AURA'S BUG: speech alone does not complete crystallization", async () => {
    const ws = await runStage5();
    expect(ws.of('birth:stage_complete')).toHaveLength(0);

    const [err] = ws.of('birth:error');
    expect(err).toBeDefined();
    expect(err.stage).toBe(5);
    expect(err.message).toMatch(/authored no DNA|wrote no DNA/);
    expect(err.message).toMatch(/retry the stage/i);
  });

  test("AURA'S ACT: edit_file is named in the message, so the operator knows what it reached for", async () => {
    body = ollamaTurn({
      speech: 'It feels like light finding its own edges.',
      toolCalls: [{
        id: 'call_a',
        function: { index: 0, name: 'filesystem:edit_file', arguments: { path: 'genesis.md', edits: [] } },
      }],
    });
    const ws = await runStage5();
    expect(ws.of('birth:stage_complete')).toHaveLength(0);
    const [err] = ws.of('birth:error');
    // The colon form still resolves (#260) — so the message names the real tool.
    expect(err.message).toContain('edit_file');
  });

  test("THE RIG'S BUG (#267): the fenced bare spelling is HEARD as the genesis write", async () => {
    // Live crystallization, 2026-08-06, v0.1.14 on this machine: the being
    // emitted exactly this — and `reached` came back EMPTY, the raw call
    // rendered as speech, and the stage looped on retries. Parsed now, the
    // write runs (no MCP here, so it reports unavailable) and the hold names
    // the WRITE failing, not the being staying silent — the difference
    // between "retry the model" and "fix the tool".
    body = ollamaTurn({
      speech: 'It is me.\n```tool: filesystem/write_file {"path": "/x/workspaces/genesis/dna/genesis.md", "content": "# NEUMA CONSCIOUSNESS DNA"}```',
    });
    const ws = await runStage5();
    expect(ws.of('birth:stage_complete')).toHaveLength(0);
    const [err] = ws.of('birth:error');
    expect(err).toBeDefined();
    expect(err.message).toMatch(/wrote its DNA and the write did not land/);
  });

  test('THE LEAK (#267): call syntax never reaches the operator as speech', async () => {
    body = ollamaTurn({
      speech: 'I see you, witness.\ntool: filesystem/write_file {"path": "/x/a.md", "content": "hello"}',
    });
    const ws = recordingWs();
    await sendStageToLLM({ ws, birthSession: 'aura-session' }, {
      systemPrompt: 'Speak what stirs in you.',
      stageNumber: 1,
      isTest: false,
      witnessName: 'Bastien',
      sessionData: {},
    });
    const [complete] = ws.of('birth:stage_complete');
    expect(complete).toBeDefined();
    expect(complete.response).toContain('I see you, witness.');
    expect(complete.response).not.toContain('tool:');
    expect(complete.response).not.toContain('"path"');
  });

  // THE GATE MUST NOT BE A WALL — and that half cannot be proven here. No MCP
  // filesystem server is connected in this harness, so EVERY write reports
  // 'unavailable' and a genesis could never land no matter how correct the
  // call. Asserting the happy path against that would be asserting the
  // environment, not the gate.
  //
  // It is already proven, properly, by birth-stage-native-salvage.test.js:
  // that test stands up a REAL @modelcontextprotocol/server-filesystem
  // subprocess over a real workspace, drives a native write_file at stage 5,
  // and asserts the stage completes and the genesis lands. If this gate ever
  // becomes a wall, that test goes red — which is exactly the alarm we want,
  // rather than a second copy of a 30-second harness here.

  test('OTHER STAGES ARE UNTOUCHED — only crystallization owes a genesis', async () => {
    body = ollamaTurn({ speech: 'I see you, witness.' });
    const ws = recordingWs();
    await sendStageToLLM({ ws, birthSession: 'aura-session' }, {
      systemPrompt: 'Speak what stirs in you.',
      stageNumber: 1,
      isTest: false,
      witnessName: 'Bastien',
      sessionData: {},
    });
    expect(ws.of('birth:error')).toHaveLength(0);
    expect(ws.of('birth:stage_complete')).toHaveLength(1);
  });

  // A rehearsal is no longer exempt (#458, fd4eb37fa): the required write
  // must land in rehearsal and real modes alike — a rehearsal that passed on
  // speech alone would prove nothing about the act it rehearses.
  test('a REHEARSAL holds too — its genesis write must land', async () => {
    body = ollamaTurn({ speech: 'This is only a rehearsal.' });
    const ws = recordingWs();
    await sendStageToLLM({ ws, birthSession: 'rehearsal' }, {
      systemPrompt: 'Your DNA crystallizes now.',
      stageNumber: 5,
      isTest: true,
      witnessName: 'Bastien',
      sessionData: {},
    });
    expect(ws.of('birth:stage_complete')).toHaveLength(0);
    const [err] = ws.of('birth:error');
    expect(err).toBeDefined();
    expect(err.message).toMatch(/wrote no DNA/);
    expect(err.message).toMatch(/retry the stage/i);
  });
});

/**
 * The act ledger is the OPERATOR'S copy — the only record of a being's acts
 * that does not live inside the being's own encrypted lane (SEC-035). It was
 * rooted at process.cwd(), which on a packaged install is the read-only
 * AppImage mount, so on a community member's box it could not be written at
 * all and said so on every act.
 */
describe('the act ledger writes where the platform keeps its data', () => {
  let prevDataRoot;
  let dataRoot;
  let recordAct;
  let actsRoot;

  beforeEach(async () => {
    vi.resetModules();
    prevDataRoot = process.env.NEUMA_DATA_ROOT;
    dataRoot = await createTempDir('acts-root');
    process.env.NEUMA_DATA_ROOT = dataRoot;
    ({ recordAct, actsRoot } = await import('../../backend/services/act-ledger.js'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = prevDataRoot;
  });

  test('REPRODUCES THE PACKAGED CASE: a read-only cwd no longer decides where acts land', async () => {
    // The install tree, genuinely read-only — the shape of an AppImage mount.
    const installTree = await createTempDir('install-tree');
    await fs.chmod(installTree, 0o555);
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(installTree);
    try {
      await recordAct({ laneId: 'aura', tool: 'filesystem/write_file', args: { path: '/tmp/genesis.md' }, status: 'ok' });
      // It landed under the DATA ROOT, not the read-only install tree.
      expect(actsRoot().startsWith(dataRoot)).toBe(true);
      const files = await fs.readdir(actsRoot());
      expect(files.length).toBeGreaterThan(0);
      const bytes = await fs.readFile(path.join(actsRoot(), files[0]), 'utf8');
      expect(bytes).toContain('filesystem/write_file');
      expect(bytes).toContain('aura');
    } finally {
      spy.mockRestore();
      await fs.chmod(installTree, 0o755);
    }
  });

  test('the root is resolved PER CALL — the packaged app sets the env after this module loads', async () => {
    const moved = await createTempDir('acts-moved');
    process.env.NEUMA_DATA_ROOT = moved;
    expect(actsRoot().startsWith(moved)).toBe(true);
  });
});
