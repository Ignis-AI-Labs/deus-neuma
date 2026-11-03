/* global process */
import http from 'node:http';
import path from 'node:path';
import { once } from 'node:events';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createStreamRequest, consumeStream } from '../../backend/services/llm-provider.js';
import { compactBeforeTurn } from '../../backend/services/context-overflow.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createTempDir } from '../helpers/temp-fs.js';

const image = (label) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${label.repeat(1000)}` } });
const hasInTurnImage = (body) => body.messages.slice(2).some((message) =>
  Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'));
const overflowBody = JSON.stringify({ error: { code: 400, message: 'REQUEST (183296 TOKENS) EXCEEDS THE AVAILABLE CONTEXT SIZE (65536 TOKENS)', type: 'EXCEED_CONTEXT_SIZE_ERROR', n_prompt_tokens: 183296, n_ctx: 65536 } });

const overflowServer = async () => {
  const received = [];
  let rejectAll = null;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      received.push(body);
      if (rejectAll || hasInTurnImage(body)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(rejectAll === 'overflow' || !rejectAll ? overflowBody : '{"error":{"message":"invalid sampling parameter"}}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"recovered"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, received, rejectAll: (value) => { rejectAll = value; } };
};

const closeServer = async (server) => {
  server.closeAllConnections();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
};

describe('provider-confirmed overflow recovery over real HTTP', () => {
  test('the exact context refusal folds in-turn images and retries once, preserving the current attachment', async () => {
    const { server, received } = await overflowServer();
    try {
      const route = { provider: 'openai', endpoint: `http://127.0.0.1:${server.address().port}`, apiKey: '', model: 'overflow-test' };
      const messages = [
        { role: 'system', content: 'identity' },
        { role: 'user', content: [{ type: 'text', text: 'review my attachment' }, image('CURRENT')] },
        { role: 'assistant', content: 'I read the render.', tool_calls: [{ id: 'call-1', function: { name: 'fs/read', arguments: '{"path":"render.png"}' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: 'image returned\n'.repeat(100) },
        { role: 'user', content: [{ type: 'text', text: 'look now' }, image('REVIEW')] },
      ];
      let recovered = null;
      const stream = await createStreamRequest(messages, {
        route, maxTokens: 128, contextHead: 2, onContextRecovery: (value) => { recovered = value; },
      });
      expect(await consumeStream(stream, () => {})).toBe('recovered');
      expect(received).toHaveLength(2);
      expect(hasInTurnImage(received[0])).toBe(true);
      expect(hasInTurnImage(received[1])).toBe(false);
      expect(received[1].messages[0]).toEqual(messages[0]);
      expect(received[1].messages[1]).toEqual(messages[1]);
      expect(received[1].messages[2].content).toBe('I read the render.');
      expect(received[1].messages[3].content).toContain('folded: this earlier result was released');
      expect(received[1].messages[4].content[1].type).toBe('text');
      expect(recovered.foldedRounds).toBe(1);
    } finally {
      await closeServer(server);
    }
  });

  test('a second overflow fails after exactly one recovered retry', async () => {
    const { server, received, rejectAll } = await overflowServer();
    rejectAll('overflow');
    try {
      const route = { provider: 'openai', endpoint: `http://127.0.0.1:${server.address().port}`, apiKey: '', model: 'overflow-test' };
      const messages = [
        { role: 'system', content: 'identity' },
        { role: 'user', content: 'review' },
        { role: 'assistant', content: 'reading now' },
        { role: 'user', content: [{ type: 'text', text: 'look' }, image('REVIEW')] },
      ];
      await expect(createStreamRequest(messages, { route, maxTokens: 128, contextHead: 2 }))
        .rejects.toThrow(/EXCEED_CONTEXT_SIZE_ERROR/);
      expect(received).toHaveLength(2);
    } finally {
      await closeServer(server);
    }
  });

  test('an unrelated 400 is not retried', async () => {
    const { server, received, rejectAll } = await overflowServer();
    rejectAll(true);
    try {
      const route = { provider: 'openai', endpoint: `http://127.0.0.1:${server.address().port}`, apiKey: '', model: 'overflow-test' };
      await expect(createStreamRequest([{ role: 'user', content: 'hello' }], { route, maxTokens: 128, contextHead: 1 }))
        .rejects.toThrow(/invalid sampling parameter/);
      expect(received).toHaveLength(1);
    } finally {
      await closeServer(server);
    }
  });
});

describe('turn-start compaction on real disk', () => {
  let previousRoot;
  let previousKey;

  beforeAll(async () => {
    previousRoot = getWorkspacesRoot();
    previousKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'context-overflow-test-key';
    setWorkspacesRoot(path.join(await createTempDir('context-overflow-compaction'), 'workspaces'));
  });

  afterAll(() => {
    setWorkspacesRoot(previousRoot);
    if (previousKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = previousKey;
  });

  test('a measured near-full interrupted session compacts before the next assembly', async () => {
    await workspace.create('overflow-compact');
    const words = ' preserve the decision and the next action in the continuity record.'.repeat(40);
    for (let i = 0; i < 20; i += 1) {
      await workspace.appendMessage('overflow-compact', 'session', { role: 'user', content: `question ${i}${words}` });
      await workspace.appendMessage('overflow-compact', 'session', { role: 'assistant', content: `answer ${i}${words}` });
    }
    const connection = { contextRecoveryPending: true, lastMeasuredStanding: { promptTokens: 64000 }, contextComposition: { usage: { inputTokens: 64000, source: 'carried' } } };
    const states = [];
    const compacted = await compactBeforeTurn({
      connection,
      contextWindow: 65536,
      compact: () => workspace.compactSession('overflow-compact', 'session', { threshold: 30, keepRecent: 20 }),
      onState: (state) => states.push(state),
    });
    expect(compacted).toBe(true);
    expect(states).toEqual(['running', 'done']);
    expect(await workspace.readSession('overflow-compact', 'session')).toHaveLength(21);
    expect(connection.lastMeasuredStanding).toBeNull();
    expect(connection.contextComposition).toBeNull();
    expect(await compactBeforeTurn({
      connection,
      contextWindow: 65536,
      compact: () => workspace.compactSession('overflow-compact', 'session', { threshold: 30, keepRecent: 20 }),
    })).toBe(false);
    expect(await workspace.readSession('overflow-compact', 'session')).toHaveLength(21);
  });
});
