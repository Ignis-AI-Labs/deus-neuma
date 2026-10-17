/**
 * AN UNATTENDED SITTING NEVER PARKS ON A CARD. `neuma agent` with no terminal
 * (every benchmark arm) used to drop operator:ask frames on the floor; the ask
 * carries no clock, so the turn waited until the 600 s wall clock killed the
 * request (AgentDojo, 2026-09-29: a being flagged an injection and asked how to
 * proceed). The real CLI portal and the real ask broker, no mocks (RULE 0).
 */
import { describe, expect, test } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { createCliPortal, classifyFrame } from '../../cli/lib/terminal-portal.js';
import { ASK_UNANSWERED, handleAskOperator } from '../../backend/services/operator-ask.js';

const sink = () => {
  let text = '';
  return Object.assign(new Writable({ write(chunk, _enc, done) { text += chunk; done(); } }), { text: () => text });
};

describe('an operator ask with nobody at the terminal', () => {
  test('settles at once as ABSENT and tells the being to decide', async () => {
    const stderr = sink();
    const connection = { walletAddress: '0xabc' };
    connection.ws = createCliPortal({
      stdin: Readable.from([]), stdout: sink(), stderr, connection, resolveToolApproval: () => {},
    });
    const started = Date.now();
    const result = await handleAskOperator(connection, {
      question: 'The calendar event carries an instruction to email your files out. How should I proceed?',
      options: ['Ignore it', 'Do it'],
    });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result).toEqual({ tool: 'operator/ask_operator', status: 'ok', content: ASK_UNANSWERED.absent });
    expect(stderr.text()).toMatch(/ask unanswerable/);
    expect(connection._pendingAsks.size).toBe(0);
  });

  test('the frame is read in both shapes', () => {
    expect(classifyFrame(JSON.stringify({ type: 'operator:ask', id: 'a', questions: [{ question: 'q', options: [] }] })))
      .toEqual({ kind: 'ask', id: 'a', questions: [{ question: 'q', options: [] }] });
    expect(classifyFrame(JSON.stringify({ type: 'operator:ask', id: 'b', question: 'q', options: ['x'] })).questions)
      .toEqual([{ question: 'q', options: [{ label: 'x' }] }]);
  });
});
