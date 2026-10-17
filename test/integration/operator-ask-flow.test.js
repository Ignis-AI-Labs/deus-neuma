/**
 * Witness ask flow (TEAM PROJECTS slice 1) — a being's question to its
 * witness, proven end to end with NO mock on the claimed path (AGENTS.md
 * RULE 0): REAL WebSocket pair, REAL processToolCalls dispatch, REAL broker.
 *
 * The contract under proof: ask_operator pauses the turn on the operator's
 * actual words riding back through the portal — and when no words come
 * (timeout, interrupt, close), the being is TOLD nobody answered, never
 * handed a fabricated reply.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { __test } from '../../backend/services/portal-test-surface.js';
import {
  askShapeError, normalizeAsk, requestOperatorAnswer, resolveOperatorAsk, expirePendingAsks,
  ASK_QUESTION_MAX_CHARS, ASK_OPTIONS_MAX, ASK_OPTION_MAX_CHARS, ASK_ANSWER_MAX_CHARS,
} from '../../backend/services/operator-ask.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { KIND } from '../../core/runtime/notification-record.js';

const { processToolCalls, ASK_OPERATOR_TOOL, _handleAskOperator } = __test;

const askCall = (args) => `[TOOL: operator/ask_operator ${JSON.stringify(args)}]`;

describe('witness ask flow (real WS, gnosis)', () => {
  let httpServer, wss, serverWs, client, port;
  let clientLog; // every message the operator's desk received, in order
  let answer = null; // when armed, the desk answers operator:ask with it

  const freshConnection = () => ({
    ws: serverWs,
    companion: { name: 'AskEcho', neumaId: 'askecho' },
  });

  // Mirror the route: the operator's reply settles the pending ask.
  const wireAsks = (connection) => {
    serverWs.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'operator:ask_response') resolveOperatorAsk(connection, m.id, m.answer);
    });
  };

  const untilClient = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = clientLog.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error('client message never arrived'));
      setTimeout(tick, 20);
    };
    tick();
  });

  beforeAll(async () => {
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws) => { serverWs = ws; resolve(); });
    });
    client = new WebSocket(`ws://localhost:${port}`);
    clientLog = [];
    client.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      clientLog.push(msg);
      if (msg.type === 'operator:ask' && answer) {
        client.send(JSON.stringify({ type: 'operator:ask_response', id: msg.id, answer: answer(msg) }));
      }
    });
    await linked;
  }, 60000);

  afterAll(() => {
    vi.restoreAllMocks();
    client?.close();
    wss?.close();
    httpServer?.close();
  });

  test('the tool advertises the sequenced shape, and the single question still fits', () => {
    expect(ASK_OPERATOR_TOOL.name).toBe('ask_operator');
    // No top-level `required` since 2026-07-27: EITHER {questions} (the real
    // shape — several questions, each with its own options) or the original
    // {question, options} is valid, so requiring one would reject the other.
    expect(ASK_OPERATOR_TOOL.inputSchema.required).toBeUndefined();
    const props = ASK_OPERATOR_TOOL.inputSchema.properties;
    expect(props.questions.type).toBe('array');
    expect(props.questions.items.required).toContain('question');
    expect(props.questions.items.properties.options.items.required).toContain('label');
    expect(props.question.type).toBe('string');
  });

  test('a parked ask raises a tray card — the operator elsewhere hears a being stands on their word', async () => {
    // The ask carries no clock, and the in-stream card cannot reach an
    // operator in another window. Read from the REAL store on real disk
    // through the real bus (fire-and-forget — poll, never await it).
    const realm = await createTempDir('ask-flow-realm');
    const prevRealm = getRealmRoot();
    setRealmRoot(realm);
    const wallet = `0x${'c4'.repeat(20)}`;
    try {
      const connection = { ...freshConnection(), walletAddress: wallet };
      wireAsks(connection);
      clientLog.length = 0;
      answer = (msg) => msg.options[0];

      const results = await processToolCalls(
        serverWs,
        askCall({ question: 'Which lane first?', options: ['doctrine', 'triggers'] }),
        connection
      );
      expect(results[0].status).toBe('ok');

      const records = await (async () => {
        for (let i = 0; i < 50; i++) {
          const { records: r } = await readNotifications(wallet);
          if (r.some((c) => c.kind === KIND.awaitingAnswer)) return r;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return (await readNotifications(wallet)).records;
      })();
      const card = records.find((c) => c.kind === KIND.awaitingAnswer);
      // Event-phrased — a card read after the answer landed never lies.
      expect(card.title).toBe('AskEcho asked for your decision');
      expect(card.detail).toBe('Which lane first?');
      expect(card.actor).toMatchObject({ id: 'askecho', name: 'AskEcho' });
    } finally {
      setRealmRoot(prevRealm);
    }
  }, 30000);

  test('ANSWERED — the witness picks an offered option and the being reads their words', async () => {
    const connection = freshConnection();
    wireAsks(connection);
    clientLog.length = 0;
    answer = (msg) => msg.options[1]; // the desk taps the second choice

    const results = await processToolCalls(
      serverWs,
      askCall({ question: 'Which base should the plan target?', options: ['qwen3.5-122b', 'gemma-4-31b'] }),
      connection
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain('Your operator answered:');
    expect(results[0].content).toContain('gemma-4-31b');
    // The desk saw the question AND its choices, then the settle echo with
    // the words that were said.
    const ask = await untilClient((m) => m.type === 'operator:ask');
    expect(ask.question).toBe('Which base should the plan target?');
    expect(ask.options).toEqual(['qwen3.5-122b', 'gemma-4-31b']);
    const resolved = await untilClient((m) => m.type === 'operator:ask_resolved');
    expect(resolved.status).toBe('answered');
    expect(resolved.answer).toBe('gemma-4-31b');
    expect(connection._pendingAsks.size).toBe(0);
  }, 30000);

  test('ANSWERED — own words still work WHEN options are offered beside them', async () => {
    // Options never replace the free line; they stand beside it. The witness
    // typed something of their own and that is exactly what the being reads.
    const connection = freshConnection();
    wireAsks(connection);
    clientLog.length = 0;
    answer = () => 'Ship the MVP first, refinement waves after.';

    const results = await processToolCalls(
      serverWs,
      askCall({ question: 'MVP first or full plan first?', options: ['MVP first', 'Full plan'] }),
      connection
    );

    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain('Ship the MVP first, refinement waves after.');
  }, 30000);

  test('a BARE question is refused and corrected — never an empty text box', async () => {
    // Design note, 2026-07-27: […] A being
    // that asks with no choices is told the shape and asks again; the operator
    // never sees the bare version, so no card rides the portal at all here.
    const connection = freshConnection();
    wireAsks(connection);
    clientLog.length = 0;

    const results = await processToolCalls(
      serverWs, askCall({ question: 'MVP first or full plan first?' }), connection,
    );

    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('Every question needs at least 2 options');
    expect(results[0].error).toContain('RECOMMENDATION first');
    // The instruction is actionable: it says an open question still has options.
    expect(results[0].error).toContain('offer your own proposal as the first one');
    expect(clientLog.some((m) => m.type === 'operator:ask')).toBe(false);
  }, 30000);

  test('one bare question among good ones fails the whole ask, naming which', () => {
    const bad = askShapeError(normalizeAsk({
      questions: [
        { question: 'Format?', options: ['Markdown', 'Slides'] },
        { question: 'What exact scope?' },
        { question: 'Team size?', options: ['2-3', '4-7'] },
      ],
    }).questions);
    expect(bad).toContain('Q2 "What exact scope?"');
    expect(bad).not.toContain('Q1');
    expect(bad).not.toContain('Q3');
  });

  test('malformed args — no question means no ask rides the portal', async () => {
    const connection = freshConnection();
    clientLog.length = 0;
    answer = () => { throw new Error('an ask fired with no question'); };

    const results = await processToolCalls(serverWs, askCall({ options: ['a'] }), connection);

    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('question');
    expect(clientLog.some((m) => m.type === 'operator:ask')).toBe(false);
  }, 30000);

  test('untrusted input: unknown ids and empty answers are dropped, real words settle', async () => {
    const connection = freshConnection();
    answer = null; // this test settles by hand, not through the desk
    const waiting = requestOperatorAnswer(connection, { question: 'Proceed?' });
    const [id] = [...connection._pendingAsks.keys()];

    expect(resolveOperatorAsk(connection, 'ghost-id', 'yes')).toBe(false);
    expect(resolveOperatorAsk(connection, id, '')).toBe(false);
    expect(resolveOperatorAsk(connection, id, '   ')).toBe(false);
    expect(connection._pendingAsks.size).toBe(1); // still pending — silence is not an answer
    expect(resolveOperatorAsk(connection, id, 'yes, proceed')).toBe(true);

    expect(await waiting).toEqual({ status: 'answered', answer: 'yes, proceed' });
    expect(connection._pendingAsks.size).toBe(0);
  });

  test('NO CLOCK — the ask waits for the witness, and a late answer still lands', async () => {
    // Design note, 2026-07-27: […] The old law
    // auto-resolved an unanswered ask after 600s; the new law is no clock —
    // answer, interrupt, or portal close are the only ways out.
    const connection = freshConnection();
    clientLog.length = 0;
    answer = null; // the witness steps away

    const waiting = requestOperatorAnswer(connection, { question: 'Anyone there?' });
    // Past the window the old tests gave the clock — nothing fires.
    await new Promise((r) => setTimeout(r, 300));
    expect(connection._pendingAsks.size).toBe(1);

    const [id] = [...connection._pendingAsks.keys()];
    expect(resolveOperatorAsk(connection, id, 'still here')).toBe(true);
    expect(await waiting).toEqual({ status: 'answered', answer: 'still here' });
    expect(connection._pendingAsks.size).toBe(0);
  });

  test('INTERRUPT through the dispatch path — the turn was cut before the witness answered', async () => {
    const connection = freshConnection();
    clientLog.length = 0;
    answer = null;
    const abort = new AbortController();
    connection.activeTurn = abort;
    const inflight = processToolCalls(
      serverWs, askCall({ question: 'Still with me?', options: ['Yes', 'No'] }), connection,
    );
    await untilClient((m) => m.type === 'operator:ask');
    abort.abort(); // the witness cut the turn instead of answering
    const results = await inflight;
    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain('interrupted');
    expect(results[0].content).not.toContain('Your operator answered');
  }, 30000);

  test('NO CLOCK through the dispatch path — the turn holds until the witness answers', async () => {
    const connection = freshConnection();
    wireAsks(connection);
    clientLog.length = 0;
    answer = null; // the witness steps away

    const inflight = processToolCalls(
      serverWs, askCall({ question: 'Deadline check?', options: ['On track', 'Slipping'] }), connection,
    );
    const ask = await untilClient((m) => m.type === 'operator:ask');
    await new Promise((r) => setTimeout(r, 300)); // past the old clock's window
    expect(connection._pendingAsks.size).toBe(1);

    // The witness comes back and answers through the desk's own frame.
    client.send(JSON.stringify({ type: 'operator:ask_response', id: ask.id, answer: 'On track' }));
    const results = await inflight;
    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain('Your operator answered');
    expect(results[0].content).toContain('On track');
    expect(connection._pendingAsks.size).toBe(0);
  }, 30000);

  test('portal close settles a pending ask as closed', async () => {
    const connection = freshConnection();
    const waiting = requestOperatorAnswer(connection, { question: 'Last thing —' });
    expirePendingAsks(connection);
    expect(await waiting).toEqual({ status: 'closed' });
    expect(connection._pendingAsks.size).toBe(0);
  });

  test('normalizeAsk — boundaries hold: caps, filtering, and the empty question', () => {
    expect(normalizeAsk(undefined)).toBeNull();
    expect(normalizeAsk({ question: '   ' })).toBeNull();
    expect(normalizeAsk({ question: 42 })).toBeNull();

    // normalizeAsk returns {questions: [...]} since 2026-07-27 — one shape for
    // the single question and the sequenced set alike.
    const clipped = normalizeAsk({ question: 'q'.repeat(ASK_QUESTION_MAX_CHARS + 50) });
    expect(clipped.questions[0].question).toHaveLength(ASK_QUESTION_MAX_CHARS);

    const asked = normalizeAsk({
      question: 'pick',
      options: ['a', '', 7, '  b  ', 'c'.repeat(ASK_OPTION_MAX_CHARS + 9), 'd', 'e', 'f', 'g', 'h'],
    });
    const labels = asked.questions[0].options.map((o) => o.label);
    expect(labels.length).toBeLessThanOrEqual(ASK_OPTIONS_MAX);
    expect(labels).toContain('b'); // trimmed
    expect(labels.every((o) => o.length <= ASK_OPTION_MAX_CHARS)).toBe(true);
    expect(labels).not.toContain(7);
  });

  test('an overlong answer is clipped at the boundary, not trusted', async () => {
    const connection = freshConnection();
    const waiting = requestOperatorAnswer(connection, { question: 'Tell me everything' });
    const [id] = [...connection._pendingAsks.keys()];
    resolveOperatorAsk(connection, id, 'x'.repeat(ASK_ANSWER_MAX_CHARS + 500));
    const outcome = await waiting;
    expect(outcome.status).toBe('answered');
    expect(outcome.answer).toHaveLength(ASK_ANSWER_MAX_CHARS);
  });
});
