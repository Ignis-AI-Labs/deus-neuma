/** Real queue/controller state; no mocked boundaries. */
import { describe, expect, it } from 'vitest';
import { queueThought, editHeldThought, takeHeldThought } from '../../backend/services/held-thoughts.js';
import { yieldForQueuedThought, takeQueuedActionMessages, heardNote, QUEUED_ACTION_REASON, QUEUED_ACTION_MARK } from '../../backend/services/queued-action-handoff.js';
import { composeInterruptedRecord, INTERRUPT_MARK } from '../../backend/services/portal-turn-input.js';

const connectionFor = () => ({
  activeTurn: new globalThis.AbortController(), sessionId: 'chat-1', companion: { neumaId: 'lane-1' },
});

describe('words alone are heard in the turn, never cut it (Design note, 2026-11-20', () => {
  it('plain words do not stop the turn; what must take the floor still does, as before', () => {
    const connection = connectionFor();
    queueThought(connection, { holdId: 'a', thought: 'Also do the Umbrae post after this.' });
    queueThought(connection, { holdId: 'b', thought: 'And check the bounce list.' });
    expect(yieldForQueuedThought(connection, [{ tool: 'fs/read', status: 'ok', content: 'done' }])).toBe(false);
    expect(connection.activeTurn.signal.aborted).toBe(false);
    // An attachment, a retry or a visitor's words cannot ride inside a note: the turn hands over at the boundary.
    for (const held of [{ thought: 'see this', attachments: ['doc'] }, { retry: { turnId: 't1' } }, { thought: 'hello', speaker: { name: 'Guest' } }]) {
      const other = connectionFor();
      queueThought(other, { thought: 'plain first' });
      queueThought(other, held);
      expect(yieldForQueuedThought(other)).toBe(true);
      expect(other.activeTurn.signal.reason).toBe(QUEUED_ACTION_REASON);
    }
  });

  it('the note says whose words, when, and what to do with them', () => {
    const note = heardNote([{ words: 'Also do the Umbrae post.', at: '2026-11-20T14:32:05.000Z' }, { words: 'And the bounce list.', at: '2026-11-20T14:33:00.000Z' }]);
    expect(note.split('\n').slice(0, 2)).toEqual([
      '[YOUR OPERATOR, WHILE YOU WORKED — 14:32 UTC] Also do the Umbrae post.',
      '[YOUR OPERATOR, WHILE YOU WORKED — 14:33 UTC] And the bounce list.',
    ]);
    expect(note).toContain('It does not stop what you are doing: put it on your list now (tasks/add)');
    expect(note).toContain('If it tells you to stop or to change what you are doing, do that instead.');
  });
});

describe('queued action handoff', () => {
  it('waits for the action boundary and leaves edited envelopes in FIFO order', () => {
    const connection = connectionFor();
    const first = { holdId: 'a', thought: 'first', attachments: ['doc-1'], speaker: { name: 'Founder' } };
    queueThought(connection, first);
    queueThought(connection, { holdId: 'b', thought: 'second' });
    editHeldThought(connection, 'a', 'revised');
    expect(connection.activeTurn.signal.aborted).toBe(false);
    expect(yieldForQueuedThought(connection)).toBe(true);
    expect(connection.activeTurn.signal.reason).toBe(QUEUED_ACTION_REASON);
    expect(connection.pendingThoughts[0]).toBe(first);
    expect(connection.pendingThoughts.map((message) => message.thought)).toEqual(['revised', 'second']);
    expect(first.attachments).toEqual(['doc-1']);
  });

  it('does not stop an unqueued turn or a queue recalled before the boundary', () => {
    const connection = connectionFor();
    expect(yieldForQueuedThought(connection)).toBe(false);
    queueThought(connection, { holdId: 'a', thought: 'recalled' });
    takeHeldThought(connection, 'a');
    expect(yieldForQueuedThought(connection)).toBe(false);
    expect(connection.activeTurn.signal.aborted).toBe(false);
  });

  it('preserves manual interruption instead of relabeling it as a handoff', () => {
    const connection = connectionFor();
    connection.activeTurn.abort();
    queueThought(connection, { thought: 'next', attachments: ['doc'] });
    expect(yieldForQueuedThought(connection)).toBe(false);
    expect(composeInterruptedRecord('spoken', connection.activeTurn.signal.reason)).toBe(`spoken\n\n${INTERRUPT_MARK}`);
    expect(composeInterruptedRecord('spoken', QUEUED_ACTION_REASON)).toBe(`spoken\n\n${QUEUED_ACTION_MARK}`);
    expect(composeInterruptedRecord('', QUEUED_ACTION_REASON)).toBe(QUEUED_ACTION_MARK);
  });

  it('carries completed results once to the same chat, with real error outcomes', () => {
    const connection = connectionFor();
    queueThought(connection, { thought: 'next', attachments: ['doc'] });
    yieldForQueuedThought(connection, [
      { tool: 'fs/write', status: 'ok', content: 'saved file' },
      { tool: 'fs/read', status: 'error', error: 'not found' },
    ]);
    const messages = takeQueuedActionMessages(connection);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user' });
    expect(messages[0].content).toContain('saved file');
    expect(messages[0].content).toContain('not found');
    expect(takeQueuedActionMessages(connection)).toEqual([]);
  });

  it('retains earlier tool evidence when the queue arrives during a later response', () => {
    const connection = connectionFor();
    const result = { tool: 'fs/write', status: 'ok', content: 'earlier completed effect' };
    expect(yieldForQueuedThought(connection, [result])).toBe(false);
    expect(yieldForQueuedThought(connection, [result])).toBe(false);
    queueThought(connection, { thought: 'steer while thinking', attachments: ['doc'] });
    expect(yieldForQueuedThought(connection)).toBe(true);
    const content = takeQueuedActionMessages(connection)[0].content;
    expect(content.match(/earlier completed effect/g)).toHaveLength(1);
  });

  it('bounds retained machinery to the working-context tail across a long turn', () => {
    const connection = connectionFor();
    for (let i = 0; i < 20; i += 1) {
      yieldForQueuedThought(connection, [{ tool: 'fs/read', status: 'ok', content: `batch-${i}-result` }]);
    }
    queueThought(connection, { thought: 'next', attachments: ['doc'] });
    yieldForQueuedThought(connection);
    const content = takeQueuedActionMessages(connection)[0].content;
    expect(content).toContain('batch-18-result');
    expect(content).toContain('batch-19-result');
    expect(content).not.toContain('batch-17-result');
  });

  it.each(['sessionId', 'companion'])('cannot carry results across a changed %s', (field) => {
    const connection = connectionFor();
    queueThought(connection, { thought: 'next', attachments: ['doc'] });
    yieldForQueuedThought(connection, [{ tool: 'fs/read', status: 'ok', content: 'private' }]);
    connection[field] = field === 'sessionId' ? 'another-chat' : { neumaId: 'another-lane' };
    expect(takeQueuedActionMessages(connection)).toEqual([]);
  });
});
