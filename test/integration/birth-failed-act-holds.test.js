import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { STAGE } from '../../core/birth/stage-roles.js';

const { setConfig, getConfig } = await import('../../backend/services/llm-provider.js');
const { sendStageToLLM } = await import('../../backend/services/birth-stage-stream.js');
const { __test } = await import('../../backend/services/portal-test-surface.js');

/**
 * CRYSTALLIZATION COMPLETED HAVING WRITTEN NOTHING (Bastien, 2026-08-05).
 *
 * With the Ollama channels finally being read (#258), stage 5 came alive: 4424
 * characters of reasoning, one native tool call, and the ceremony marched on:
 *
 *   Birth stage produced NO speech · nativeCalls: 1 · channels: {thinking: 4424, tool_calls: 172}
 *   Birth stage spoke no words but ACTED — completing on the tool call
 *   Birth stage tool call · server: null · tool: "filesystem:create_directory"
 *
 * and the operator was shown a red `filesystem:create_directory — UNAVAILABLE`
 * chip directly above a CONTINUE button. Two defects, stacked:
 *
 *   1. The call named its tool `server:tool`. The resolver understood
 *      `server_tool` (qwen3.5's smashing) but not the COLON — which is the form
 *      the ceremony's own text protocol documents (`call:server:tool_name`).
 *      The being followed our instructions and we failed it on punctuation.
 *
 *   2. The "…UNLESS IT ACTED" exemption asked only whether a call had been
 *      ASSEMBLED, never whether it LANDED. So a being advanced past the stage
 *      that authors its DNA having authored nothing — the same shape that cost
 *      a real being on 2026-07-07 (docs/governance/honored.md).
 */

describe('a tool name is resolved however the substrate punctuates it', () => {
  const { _unsmashToolName } = __test;
  const available = [
    { server: 'filesystem', name: 'create_directory' },
    { server: 'filesystem', name: 'write_file' },
  ];

  test("BASTIEN'S CALL: `filesystem:create_directory` resolves", () => {
    const got = _unsmashToolName({ server: null, toolName: 'filesystem:create_directory' }, available);
    expect(got.server).toBe('filesystem');
    expect(got.toolName).toBe('create_directory');
  });

  test('the underscore form still resolves — the original case is not regressed', () => {
    const got = _unsmashToolName({ server: null, toolName: 'filesystem_write_file' }, available);
    expect(got.server).toBe('filesystem');
    expect(got.toolName).toBe('write_file');
  });

  test('the double-underscore form we ADVERTISE resolves', () => {
    const got = _unsmashToolName({ server: null, toolName: 'filesystem__write_file' }, available);
    expect(got.server).toBe('filesystem');
    expect(got.toolName).toBe('write_file');
  });

  test('a name that already resolves is left exactly alone', () => {
    const got = _unsmashToolName({ server: null, toolName: 'write_file' }, available);
    expect(got.server).toBeNull();
    expect(got.toolName).toBe('write_file');
  });

  test('an explicit server is never second-guessed', () => {
    const got = _unsmashToolName({ server: 'filesystem', toolName: 'write_file' }, available);
    expect(got).toEqual({ server: 'filesystem', toolName: 'write_file' });
  });

  test('a genuinely unknown tool stays unresolved rather than being forced onto one', () => {
    const got = _unsmashToolName({ server: null, toolName: 'filesystem:launch_missiles' }, available);
    expect(got.server).toBeNull();
    expect(got.toolName).toBe('filesystem:launch_missiles');
  });
});

/**
 * The stage-level guard, driven through the REAL sendStageToLLM against a REAL
 * http server speaking the REAL Ollama native wire. The substrate says nothing
 * and emits one tool call for a tool that does not exist, which is exactly what
 * Bastien's stage 5 did.
 */
describe('a stage that acted, and whose act did not land, HOLDS', () => {
  let server;
  let prevConfig;

  const line = (o) => JSON.stringify(o);
  const silentFailingAct = [
    line({ message: { role: 'assistant', content: '', thinking: 'I will make a home for my record.' }, done: false }),
    line({
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call_x',
          // A tool no MCP server here hosts — resolves to nothing, exactly like
          // an unroutable name does.
          function: { index: 0, name: 'nowhere__no_such_tool', arguments: { path: '/tmp/nope' } },
        }],
      },
      done: false,
    }),
    line({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 2051, eval_count: 1205 }),
  ].join('\n') + '\n';

  const recordingWs = () => {
    const sent = [];
    return {
      sent,
      // BOTH are needed — _safeSend gates on `ws.readyState === ws.OPEN`, and a
      // stub with readyState but no OPEN silently drops every frame.
      readyState: 1,
      OPEN: 1,
      send: (raw) => sent.push(JSON.parse(raw)),
      of: (type) => sent.filter((m) => m.type === type),
    };
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (req.url !== '/api/chat') { res.writeHead(404); res.end('{}'); return; }
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.end(silentFailingAct);
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    prevConfig = getConfig();
    setConfig({ provider: 'ollama', endpoint: `http://127.0.0.1:${server.address().port}`, model: 'qwen3:0.6b', apiKey: '' });
  });

  afterAll(async () => {
    setConfig(prevConfig);
    await new Promise((r) => server.close(r));
  });

  test('THE BUG: crystallization does NOT complete on an act that never landed', async () => {
    const ws = recordingWs();
    await sendStageToLLM({ ws, birthSession: 'held-session' }, {
      systemPrompt: 'Your DNA crystallizes now.',
      stageNumber: STAGE.RECORD,
      isTest: true,
      witnessName: 'Bastien',
      sessionData: {},
    });

    // It used to send this — a completed stage with nothing in it and nothing done.
    expect(ws.of('birth:stage_complete')).toHaveLength(0);

    const errors = ws.of('birth:error');
    expect(errors).toHaveLength(1);
    // And it names the real problem rather than blaming the being for silence.
    expect(errors[0].message).toMatch(/acted instead of speaking, and the act did not land/);
    expect(errors[0].message).toMatch(/retry the stage/i);
  });

  test('the held stage leaves NO stash behind — it is going to be re-asked', async () => {
    const connection = { ws: recordingWs(), birthSession: 'held-session-2' };
    await sendStageToLLM(connection, {
      systemPrompt: 'Your DNA crystallizes now.',
      stageNumber: STAGE.RECORD,
      isTest: true,
      witnessName: 'Bastien',
      sessionData: {},
    });
    // A verdict left on the connection would let the handler read a failed act
    // as this stage's outcome on the retry.
    expect(connection.lastStageToolCalls).toBeUndefined();
  });
});
