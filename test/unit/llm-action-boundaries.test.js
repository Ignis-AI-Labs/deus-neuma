/** Actual stream parser over protocol bytes; this does not claim model inference. */
import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { consumeStream, consumeStreamWithTools } from '../../backend/services/llm-provider.js';
import { queueThought } from '../../backend/services/held-thoughts.js';
import { yieldForQueuedThought, QUEUED_ACTION_REASON } from '../../backend/services/queued-action-handoff.js';

const frame = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
const streamOf = (deltas) => ({
  provider: 'openai', response: new globalThis.Response(deltas.map(frame).join('') + 'data: [DONE]\n\n'),
});
const run = async (deltas, { queued = true, implicitOpen = false, native = false } = {}) => {
  const connection = { activeTurn: new globalThis.AbortController() };
  if (queued) queueThought(connection, { thought: 'new direction' });
  const spoken = [];
  const reasoning = [];
  const usages = [];
  const consume = native ? consumeStreamWithTools : consumeStream;
  const result = await consume(streamOf(deltas), (text) => spoken.push(text), {
    implicitOpen, signal: connection.activeTurn.signal,
    onReasoning: (text) => reasoning.push(text), onUsage: (usage) => usages.push(usage),
    onActionBoundary: () => yieldForQueuedThought(connection),
  });
  return { result, spoken, reasoning, usages, connection };
};

describe('completed stream actions', () => {
  it('stops after a completed statement, even with later events in the same transport read', async () => {
    const value = await run([{ content: 'One' }, { content: ' statement.' }, { content: ' Next action.' }]);
    expect(value.result).toBe('One statement.');
    expect(value.spoken.join('')).toBe(value.result);
    expect(value.connection.activeTurn.signal.reason).toBe(QUEUED_ACTION_REASON);
    expect(value.usages).toEqual([null]);
  });

  it('retains received speech when the handoff aborts an actual HTTP byte stream', async () => {
    const connection = { activeTurn: new globalThis.AbortController() };
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(frame({ content: 'First part' }));
      response.write(frame({ content: ' completed.' }));
      response.write(frame({ content: ' Must not reach the chat.' }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${server.address().port}/protocol-bytes`, {
        signal: connection.activeTurn.signal,
      });
      const spoken = [];
      const result = await consumeStream({ provider: 'openai', response }, (text) => {
        spoken.push(text);
        if (text === 'First part') queueThought(connection, { thought: 'Change direction.' });
      }, {
        signal: connection.activeTurn.signal,
        onActionBoundary: () => yieldForQueuedThought(connection),
      });
      expect(result).toBe('First part completed.');
      expect(spoken.join('')).toBe(result);
      expect(connection.activeTurn.signal.reason).toBe(QUEUED_ACTION_REASON);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('keeps unqueued output unchanged across statements', async () => {
    const value = await run([{ content: 'One.' }, { content: ' Two.' }], { queued: false });
    expect(value.result).toBe('One. Two.');
    expect(value.connection.activeTurn.signal.aborted).toBe(false);
  });

  it('waits for native reasoning to finish, before speaking or issuing tools', async () => {
    const value = await run([{ reasoning_content: 'First thought.' }, { reasoning_content: ' More thought.' }, { content: 'Answer.' }]);
    expect(value.reasoning.join('')).toBe('First thought. More thought.');
    expect(value.result).toBe('');
    expect(value.spoken).toEqual([]);
    expect(value.connection.activeTurn.signal.aborted).toBe(true);
  });

  it.each([false, true])('waits for the inline reasoning closer (implicitOpen=%s)', async (implicitOpen) => {
    const value = await run([
      { content: `${implicitOpen ? '' : '<think>'}Thinking.` },
      { content: ' Still thinking.</think>' }, { content: 'Answer.' },
    ], { implicitOpen });
    expect(value.result).toBe('');
    expect(value.spoken).toEqual([]);
    expect(value.reasoning.join('')).toBe('Thinking. Still thinking.');
    expect(value.connection.activeTurn.signal.aborted).toBe(true);
  });

  it('does not treat code or text tool payloads as completed speech', async () => {
    const value = await run([
      { content: '```js\n// comment.' }, { content: '\nconst x = 1;\n```\n' },
      { content: '<tool_call>\n{"text":"inside.' }, { content: '"}\n</tool_call>\n' },
      { content: 'Finished.' }, { content: ' Later.' },
    ]);
    expect(value.result).toContain('const x = 1;');
    expect(value.result).toContain('</tool_call>');
    expect(value.result).toMatch(/Finished\.$/);
    expect(value.result).not.toContain('Later');
  });

  it('assembles the whole native call before the round boundary can hand off', async () => {
    const value = await run([
      { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'fs__read', arguments: '{"path":' } }] },
      { tool_calls: [{ index: 0, function: { arguments: '"/tmp/source"}' } }] },
    ], { native: true });
    expect(value.connection.activeTurn.signal.aborted).toBe(false);
    expect(value.result.toolCalls).toHaveLength(1);
    expect(value.result.toolCalls[0].args).toEqual({ path: '/tmp/source' });
  });
});
