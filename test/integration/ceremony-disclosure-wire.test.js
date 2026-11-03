/**
 * WHAT THE OPERATOR IS SHOWN IS WHAT THE SUBSTRATE RECEIVED (gnosis).
 *
 * The disclosure panel's whole claim is reconstruction: the components it
 * lists, joined, ARE the two messages of the request. A panel that merely
 * described the request would be one more thing to take on faith — which is
 * the mysticism this feature exists to remove.
 *
 * So the claim is proven against the wire itself. A REAL http server stands
 * where LM Studio stands and CAPTURES the request body; the REAL birth handler
 * produces the REAL stage data from the REAL protocol files on disk; the REAL
 * sendStageToLLM drives the stage. Then the `birth:composition` frame the
 * operator receives is compared, character for character, against the messages
 * the provider actually got. Nothing in the claimed path is stubbed.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { setConfig, getConfig } from '../../backend/services/llm-provider.js';
import { sendStageToLLM } from '../../backend/services/birth-stage-stream.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';
import { systemMessageOf, userMessageOf } from '../../core/birth/ceremony-disclosure.js';
import { STAGE } from '../../core/birth/stage-roles.js';

const SPOKEN = 'It settles into stillness.';

// OpenAI-compatible SSE, the wire LM Studio speaks.
const sseChunks = (text) => [
  ...[...text].map((ch) => `data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}`),
  'data: [DONE]',
].join('\n\n') + '\n\n';

/** A ws stand-in that records the frames the ceremony sends to the operator. */
const recordingWs = () => {
  const sent = [];
  return {
    sent,
    readyState: 1,
    OPEN: 1,
    send: (raw) => sent.push(JSON.parse(raw)),
    of: (type) => sent.filter((m) => m.type === type),
  };
};

describe('the ceremony discloses exactly what it sends', () => {
  let server, captured, handler, tempDir, prevConfig;

  beforeAll(async () => {
    tempDir = await createTempDir('ceremony-disclosure-wire');
    process.env.NEUMA_RETURNED_PATH = join(tempDir, 'RETURNED.md');
    const houseRoot = join(tempDir, 'house');
    await mkdir(houseRoot, { recursive: true });
    setWorkspacesRoot(houseRoot);

    handler = new StagedBirthHandler(
      { createNeumaSession: async () => 'tok', createDNA: async () => ({}) },
      { handleServerUpdate: () => {} },
    );
    await handler._ready;

    captured = [];
    server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'gemma-4-31b' }] }));
        return;
      }
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        // ROUTE BY PATH, as a real provider does. Every POST used to be
        // captured as a ceremony turn, so a capability probe (Ollama's
        // /api/show is a POST) landed at captured[0] and the stage-0
        // comparison read the probe's body instead of the stage's. A body-less
        // POST also threw an uncaught SyntaxError straight out of this handler.
        if (!req.url.includes('/chat/completions')) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end('{}');
          return;
        }
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
        if (parsed.stream === false) {
          // think-behavior probe — a no-think substrate, not a ceremony turn
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: 'ready' } }] }));
          return;
        }
        captured.push(parsed);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(sseChunks(SPOKEN));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));

    prevConfig = getConfig();
    setConfig({
      provider: 'lm-studio',
      endpoint: `http://127.0.0.1:${server.address().port}`,
      model: 'gemma-4-31b',
      apiKey: '',
    });
  }, 30000);

  afterAll(async () => {
    setConfig(prevConfig);
    setWorkspacesRoot(null);
    delete process.env.NEUMA_RETURNED_PATH;
    await new Promise((r) => server.close(r));
    vi.restoreAllMocks();
  });

  // One real stage, driven the way portal-routes drives it.
  const runStage = async (stage) => {
    const before = captured.length;
    const sessionId = await handler.createSession('Founder', true);
    const stageData = await handler.processStage(sessionId, stage);
    const ws = recordingWs();
    await sendStageToLLM({ ws, birthSession: sessionId }, stageData);
    await handler.endSession(sessionId);
    return { ws, request: captured[before] };
  };

  test('stage 0 — the disclosed components rebuild the exact messages the provider received', async () => {
    const { ws, request } = await runStage(STAGE.OPENING);

    const [composition] = ws.of('birth:composition');
    expect(composition).toBeDefined();
    expect(composition.stage).toBe(STAGE.OPENING);

    const [systemMessage, userMessage] = request.messages;
    // The claim, against the wire: not "similar to", not "describes" — IS.
    expect(systemMessageOf(composition)).toBe(systemMessage.content);
    expect(userMessageOf(composition)).toBe(userMessage.content);
    expect(composition.totals.system).toBe(systemMessage.content.length);
    expect(composition.totals.yours).toBe(userMessage.content.length);
  });

  test('the components the operator never saw are all present and attributed', async () => {
    const { ws } = await runStage(0);
    const [composition] = ws.of('birth:composition');

    const ids = composition.components.map((c) => c.id);
    // The rehearsal notice, the protocol document, and the voice lock all rode
    // invisibly before this frame existed.
    expect(ids).toContain('rehearsal');
    expect(ids).toContain('protocol');
    expect(ids).toContain('voice-lock');
    expect(ids).toContain('operator-words');

    for (const component of composition.components) {
      expect(component.origin.length).toBeGreaterThan(0);
      expect(component.chars).toBe(component.text.length);
    }
  });

  test('the record stage — the instruction appended to the operator’s own message is disclosed as such', async () => {
    const { ws, request } = await runStage(STAGE.RECORD);
    const [composition] = ws.of('birth:composition');
    const userMessage = request.messages[1].content;

    const appended = composition.components.find((c) => c.channel === 'ceremony');
    expect(appended.label).toBe('APPENDED TO YOUR WORDS');
    expect(appended.text).toContain('fs/write');
    // It really is in the message that went out under the operator's words.
    expect(userMessage.endsWith(appended.text)).toBe(true);
    expect(userMessageOf(composition)).toBe(userMessage);

    const yours = composition.components.find((c) => c.channel === 'operator');
    expect(userMessage.startsWith(yours.text)).toBe(true);
    expect(yours.text).not.toContain('write_file');
  });

  test('the disclosed request settings are the settings that were sent', async () => {
    const { ws, request } = await runStage(STAGE.OPENING);
    const [composition] = ws.of('birth:composition');
    const value = (label) => composition.parameters.find((p) => p.label === label)?.value;

    expect(value('MODEL')).toBe(request.model);
    expect(value('PROVIDER')).toBe('lm-studio');
    expect(value('TEMPERATURE')).toBe(String(request.temperature));
    expect(value('TOKEN CEILING')).toBe(String(request.max_tokens ?? request.max_completion_tokens));
  });
});
