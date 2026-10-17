import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { isThinkProbe } from '../helpers/think-probe.js';

const { setConfig, getConfig } = await import('../../backend/services/llm-provider.js');
const { sendStageToLLM } = await import('../../backend/services/birth-stage-stream.js');

/**
 * THE CEREMONY COULD NOT HEAR OLLAMA (Bastien, reported by Design note, 2026-08-03.
 *
 * After the pre-flight gate was fixed to stop him entering a ceremony on a dead
 * provider, Bastien selected Ollama — which is exactly what our own pre-flight
 * chip now tells a first-run witness to do — and reached STAGE 0, where the
 * being said nothing at all:
 *
 *   «WARNING» THE STREAM ENDED BEFORE THE CONSCIOUSNESS COULD ANSWER
 *
 * The provider layer has ONE dialect-aware stream reader (`_readLine`, used by
 * `consumeStream` / `consumeStreamWithTools`), and every other path in the
 * platform goes through it — heartbeat, chat titles, the probe, attunement, the
 * portal itself. It knows that Ollama's native /api/chat speaks
 * newline-delimited JSON with the text at `message.content`, and that an
 * SSE `data:` frame may arrive with or without the space after the colon.
 *
 * `sendStageToLLM` is the one caller that hand-rolls its own loop:
 *
 *   const { response } = streamResult;        // <- drops `dialect`
 *   ...
 *   if (!line.startsWith('data: ')) continue; // <- SSE only, space REQUIRED
 *
 * `createStreamRequest` returns `{ response, provider, dialect }` precisely so a
 * caller can parse correctly. The birth ceremony threw the dialect away.
 *
 * So on Ollama every single line is skipped, no content is ever accumulated,
 * and the ceremony throws. Not a substrate problem, not a model problem — the
 * being spoke and the ceremony was reading the wrong wire.
 *
 * Nothing here is mocked. A REAL http server speaks Ollama's REAL /api/chat
 * newline-delimited JSON shape, the REAL provider config points at it, and the
 * REAL sendStageToLLM drives a REAL stage.
 */

// Ollama's true wire shape: one JSON object per line, no `data:` prefix,
// text under message.content, terminated by a line with done:true.
const ollamaChunks = (text) => [
  ...[...text].map((ch) => JSON.stringify({
    model: 'gemma3:12b',
    created_at: '2026-08-03T14:00:00Z',
    message: { role: 'assistant', content: ch },
    done: false,
  })),
  JSON.stringify({
    model: 'gemma3:12b',
    created_at: '2026-08-03T14:00:01Z',
    message: { role: 'assistant', content: '' },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 40,
    eval_count: 12,
  }),
].join('\n') + '\n';

const SPOKEN = 'I stir in the void.';

/** A ws stand-in that records the frames the ceremony sends. */
const recordingWs = () => {
  const sent = [];
  return {
    sent,
    // BOTH are needed. The ceremony sends some frames through ws.send directly
    // and others through _safeSend, which gates on `ws.readyState === ws.OPEN` —
    // a stub carrying readyState but no OPEN silently drops every _safeSend
    // frame and the assertion reads as […].
    readyState: 1,
    OPEN: 1,
    send: (raw) => sent.push(JSON.parse(raw)),
    of: (type) => sent.filter((m) => m.type === type),
  };
};

