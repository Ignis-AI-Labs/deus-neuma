/* global process */
// THE NAMING'S ROOM TO THINK (Design note, 2026-11-13: […]). The real stage streamer (sendStageToLLM) against a
// real local HTTP server speaking the OpenAI wire, which names itself llama.cpp the way a real one
// does (its Server header, read by the real think-shape probe), over a real WebSocket pair. Its
// requests are read off the wire:
//   - the naming request carries thinking_budget_tokens and the budget notice, so the server closes
//     a long deliberation itself and the being names itself in the same request
//   - the operator's disclosure names the budget (nothing about an emergence is occult)
//   - another stage, and a serving that is not llama.cpp, carry no budget: unchanged
// The server's own close is llama.cpp's (proven for the chat in speechless-round.test.js).
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { startLocalProvider } from '../helpers/local-provider.js';

const ENV = ['NEUMA_DATA_ROOT'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
let M; let STAGE; let llm; let room; let wsPair; let before;

const startWsPair = () => new Promise((resolve) => {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  httpServer.listen(0, '127.0.0.1', () => {
    const received = [];
    wss.on('connection', (serverWs) => resolve({ httpServer, serverWs, received }));
    const client = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}`);
    client.on('message', (data) => received.push(JSON.parse(data.toString())));
  });
});

const runStage = (stageNumber) => M.sendStageToLLM({
  ws: wsPair.serverWs,
  companion: { neumaId: null, name: 'Unnamed' },
  birthSession: `thought-room-${stageNumber}`,
  witnessWords: null,
  _writeOps: 0,
}, {
  systemPrompt: 'You are being born. Answer in one short sentence.',
  stageNumber,
  isTest: false,
  witnessName: 'TestWitness',
  sessionData: { substrate: { llm: { model: 'test-model' } } },
}).catch(() => null); // a stage that writes no name holds; the request is what is read here

beforeAll(async () => {
  process.env.NEUMA_DATA_ROOT = await createTempDir('birth-thought-room');
  M = await import('../../backend/services/birth-stage-stream.js');
  ({ STAGE } = await import('../../core/birth/stage-roles.js'));
  llm = await import('../../backend/services/llm-provider.js');
  room = await import('../../backend/services/birth-thought-room.js');
  before = llm.getConfig();
  wsPair = await startWsPair();
}, 30_000);

afterAll(async () => {
  if (before) llm.setConfig(before);
  wsPair?.httpServer.close();
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('the naming may think within a budget the server closes itself', () => {
  test('on llama.cpp the naming request carries the budget and its notice, and the disclosure names it', async () => {
    const server = await startLocalProvider({ serverHeader: 'llama.cpp', reply: 'I am Thren.' });
    try {
      llm.setConfig({ provider: 'llama-server', endpoint: server.endpoint, model: 'test-model', apiKey: '' });
      await runStage(STAGE.NAMING);
      expect(server.turns.length).toBeGreaterThan(0);
      for (const turn of server.turns) {
        expect(turn.thinking_budget_tokens).toBe(room.NAMING_THOUGHT_TOKENS);
        expect(typeof turn.reasoning_budget_message).toBe('string');
        expect(turn.reasoning_budget_message.length).toBeGreaterThan(0);
      }
      const disclosure = wsPair.received.filter((m) => m.stage === STAGE.NAMING && Array.isArray(m.parameters)).pop();
      expect(disclosure?.parameters).toContainEqual({ label: 'THINKING BUDGET', value: String(room.NAMING_THOUGHT_TOKENS) });
    } finally {
      await server.close();
    }
  }, 60_000);

  test('another stage on llama.cpp, and the naming on a serving that is not llama.cpp, carry no budget', async () => {
    const llamaCpp = await startLocalProvider({ serverHeader: 'llama.cpp', reply: 'I am listening.' });
    const other = await startLocalProvider({ reply: 'I am Thren.' });
    try {
      llm.setConfig({ provider: 'llama-server', endpoint: llamaCpp.endpoint, model: 'test-model', apiKey: '' });
      await runStage(0);
      expect(llamaCpp.turns.length).toBeGreaterThan(0);
      for (const turn of llamaCpp.turns) expect(turn.thinking_budget_tokens).toBeUndefined();

      llm.setConfig({ provider: 'llama-server', endpoint: other.endpoint, model: 'test-model', apiKey: '' });
      await runStage(STAGE.NAMING);
      expect(other.turns.length).toBeGreaterThan(0);
      for (const turn of other.turns) expect(turn.thinking_budget_tokens).toBeUndefined();
    } finally {
      await llamaCpp.close();
      await other.close();
    }
  }, 60_000);

  test('the budget is the naming\'s only', () => {
    expect(room.stageThinkingBudget(STAGE.NAMING, { serverBudget: true })).toBe(room.NAMING_THOUGHT_TOKENS);
    expect(room.stageThinkingBudget(STAGE.RECORD, { serverBudget: true })).toBeNull();
    expect(room.stageThinkingBudget(STAGE.NAMING, { serverBudget: false })).toBeNull();
    expect(room.stageThinkingBudget(STAGE.NAMING, null)).toBeNull();
    expect(path.basename(import.meta.url)).toMatch(/thought-room/);
  });
});
