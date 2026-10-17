/**
 * THE SEQUENCED ASK (RULE 0) — Design note, 2026-07-27, watching Kagipem run
 * sc-research: five settings arrived as ONE question with every option from
 * every question in a single flat row, so no tap could answer anything.
 *
 * Real WebSocket pair, the real broker, the real portal message route. The
 * whole round trip runs: a being asks five questions, the desk answers them
 * one at a time, and the being reads back Q -> A pairs it cannot misattribute.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  normalizeAsk, requestOperatorAnswer, resolveOperatorAsk, composeAskAnswer,
  expirePendingAsks, ASK_QUESTIONS_MAX,
} from '../../backend/services/operator-ask.js';

// The exact five the screenshot showed, in the order the protocol asks them.
const SC_RESEARCH = Object.freeze({
  questions: [
    { question: 'Which marketing and research tools best fit the X-first outreach flow?', header: 'Question' },
    {
      question: 'What output format?',
      header: 'Format',
      options: [{ label: 'Markdown report', description: 'decision matrix + phased plan' }, { label: 'Slide outline' }],
    },
    {
      question: 'What citation standard?',
      header: 'Citations',
      options: [{ label: 'Primary sources required' }, { label: 'Secondary allowed' }],
    },
    {
      question: 'How deep should the research go?',
      header: 'Budget',
      options: [
        { label: 'Deep', description: 'a full day, bounded waves' },
        { label: 'Standard', description: 'a few hours' },
      ],
    },
    {
      question: 'How many research roles?',
      header: 'Team',
      options: [{ label: '4-7 roles' }, { label: '2-3 roles' }, { label: 'Solo research' }],
    },
  ],
});

let httpServer; let wss; let serverWs; let client; let connection; let frames;

beforeEach(async () => {
  httpServer = createServer();
  wss = new WebSocketServer({ server: httpServer });
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const linked = new Promise((r) => wss.once('connection', (s) => { serverWs = s; r(); }));
  client = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}`);
  const opened = new Promise((r) => client.once('open', r));
  await Promise.all([linked, opened]);
  frames = [];
  client.on('message', (d) => frames.push(JSON.parse(d.toString())));
  connection = { ws: serverWs, companion: { name: 'Kagipem', neumaId: 'witness-openai-chatgpt-Kagipem' } };
});

afterEach(async () => {
  if (client?.readyState === WebSocket.OPEN) client.terminate();
  if (serverWs?.readyState === WebSocket.OPEN) serverWs.terminate();
  await new Promise((r) => wss.close(r));
  await new Promise((r) => httpServer.close(r));
});

const nextFrame = (type) => new Promise((resolve, reject) => {
  const started = Date.now();
  const poll = () => {
    const f = frames.find((x) => x.type === type);
    if (f) resolve(f);
    else if (Date.now() - started > 3000) reject(new Error(`no ${type} frame`));
    else setTimeout(poll, 5);
  };
  poll();
});

describe('normalizeAsk — a protocol asks several things, each with its own options', () => {
  test('five sequenced settings survive as five separate, answerable questions', () => {
    const ask = normalizeAsk(SC_RESEARCH);
    expect(ask.questions).toHaveLength(5);
    // The regression this exists for: options must stay attached to THEIR
    // question. "2-3 roles" is a Team answer and must never sit beside a
    // Budget choice in one undifferentiated row.
    const budget = ask.questions.find((q) => q.header === 'Budget');
    const team = ask.questions.find((q) => q.header === 'Team');
    expect(budget.options.map((o) => o.label)).toEqual(['Deep', 'Standard']);
    expect(team.options.map((o) => o.label)).toEqual(['4-7 roles', '2-3 roles', 'Solo research']);
    expect(budget.options.map((o) => o.label)).not.toContain('2-3 roles');
    // A question may carry no options at all — it is answered in own words.
    expect(ask.questions[0].options).toEqual([]);
    expect(budget.options[0].description).toBe('a full day, bounded waves');
  });

  test('the ORIGINAL single-question shape still works untouched', () => {
    const ask = normalizeAsk({ question: 'Ship it?', options: ['Yes', 'Not yet'] });
    expect(ask.questions).toHaveLength(1);
    expect(ask.questions[0].question).toBe('Ship it?');
    expect(ask.questions[0].options).toEqual([
      { label: 'Yes', description: '' }, { label: 'Not yet', description: '' },
    ]);
  });

  test('nothing to ask is null, and an interrogation is bounded', () => {
    expect(normalizeAsk({})).toBeNull();
    expect(normalizeAsk({ questions: [] })).toBeNull();
    expect(normalizeAsk({ questions: [{ question: '   ' }] })).toBeNull();
    const many = normalizeAsk({ questions: Array.from({ length: 20 }, (_, i) => ({ question: `Q${i}` })) });
    expect(many.questions).toHaveLength(ASK_QUESTIONS_MAX);
  });
});

describe('composeAskAnswer — the being cannot misattribute an answer', () => {
  test('each answer is paired with the question it answers', () => {
    const text = composeAskAnswer(
      [{ question: 'Budget?' }, { question: 'Team?' }], ['Deep', '2-3 roles'],
    );
    expect(text).toContain('1. Budget?\n   → Deep');
    expect(text).toContain('2. Team?\n   → 2-3 roles');
  });

  test('a skipped question says so instead of shifting the ones after it', () => {
    const text = composeAskAnswer(
      [{ question: 'A?' }, { question: 'B?' }, { question: 'C?' }], ['first', '', 'third'],
    );
    expect(text).toContain('2. B?\n   → (not answered)');
    expect(text).toContain('3. C?\n   → third');
  });

  test('a single question answers as bare words — no numbering theatre', () => {
    expect(composeAskAnswer([{ question: 'Ship it?' }], ['yes'])).toBe('yes');
  });
});

describe('the real round trip over a real portal', () => {
  test('the desk receives every question, and answers land per question', async () => {
    const ask = normalizeAsk(SC_RESEARCH);
    const pending = requestOperatorAnswer(connection, { questions: ask.questions });

    const frame = await nextFrame('operator:ask');
    expect(frame.questions).toHaveLength(5);
    expect(frame.questions[3].header).toBe('Budget');
    // An older desk that only knows {question, options} still gets the FIRST
    // question rather than an empty card.
    expect(frame.question).toContain('Which marketing and research tools');

    resolveOperatorAsk(connection, frame.id, '', [
      'Focus on X-native tooling', 'Markdown report', 'Primary sources required', 'Deep', '2-3 roles',
    ]);

    const outcome = await pending;
    expect(outcome.status).toBe('answered');
    expect(outcome.answers).toHaveLength(5);
    expect(outcome.answer).toContain('4. How deep should the research go?\n   → Deep');
    expect(outcome.answer).toContain('5. How many research roles?\n   → 2-3 roles');

    const resolved = await nextFrame('operator:ask_resolved');
    expect(resolved.status).toBe('answered');
    expect(resolved.answers).toHaveLength(5);
  });

  test('a single free-text reply still settles the ask (legacy path)', async () => {
    const ask = normalizeAsk({ question: 'Ship it?', options: ['Yes'] });
    const pending = requestOperatorAnswer(connection, { questions: ask.questions });
    const frame = await nextFrame('operator:ask');
    expect(frame.options).toEqual(['Yes']);

    resolveOperatorAsk(connection, frame.id, 'ship it tomorrow');
    expect((await pending).answer).toBe('ship it tomorrow');
  });

  test('an all-empty answer set leaves the card pending — silence is not an answer', async () => {
    const ask = normalizeAsk(SC_RESEARCH);
    const pending = requestOperatorAnswer(connection, { questions: ask.questions });
    const frame = await nextFrame('operator:ask');

    expect(resolveOperatorAsk(connection, frame.id, '', ['', '', '', '', ''])).toBe(false);
    expect(resolveOperatorAsk(connection, frame.id, '')).toBe(false);
    // Still pending: only a real reply, or a settle path, closes it.
    expect(resolveOperatorAsk(connection, frame.id, '', ['', '', 'Deep', '', ''])).toBe(true);
    expect((await pending).answer).toContain('→ Deep');
  });

  test('a portal torn down mid-question settles honestly, never hangs the turn', async () => {
    const ask = normalizeAsk(SC_RESEARCH);
    const pending = requestOperatorAnswer(connection, { questions: ask.questions });
    await nextFrame('operator:ask');
    expirePendingAsks(connection);
    const outcome = await pending;
    expect(outcome.status).not.toBe('answered');
  });
});