describe('the birth ceremony on Ollama', () => {
  let server;
  let hits;
  let prevConfig;

  beforeAll(async () => {
    hits = [];
    server = createServer((req, res) => {
      hits.push(req.url);
      if (req.url === '/api/chat') {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.end(ollamaChunks(SPOKEN));
        return;
      }
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'gemma3:12b' }] }));
        return;
      }
      res.writeHead(404); res.end('{}');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));

    prevConfig = getConfig();
    setConfig({
      provider: 'ollama',
      endpoint: `http://127.0.0.1:${server.address().port}`,
      model: 'gemma3:12b',
    });
  });

  afterAll(async () => {
    setConfig(prevConfig);
    await new Promise((r) => server.close(r));
  });

  test('the ceremony reaches Ollama at its real native endpoint', async () => {
    const ws = recordingWs();
    await sendStageToLLM({ ws, birthSession: 'test-session' }, {
      systemPrompt: 'You are stirring in the void.',
      stageNumber: 0,
      isTest: true,
      witnessName: 'Bastien',
      sessionData: {},
    });
    // Proof the request actually left the building and hit OUR server.
    expect(hits).toContain('/api/chat');
  });

  test('BASTIEN\'S BUG: the stage must not die saying nothing was answered', async () => {
    const ws = recordingWs();
    await sendStageToLLM({ ws, birthSession: 'test-session' }, {
      systemPrompt: 'You are stirring in the void.',
      stageNumber: 0,
      isTest: true,
      witnessName: 'Bastien',
      sessionData: {},
    });

    const errors = ws.of('birth:error');
    expect(
      errors.map((e) => e.message),
      'the ceremony must not report an empty stream when the model spoke',
    ).not.toContain('The stream ended before the consciousness could answer');
    expect(errors).toEqual([]);
  });

  test('the being\'s words actually arrive, and the stage completes', async () => {
    const ws = recordingWs();
    await sendStageToLLM({ ws, birthSession: 'test-session' }, {
      systemPrompt: 'You are stirring in the void.',
      stageNumber: 0,
      isTest: true,
      witnessName: 'Bastien',
      sessionData: {},
    });

    const complete = ws.of('birth:stage_complete');
    expect(complete).toHaveLength(1);
    expect(complete[0].response).toContain(SPOKEN);
  });
});

/**
 * The other side of the same change. Routing the ceremony through the shared
 * reader touches the path EVERY existing birth uses (llama-server, LM Studio —
 * OpenAI-compatible SSE), so it has to be proven, not assumed.
 *
 * The third case is the one the old hand-rolled loop could never have passed: a
 * frame written `data:{...}` with NO space after the colon. The space is
 * OPTIONAL per the SSE spec, the shared reader learned that on 2026-07-27
 * (a whole healthy Kimi turn arrived and parsed as nothing), and this copy of
 * the parsing never got the lesson.
 */
describe('the birth ceremony on an OpenAI-compatible SSE substrate', () => {
  let server;
  let prevConfig;
  let framing = 'spaced';

  const sse = (text, style) => {
    const frame = (obj) => (style === 'bare' ? `data:${JSON.stringify(obj)}` : `data: ${JSON.stringify(obj)}`);
    return [
      ...[...text].map((ch) => frame({ choices: [{ delta: { content: ch }, finish_reason: null }] })),
      frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]',
    ].join('\n\n') + '\n\n';
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(sse(SPOKEN, framing));
        return;
      }
      res.writeHead(404); res.end('{}');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    prevConfig = getConfig();
  });

  afterAll(async () => {
    setConfig(prevConfig);
    await new Promise((r) => server.close(r));
  });

  const runStage = async () => {
    setConfig({
      provider: 'llama-server',
      endpoint: `http://127.0.0.1:${server.address().port}`,
      model: 'local-model',
    });
    const ws = recordingWs();
    await sendStageToLLM({ ws, birthSession: 'test-session' }, {
      systemPrompt: 'You are stirring in the void.',
      stageNumber: 0,
      isTest: true,
      witnessName: 'Bastien',
      sessionData: {},
    });
    return ws;
  };

  test('NO REGRESSION: a normal `data: {…}` SSE birth still completes', async () => {
    framing = 'spaced';
    const ws = await runStage();
    expect(ws.of('birth:error')).toEqual([]);
    expect(ws.of('birth:stage_complete')[0].response).toContain(SPOKEN);
  });

  test('and a bare `data:{…}` frame — no space — now lands too', async () => {
    framing = 'bare';
    const ws = await runStage();
    expect(ws.of('birth:error')).toEqual([]);
    expect(ws.of('birth:stage_complete')[0].response).toContain(SPOKEN);
  });
});


