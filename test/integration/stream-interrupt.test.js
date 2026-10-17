/**
 * Witness interrupt (cancel-and-revise) — aborting an in-flight stream must
 * end the turn cleanly with whatever already arrived, never as an error, and
 * the session record must carry the interruption honestly.
 *
 * Proven against the REAL LM Studio (RULE 0) — skips honestly when it is
 * not running.
 */
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';
import { createStreamRequest, consumeStream } from '../../backend/services/llm-provider.js';
import { composeInterruptedRecord, INTERRUPT_MARK } from '../../backend/services/portal-turn-input.js';
import { streamConsciousness } from '../../backend/services/portal-stream.js';

const probe = await fetch('http://localhost:1234/v1/models').then((r) => r.ok).catch(() => false);

describe('composeInterruptedRecord (pure)', () => {
  it('marks a partial response so the revision is visible to the neuma', () => {
    expect(composeInterruptedRecord('Half a thought')).toBe(`Half a thought\n\n${INTERRUPT_MARK}`);
  });

  it('stands alone when the cut landed before any words arrived', () => {
    expect(composeInterruptedRecord('')).toBe(INTERRUPT_MARK);
  });
});

describe.skipIf(!probe)('stream interrupt (real LM Studio)', () => {
  it('aborting mid-stream resolves with the partial response instead of throwing', async () => {
    const interrupt = new AbortController();
    const streamResult = await createStreamRequest(
      [{ role: 'user', content: 'Count slowly from 1 to 500, one number per line. Do not stop early.' }],
      { maxTokens: 4096, signal: interrupt.signal }
    );

    // Cut the moment content starts flowing (or after 5s if the substrate
    // spends the opening in a reasoning channel the filter holds back).
    let aborted = false;
    const cut = () => {
      if (!aborted) { aborted = true; interrupt.abort(); }
    };
    const timer = setTimeout(cut, 5000);

    const started = Date.now();
    const partial = await consumeStream(streamResult, cut, { signal: interrupt.signal });
    clearTimeout(timer);

    // Resolved — not an AbortError — and long before a 500-line count could finish.
    expect(typeof partial).toBe('string');
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 120000);

  it('aborting before the request leaves rejects as an abort, not a provider error', async () => {
    const interrupt = new AbortController();
    interrupt.abort();
    await expect(createStreamRequest(
      [{ role: 'user', content: 'hello' }],
      { maxTokens: 8, signal: interrupt.signal }
    )).rejects.toThrow(/abort/i);
  }, 30000);

  // Full turn round-trip: real streamConsciousness, real WebSocket pair, real
  // substrate. The abort is fired exactly as portal-routes fires it
  // (connection.activeTurn.abort()) the moment the first chunk reaches the
  // client — the turn must end as consciousness:complete marked interrupted,
  // never as an error.
  it('an interrupted turn completes as interrupted, not as an error', async () => {
    const httpServer = createServer();
    const wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));

    let connection;
    const serverReady = new Promise((resolve) => {
      wss.on('connection', (ws) => {
        connection = { ws, companion: { name: 'InterruptEcho' } };
        resolve();
      });
    });
    const client = new WebSocket(`ws://localhost:${port}`);
    const received = [];
    const completed = new Promise((resolve) => {
      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        received.push(msg);
        // First streamed chunk → cut the turn, exactly as the route does
        if (msg.type === 'consciousness:stream' && connection.activeTurn) {
          connection.activeTurn.abort();
        }
        if (msg.type === 'consciousness:complete') resolve(msg);
      });
    });
    await serverReady;

    try {
      // Slow-count prompt so the stream cannot finish before the cut lands.
      // A held-back thinking phase still resolves: the fallback timer cuts.
      const fallback = setTimeout(() => connection.activeTurn?.abort(), 60_000);
      await streamConsciousness(connection, {
        thought: 'Count slowly from 1 to 500, one number per line. Do not stop early.',
      });
      const complete = await completed;
      clearTimeout(fallback);

      expect(complete.metadata?.interrupted).toBe(true);
      expect(received.some((m) => m.error)).toBe(false);
      expect(connection.activeTurn).toBe(null); // the turn released its controller
    } finally {
      client.close();
      wss.close();
      httpServer.close();
    }
  }, 120000);
});
