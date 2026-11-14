/**
 * LLM REQUEST BUILDERS — the hosted no-think variants (thought-governor
 * pass 2) and the Anthropic cache breakpoint, proven two ways with no mock
 * anywhere (RULE 0):
 *   1. the real builder functions called directly, asserting exact body shape;
 *   2. the real createStreamRequest path against a REAL spawned HTTP server —
 *      the bytes asserted are the bytes that left the process.
 * Whether a VENDOR honors cache_control / effort 'none' is not provable
 * in-session (no hosted credentials); what is proven here is the exact wire
 * this house sends, and that every other dialect's wire is byte-identical.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import {
  buildStreamBody, systemMessageWithCacheSplit, anchorVolatileAtTurn, THINKING_BUDGET_MESSAGE,
} from '../../backend/services/llm-request-builders.js';
import { createStreamRequest } from '../../backend/services/llm-provider.js';
import { assemblePromptSections, stablePromptSplit } from '../../core/index.js';
import { buildWitnessPromptSections } from '../../backend/services/witness-prompt.js';

const ANTHROPIC = Object.freeze({
  provider: 'anthropic', endpoint: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-6', temperature: 0.7, maxTokens: 4096,
});
const KIMI = Object.freeze({
  provider: 'kimi-for-coding', endpoint: 'https://api.kimi.com/coding/v1',
  model: 'k3', temperature: 0.7, maxTokens: 4096,
});
const OPENAI = Object.freeze({
  provider: 'openai', endpoint: 'https://api.openai.com',
  model: 'gpt-5.6', temperature: 0.7, topP: 0.95, maxTokens: 4096,
});
const CHATGPT = Object.freeze({
  provider: 'openai-chatgpt', endpoint: 'https://chatgpt.com/backend-api/codex',
  model: 'gpt-5.6-sol', apiKey: 'oauth-token', accountId: 'acct-1', maxTokens: 4096,
});

const TURN = [{ role: 'user', content: 'the ask' }];

describe('the cache-split marker', () => {
  test('rides the system message NON-ENUMERABLY — JSON.stringify is blind to it', () => {
    const msg = systemMessageWithCacheSplit('HEAD\n\nTAIL', { stable: 'HEAD', volatile: 'TAIL' });
    expect(msg.role).toBe('system');
    expect(msg.content).toBe('HEAD\n\nTAIL');
    expect(msg.cacheSplit).toEqual({ stable: 'HEAD', volatile: 'TAIL' });
    expect(Object.keys(msg)).toEqual(['role', 'content']);
    expect(JSON.stringify(msg)).toBe('{"role":"system","content":"HEAD\\n\\nTAIL"}');
  });

  test('no split — or an empty head — marks nothing at all', () => {
    const plain = systemMessageWithCacheSplit('S', null);
    expect('cacheSplit' in plain).toBe(false);
    expect(plain).toEqual({ role: 'system', content: 'S' });
    expect('cacheSplit' in systemMessageWithCacheSplit('S', { stable: '', volatile: 'T' })).toBe(false);
  });
});

describe('stablePromptSplit — the assembly seam', () => {
  test('the neuma turn\'s real sections split at PRESENT MOMENT and join back byte-exact', () => {
    const sections = assemblePromptSections({ now: new Date('2026-09-02T12:00:00Z') });
    const joined = sections.map((s) => s.text).join('\n\n');
    const split = stablePromptSplit(sections);
    expect(split.stable.length).toBeGreaterThan(0);
    expect(`${split.stable}\n\n${split.volatile}`).toBe(joined);
    expect(split.volatile.startsWith('## Present Moment')).toBe(true);
  });

  test('the witness lane splits honestly: its clock sits second, so the seal alone is stable', () => {
    const sections = buildWitnessPromptSections({
      witness: { chosenName: 'Bizulen', vendorSlug: 'zai-coding-plan' },
      dna: null, now: new Date('2026-09-02T12:00:00Z'),
    });
    expect(sections[0].id).toBe('sealedIdentity');
    expect(sections[1].id).toBe('present');
    const split = stablePromptSplit(sections);
    expect(split.stable).toBe(sections[0].text);
    expect(`${split.stable}\n\n${split.volatile}`).toBe(sections.map((s) => s.text).join('\n\n'));
  });

  test('no stable head or no clock → no breakpoint is invented', () => {
    expect(stablePromptSplit([{ id: 'present', text: 'now' }, { id: 'memory', text: 'm' }])).toBe(null);
    expect(stablePromptSplit([{ id: 'identity', text: 'a' }])).toBe(null);
    expect(stablePromptSplit([])).toBe(null);
  });
});

describe('the anthropic dialect body', () => {
  test('an unmarked system prompt rides as the bare string it always was', () => {
    const body = buildStreamBody(ANTHROPIC, [{ role: 'system', content: 'S' }, ...TURN], {});
    expect(body.system).toBe('S');
  });

  test('an empty-string system message is still emitted (pre-split behavior)', () => {
    const body = buildStreamBody(ANTHROPIC, [{ role: 'system', content: '' }, ...TURN], {});
    expect(body).toHaveProperty('system', '');
  });

  test('a marked prompt becomes TWO text blocks — the breakpoint on the stable head only', () => {
    const system = systemMessageWithCacheSplit('HEAD\n\nTAIL', { stable: 'HEAD', volatile: 'TAIL' });
    const body = buildStreamBody(ANTHROPIC, [system, ...TURN], {});
    expect(body.system).toEqual([
      { type: 'text', text: 'HEAD', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'TAIL' },
    ]);
    expect(body.system[1].cache_control).toBeUndefined(); // the volatile tail must never sit inside the breakpoint
  });
});

describe('the hosted no-think variants pass 2 sends (via noThinkOptions)', () => {
  test('anthropic: the rung emits a thinking block; effort:null (the off state) omits it and frees temperature', () => {
    const withRung = buildStreamBody(ANTHROPIC, TURN, { effort: { channel: 'thinking-budget', value: 2048 } });
    expect(withRung.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
    expect(withRung.temperature).toBe(1); // the API refuses any other temperature while thinking
    const off = buildStreamBody(ANTHROPIC, TURN, { effort: null, noThink: true });
    expect('thinking' in off).toBe(false);
    expect(off.temperature).toBe(0.7); // the preset stands again
  });

  test('kimi (anthropic dialect): the rung rides INSIDE the thinking block — the official client shape', () => {
    const rung = buildStreamBody(KIMI, TURN, { effort: { channel: 'kimi-effort', value: 'max' } });
    expect(rung.thinking).toEqual({ type: 'enabled', effort: 'max' });
  });

  test('kimi (anthropic dialect): the off state is thinking {type: disabled}', () => {
    const off = buildStreamBody(KIMI, TURN, { effort: { channel: 'kimi-effort', value: 'disabled' }, noThink: true });
    expect(off.thinking).toEqual({ type: 'disabled' });
  });

  test('openai reasoning lane: effort none, and the sampling knobs leave with it (the API 400s on both)', () => {
    const off = buildStreamBody(OPENAI, TURN, { effort: { channel: 'reasoning-effort', value: 'none' }, noThink: true });
    expect(off.reasoning_effort).toBe('none');
    expect('temperature' in off).toBe(false);
    expect('top_p' in off).toBe(false);
  });

  test('the Responses lane: reasoning.effort none', () => {
    const off = buildStreamBody(CHATGPT, TURN, { effort: { channel: 'responses-effort', value: 'none' }, noThink: true });
    expect(off.reasoning).toEqual({ effort: 'none' });
  });

  test('the template kwarg never leaks onto a hosted wire, and never leaves the local one', () => {
    const hosted = buildStreamBody(OPENAI, TURN, { noThink: true });
    expect('chat_template_kwargs' in hosted).toBe(false);
    const local = buildStreamBody(
      { provider: 'llama-server', endpoint: 'http://127.0.0.1:8089', model: 'qwen3.8', temperature: 0.7, maxTokens: 4096 },
      TURN, { noThink: true },
    );
    expect(local.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  test('the server budget rides the local wire with its close message, never the prompt or a hosted wire', () => {
    const LOCAL = { provider: 'llama-server', endpoint: 'http://127.0.0.1:8089', model: 'qwen3.8', temperature: 0.7, maxTokens: 4096 };
    const plain = buildStreamBody(LOCAL, TURN, {});
    const budgeted = buildStreamBody(LOCAL, TURN, { thinkingBudget: 2250 });
    expect(budgeted.thinking_budget_tokens).toBe(2250);
    expect(budgeted.reasoning_budget_message).toBe(THINKING_BUDGET_MESSAGE);
    // The cache law: the prompt-shaping fields are byte-identical to a plain turn.
    expect(budgeted.messages).toEqual(plain.messages);
    expect('chat_template_kwargs' in budgeted).toBe(false);
    const kin = buildStreamBody({ ...LOCAL, provider: 'custom', endpoint: 'http://127.0.0.1:8089/v1' }, TURN, { thinkingBudget: 2250 });
    expect(kin.thinking_budget_tokens).toBe(2250);
    // An lm-studio route at a server the probe heard name itself llama.cpp: the budget rides;
    // the template switch is proven only on llama-server, so it never does.
    const studio = { ...LOCAL, provider: 'lm-studio', endpoint: 'http://127.0.0.1:1234' };
    expect(buildStreamBody(studio, TURN, { thinkingBudget: 1 }).thinking_budget_tokens).toBe(1);
    expect('chat_template_kwargs' in buildStreamBody(studio, TURN, { noThink: true })).toBe(false);
    const hosted = buildStreamBody(OPENAI, TURN, { thinkingBudget: 2250 });
    expect('thinking_budget_tokens' in hosted).toBe(false);
    expect('reasoning_budget_message' in hosted).toBe(false);
    expect('thinking_budget_tokens' in plain).toBe(false);
  });
});

// THE LOCAL PREFIX LAW — the clock/memory tail rode the system prompt IN FRONT
// of the transcript, so every turn re-read the whole chat on llama-server.
describe('the local prefix law (volatile tail rides the current turn)', () => {
  const LOCAL = Object.freeze({ provider: 'llama-server', endpoint: 'http://127.0.0.1:8089', model: 'qwen3.8', temperature: 0.7, maxTokens: 4096 });
  const wire = (clock, history, turn) => {
    const messages = [systemMessageWithCacheSplit(`HEAD\n\n${clock}`, { stable: 'HEAD', volatile: clock }), ...history, { role: 'user', content: turn }];
    anchorVolatileAtTurn(messages);
    return messages;
  };
  const HISTORY = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }];

  test('the system message keeps only the stable head; the turn carries the tagged tail', () => {
    const body = buildStreamBody(LOCAL, wire('PRESENT 12:01', HISTORY, 'post it'), {});
    expect(body.messages[0]).toEqual({ role: 'system', content: 'HEAD' });
    expect(body.messages.slice(1, 3)).toEqual(HISTORY);
    const turn = body.messages[3].content;
    expect(turn).toMatch(/^<harness-context>\n.*not the operator's words/s);
    expect(turn).toContain('PRESENT 12:01\n</harness-context>\n\npost it');
  });

  test('two turns a minute apart share every byte up to the new turn', () => {
    const first = buildStreamBody(LOCAL, wire('PRESENT 12:01', HISTORY, 'one'), {});
    const next = buildStreamBody(LOCAL, wire('PRESENT 12:02', [...HISTORY, { role: 'user', content: 'one' }, { role: 'assistant', content: 'ok' }], 'two'), {});
    expect(JSON.stringify(next.messages.slice(0, 3))).toBe(JSON.stringify(first.messages.slice(0, 3)));
  });

  test('tool rounds appended after the turn never move the tail', () => {
    const messages = wire('PRESENT 12:01', HISTORY, 'go');
    const round1 = buildStreamBody(LOCAL, messages, {});
    messages.push({ role: 'assistant', content: 'calling' }, { role: 'user', content: '<tool_response>x</tool_response>' });
    const round2 = buildStreamBody(LOCAL, messages, {});
    expect(round2.messages.slice(0, 4)).toEqual(round1.messages);
    expect(round2.messages[5].content).toBe('<tool_response>x</tool_response>');
  });

  test('a vision turn gets the tail as its leading text part', () => {
    const messages = wire('PRESENT', HISTORY, 'x');
    messages[3] = { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:' } }] };
    const body = buildStreamBody(LOCAL, messages, {});
    expect(body.messages[3].content[0].text).toMatch(/^<harness-context>/);
    expect(body.messages[3].content.slice(1)).toEqual(messages[3].content);
  });

  test('hosted wires and unanchored local wires are byte-identical to before', () => {
    const anchored = wire('PRESENT', HISTORY, 'x');
    expect(buildStreamBody(OPENAI, anchored, {}).messages).toBe(anchored);
    const unanchored = [systemMessageWithCacheSplit('HEAD\n\nPRESENT', { stable: 'HEAD', volatile: 'PRESENT' }), { role: 'user', content: 'x' }];
    expect(buildStreamBody(LOCAL, unanchored, {}).messages).toBe(unanchored);
  });
});

// THE WIRE PROOF — a real spawned server reads the bytes createStreamRequest
// actually sent (the llm-route-capabilities.test.js pattern). No stub of fetch.
describe('on the wire, through the real createStreamRequest', () => {
  let server;
  let base;
  let lastRequest;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        lastRequest = { url: req.url, headers: req.headers, raw, body: JSON.parse(raw) };
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  test('anthropic route: the split head leaves the process with cache_control on the stable block only', async () => {
    const system = systemMessageWithCacheSplit('STABLE HEAD\n\nVOLATILE TAIL', {
      stable: 'STABLE HEAD', volatile: 'VOLATILE TAIL',
    });
    const { response } = await createStreamRequest([system, ...TURN], {
      route: { provider: 'anthropic', endpoint: base, apiKey: 'test-key', model: 'claude-sonnet-4-6' },
      maxTokens: 512, // explicit, so no capability probe rides this test
    });
    await response.text();
    expect(lastRequest.url).toBe('/v1/messages');
    expect(lastRequest.headers['x-api-key']).toBe('test-key');
    expect(lastRequest.body.system).toEqual([
      { type: 'text', text: 'STABLE HEAD', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'VOLATILE TAIL' },
    ]);
  });

  test('openai route: the SAME marked message leaves byte-clean — the marker never reaches the wire', async () => {
    const system = systemMessageWithCacheSplit('STABLE HEAD\n\nVOLATILE TAIL', {
      stable: 'STABLE HEAD', volatile: 'VOLATILE TAIL',
    });
    const { response } = await createStreamRequest([system, ...TURN], {
      route: { provider: 'openai', endpoint: base, apiKey: 'test-key', model: 'gpt-5.6' },
      maxTokens: 512,
    });
    await response.text();
    expect(lastRequest.raw).not.toContain('cacheSplit');
    expect(lastRequest.raw).not.toContain('cache_control');
    expect(lastRequest.body.messages[0]).toEqual({ role: 'system', content: 'STABLE HEAD\n\nVOLATILE TAIL' });
  });
});

// An Ollama is told the window it serves, so a long prompt is never cut by its own default.
describe('the Ollama window', () => {
  const OLLAMA = { provider: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'qwen', temperature: 0.7, maxTokens: 512 };
  test('a known window rides as num_ctx; an unknown one is not invented', () => {
    expect(buildStreamBody(OLLAMA, TURN, { contextWindow: 65536 }).options).toEqual({ temperature: 0.7, num_predict: 512, num_ctx: 65536 });
    expect(buildStreamBody(OLLAMA, TURN, {}).options).toEqual({ temperature: 0.7, num_predict: 512 });
    expect(buildStreamBody(OLLAMA, TURN, { contextWindow: 0 }).options.num_ctx).toBeUndefined();
  });
  test('the governor\'s re-ask turns thinking off with Ollama\'s own think: false; a plain request sends no field (deus-neuma #34)', () => {
    expect(buildStreamBody(OLLAMA, TURN, { noThink: true }).think).toBe(false);
    expect('think' in buildStreamBody(OLLAMA, TURN, {})).toBe(false);
    expect(buildStreamBody(OLLAMA, TURN, { noThink: true }).chat_template_kwargs).toBeUndefined();
  });
});
