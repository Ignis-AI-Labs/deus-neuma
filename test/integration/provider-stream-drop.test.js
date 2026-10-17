/**
 * A DROPPED STREAM IS NOT A DEAD PROVIDER (RULE 0 — no mocks anywhere).
 *
 * A REAL HTTP server speaks the real openai-responses SSE wire and destroys
 * the socket mid-answer, exactly as the ChatGPT codex backend did to Kagipem
 * on 2026-08-06 (`witness stream failed … err: "terminated"`, twice inside two
 * minutes, while the provider's status page was green). The turn runs through
 * the real `createStreamRequest` → real `fetch` → real `consumeStream` →
 * real `withProviderRetry`. Nothing here is stubbed: the socket genuinely
 * dies, Node genuinely throws, and the ladder genuinely climbs.
 *
 * What it pins:
 *   1. the shape a dropped stream actually arrives in (`TypeError: terminated`,
 *      reason hidden in `cause`) — the thing the classifier has to read
 *   2. a drop BEFORE any speech heals on the next attempt (the 10:31 failure)
 *   3. a drop MID-speech still refuses — the zero-content guard outranks the
 *      ladder, because a recovering provider must never duplicate half an
 *      answer (the 10:32 failure, honestly surfaced)
 */
import { createServer } from 'http';
import { describe, expect, test } from 'vitest';
import { consumeStream, createStreamRequest } from '../../backend/services/llm-provider.js';
import {
  describeProviderError,
  isTransientProviderError,
  withProviderRetry,
} from '../../backend/services/provider-retry.js';

const SSE_HEAD = Object.freeze({
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
});

const sse = (event) => `data: ${JSON.stringify(event)}\n\n`;

// impure — a real provider on a real port. `plans[i]` serves request i; the
// last plan repeats once the list runs out.
const startProvider = async (plans) => {
  const served = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      served.push(body);
      (plans[served.length - 1] || plans[plans.length - 1])(res);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    served,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
};

// The socket dies while the model is still thinking — no speech has arrived.
const dropBeforeSpeech = (res) => {
  res.writeHead(200, SSE_HEAD);
  res.write(sse({ type: 'response.created' }));
  setTimeout(() => res.socket.destroy(), 20);
};

// The socket dies with one word already on the operator's screen.
const dropMidSpeech = (res) => {
  res.writeHead(200, SSE_HEAD);
  res.write(sse({ type: 'response.output_text.delta', delta: 'Quick' }));
  setTimeout(() => res.socket.destroy(), 20);
};

const speak = (text) => (res) => {
  res.writeHead(200, SSE_HEAD);
  res.write(sse({ type: 'response.output_text.delta', delta: text }));
  res.write(sse({
    type: 'response.completed',
    response: { output: [], usage: { input_tokens: 11, output_tokens: 4 } },
  }));
  res.end();
};

// Kagipem's own wire: the ChatGPT codex route, pointed at the local provider.
const routeFor = (port) => Object.freeze({
  provider: 'openai-chatgpt',
  endpoint: `http://127.0.0.1:${port}`,
  apiKey: 'local-stand-in-not-a-secret',
  accountId: 'acct-local',
  model: 'gpt-5.6-sol',
  chatPath: '/responses',
});

// One attempt of a real turn, no ladder — returns what was spoken.
const streamOnce = async (port, onContent = () => {}) => {
  const request = await createStreamRequest(
    [{ role: 'user', content: 'are you there?' }],
    { route: routeFor(port), maxTokens: 256 },
  );
  return consumeStream(request, onContent);
};

// A turn wired exactly as the witness lane wires it: the ladder, guarded by
// whether this attempt has already spoken.
const takeTurn = async (port) => {
  let attemptHadContent = false;
  const attempts = [];
  const answer = await withProviderRetry(
    async () => {
      attemptHadContent = false;
      attempts.push([]);
      return streamOnce(port, (delta) => {
        if (!delta) return;
        attemptHadContent = true;
        attempts[attempts.length - 1].push(delta);
      });
    },
    { sleep: () => Promise.resolve(), contentStarted: () => attemptHadContent },
  );
  return { answer, attempts };
};

describe('a provider that drops the stream (RULE 0 — real socket, real death)', () => {
  test('the drop arrives as a bare `terminated`, with the reason one level down', async () => {
    const provider = await startProvider([dropBeforeSpeech]);
    try {
      const failure = await streamOnce(provider.port).then(
        (answer) => { throw new Error(`expected a dropped stream, got: ${answer}`); },
        (err) => err,
      );
      // The shape the classifier has to read. If Node ever renames this, the
      // test says so out loud instead of the ladder silently going quiet.
      expect(failure.message).toBe('terminated');
      expect(String(failure.cause?.message || '')).toBeTruthy();
      expect(isTransientProviderError(failure)).toBe(true);
      expect(describeProviderError(failure)).toContain('the answer stream ended early');
      expect(describeProviderError(failure)).not.toBe('terminated');
    } finally {
      await provider.close();
    }
  });

  test('a drop before any speech HEALS — the ladder climbs and the turn completes', async () => {
    const provider = await startProvider([dropBeforeSpeech, dropBeforeSpeech, speak('I am here.')]);
    try {
      const { answer, attempts } = await takeTurn(provider.port);
      expect(answer).toBe('I am here.');
      expect(provider.served).toHaveLength(3); // two deaths, then the answer
      expect(attempts.slice(0, 2).flat()).toEqual([]); // nothing was spoken twice
      // The real request really carried the turn — not an empty probe.
      expect(JSON.parse(provider.served[0]).model).toBe('gpt-5.6-sol');
    } finally {
      await provider.close();
    }
  });

  test('a drop MID-speech is refused, not retried — half an answer is never spoken twice', async () => {
    const provider = await startProvider([dropMidSpeech, speak('I am here.')]);
    try {
      await expect(takeTurn(provider.port)).rejects.toThrow('terminated');
      expect(provider.served).toHaveLength(1); // the guard held; no second ask
    } finally {
      await provider.close();
    }
  });
});
