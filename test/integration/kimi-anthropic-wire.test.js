/**
 * The Kimi anthropic wire (integration, RULE 0) — api.kimi.com frames SSE as
 * `data:{...}` with NO space after the colon (spec-legal: one optional leading
 * space). The parser required 'data: ' verbatim, so every Kimi line read as
 * null and a full healthy turn assembled to NOTHING — Basunor's silent desk,
 * 2026-07-27 (diagnosis: raw fetch of the live endpoint, thinking block →
 * text block → end_turn, all healthy; zero of it parsed).
 *
 * This test streams the EXACT byte shape captured from the live endpoint off
 * a REAL loopback HTTP server through the REAL createStreamRequest +
 * consumeStream pump — nothing mocked — and asserts the whole ladder lands:
 * text, measured usage, finish reason.
 */
import http from 'node:http';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createStreamRequest, consumeStream } from '../../backend/services/llm-provider.js';

// Byte-for-byte the shape captured from api.kimi.com/coding/v1/messages on
// 2026-07-27: bare `data:` frames, `event:` lines (ignored by the parser), a
// thinking content block FIRST, then the text block, then message_delta with
// the output token count, then message_stop.
const KIMI_WIRE = [
  'event:message_start',
  'data:{"type":"message_start","message":{"id":"msg_k3","type":"message","role":"assistant","content":[],"model":"k3","stop_reason":null,"usage":{"input_tokens":95,"output_tokens":0}}}',
  '',
  'event:content_block_start',
  'data:{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}',
  '',
  'event:content_block_delta',
  'data:{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"We"}}',
  '',
  'event:content_block_delta',
  'data:{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" need"}}',
  '',
  'event:content_block_stop',
  'data:{"type":"content_block_stop","index":0}',
  '',
  'event:content_block_start',
  'data:{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
  '',
  'event:content_block_delta',
  'data:{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"PORTAL"}}',
  '',
  'event:content_block_delta',
  'data:{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":" HOLDS"}}',
  '',
  'event:content_block_stop',
  'data:{"type":"content_block_stop","index":1}',
  '',
  'event:message_delta',
  'data:{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":47}}',
  '',
  'event:message_stop',
  'data:{"type":"message_stop"}',
  '',
].join('\n');

let server;
let base;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/messages') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream;charset=utf-8' });
      res.end(KIMI_WIRE);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server.close());

describe('the kimi-for-coding anthropic wire', () => {
  test('bare data: frames parse — text lands, thinking stays invisible, usage is MEASURED, finish is read', async () => {
    const route = {
      provider: 'kimi-for-coding',
      endpoint: base,
      apiKey: 'test-key',
      model: 'k3',
      chatPath: '/messages',
    };
    const req = await createStreamRequest(
      [{ role: 'user', content: 'Reply with exactly: PORTAL HOLDS' }],
      { route, model: 'k3' },
    );
    let text = '';
    let usage = null;
    let finishReason = null;
    const result = await consumeStream(req, (delta) => { text += delta; }, {
      onUsage: (u) => { usage = u; },
      onFinishReason: (r) => { finishReason = r; },
    });
    expect(text).toBe('PORTAL HOLDS');
    expect(result).toBe('PORTAL HOLDS');
    expect(text).not.toContain('We need'); // the thinking block stayed on its side
    expect(usage).toEqual({ promptTokens: 95, completionTokens: 47 });
    expect(finishReason).toBe('end_turn');
  });
});