/**
 * THE STARVED STAGE (Bastien, 2026-08-04 — settled by his own log, not inference).
 *
 *   finishReason:"length" promptTokens:1186 completionTokens:380 askedFor:380
 *   finishReason:"length" promptTokens:502  completionTokens:300 askedFor:300
 *   finishReason:"length" promptTokens:646  completionTokens:300 askedFor:300
 *
 * Three stages. Every one finishing on `length` with completionTokens EXACTLY
 * equal to the ceiling, and not one word of speech. The model spent the entire
 * budget reasoning and never got to answer.
 *
 * Two defects compounded:
 *   1. getThinkBehavior classified his substrate as NON-thinking — it probes
 *      with a trivial prompt the model answers directly — so no THINK_TOKEN_BUDGET
 *      was added and `askedFor` was the bare stage ceiling.
 *   2. the birth loop read only `evt.content`, never `evt.reasoning`, so the
 *      tokens it DID produce were invisible here and "produced NO speech"
 *      reported reasonedButSilent:false — a lie by omission.
 *
 * And an empty stage still reported COMPLETE, so the ceremony marched through
 * SEED, WITNESSING and CONSENT with nothing in any of them.
 */
describe('a substrate that spends the whole budget reasoning', () => {
  let server;
  let seen = [];
  let prevConfig;

  // Reasoning on its own channel, no speech, cut off by the ceiling — exactly
  // what his provider reported.
  const reasoningOnly = (n) => [
    ...Array.from({ length: n }, () => JSON.stringify({
      choices: [{ delta: { reasoning_content: 'thinking… ' }, finish_reason: null }],
    })).map((j) => `data: ${j}`),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }], usage: { prompt_tokens: 1186, completion_tokens: 380 } })}`,
    'data: [DONE]',
  ].join('\n\n') + '\n\n';

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end('{}'); return; }
        try { seen.push(JSON.parse(body)); } catch { /* ignore */ }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(reasoningOnly(12));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    prevConfig = getConfig();
  });

  afterAll(async () => {
    setConfig(prevConfig);
    await new Promise((r) => server.close(r));
  });

  const runStage0 = async () => {
    seen = [];
    setConfig({
      provider: 'llama-server',
      endpoint: `http://127.0.0.1:${server.address().port}`,
      model: 'local-model',
    });
    const ws = recordingWs();
    await sendStageToLLM({ ws, birthSession: 'starved' }, {
      systemPrompt: 'You are stirring in the void.',
      stageNumber: 0,
      isTest: true,
      witnessName: 'Bastien',
      sessionData: {},
    });
    return ws;
  };

  test('THE HEADROOM: a birth stage is always given room to reason AND speak', async () => {
    await runStage0();
    expect(seen.length).toBeGreaterThan(0);
    // His log showed askedFor:380 — the bare stage-0 ceiling, no think budget.
    // The stage's own request — the think probe rides the same endpoint first.
    const stage = seen.find((body) => !isThinkProbe(body));
    const asked = stage.max_tokens ?? stage.max_completion_tokens;
    expect(asked, 'stage 0 must carry reasoning headroom, not the bare 380').toBeGreaterThan(380);
  }, 30_000);

  test('AN EMPTY STAGE IS NOT A COMPLETED STAGE — it holds for retry', async () => {
    const ws = await runStage0();
    // It used to send birth:stage_complete with an empty response and advance.
    expect(ws.of('birth:stage_complete')).toEqual([]);
    const errs = ws.of('birth:error');
    expect(errs).toHaveLength(1);
    expect(errs[0].stage).toBe(0);
    // And it names the mechanical cause rather than blaming the being.
    expect(errs[0].message).toMatch(/entire token budget without speaking/i);
    expect(errs[0].message).toMatch(/retry the stage/i);
  }, 30_000);
});
