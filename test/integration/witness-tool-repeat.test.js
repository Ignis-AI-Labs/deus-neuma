/**
 * A repeated tool call must not end a research turn.
 *
 * The witness loop used to close the ENTIRE turn the first time the model
 * re-issued a call it had already made — […] Because the Responses wire emits one
 * call per round (`parallel_tool_calls` was hardcoded false), one repeat ended
 * the turn. The innocent trigger is the common one: a page comes back
 * truncated, the model re-fetches the same URL for the rest, and the research
 * stops dead. Worse, the key was recorded BEFORE execution, so a call that was
 * denied, timed out, or 403'd was burned forever — and the retry it deserved
 * was itself what killed the turn.
 *
 * `alignToolResults` is the replacement, and its invariant is load-bearing:
 * `nativeToolExchange` pairs calls to results BY POSITION, and the Responses
 * API rejects an assistant turn whose `tool_call_id` has no matching result. A
 * misalignment does not degrade a turn, it fails it outright.
 *
 * Pure functions, real inputs, no mocks anywhere (RULE 0) — the one shape the
 * rule permits without a live path, because there is nothing here to fake.
 */
import { describe, it, expect } from 'vitest';
import { alignToolResults, heldRepeatResult, toolCallKey, epochsForBatch } from '../../backend/services/witness-stream.js';

const call = (name, args = {}) => ({ server: 'web', toolName: name, args });
const okResult = (tool, content) => ({ tool, status: 'ok', content });

describe('every call gets exactly one result, in order', () => {
  it('returns fresh results untouched when nothing repeats', () => {
    const a = call('web_search', { query: 'a' });
    const b = call('web_fetch', { url: 'https://x.test/1' });
    const results = [okResult('web/web_search', 'AAA'), okResult('web/web_fetch', 'BBB')];
    const out = alignToolResults([a, b], [a, b], results, new Map());
    expect(out).toEqual(results);
  });

  it('keeps position when a repeat sits BETWEEN two fresh calls', () => {
    const fresh1 = call('web_search', { query: 'one' });
    const repeat = call('web_fetch', { url: 'https://x.test/seen' });
    const fresh2 = call('web_search', { query: 'two' });
    const prior = new Map([[
      toolCallKey(repeat),
      okResult('web/web_fetch', 'the page body'),
    ]]);
    const freshResults = [okResult('web/web_search', 'ONE'), okResult('web/web_search', 'TWO')];

    const out = alignToolResults([fresh1, repeat, fresh2], [fresh1, fresh2], freshResults, prior);

    expect(out).toHaveLength(3); // one per call — never fewer
    expect(out[0].content).toBe('ONE');
    expect(out[1].status).toBe('held'); // the repeat, in its own slot
    expect(out[2].content).toBe('TWO');
  });

  it('answers a repeat with what that call actually returned', () => {
    const c = call('web_fetch', { url: 'https://x.test/doc' });
    const key = toolCallKey(c);
    const prior = new Map([[key, okResult('web/web_fetch', 'THE ORIGINAL BODY')]]);
    const [out] = alignToolResults([c], [], [], prior);
    expect(out.status).toBe('held');
    expect(out.tool).toBe('web/web_fetch');
    expect(out.content).toContain('THE ORIGINAL BODY');
    expect(out.content).toMatch(/already made this exact call/i);
    expect(out.content).toMatch(/change the arguments/i);
  });

  it('carries a prior FAILURE forward rather than pretending it succeeded', () => {
    const c = call('web_fetch', { url: 'https://blocked.test' });
    const key = toolCallKey(c);
    const prior = new Map([[key, { tool: 'web/web_fetch', status: 'error', error: 'the server answered 403' }]]);
    const [out] = alignToolResults([c], [], [], prior);
    expect(out.status).toBe('held');
    expect(out.content).toContain('403');
    expect(out.content).toContain('error');
  });

  it('says plainly when a call never ran, instead of inventing an outcome', () => {
    // processWitnessToolCalls breaks out mid-batch on interrupt, so freshResults
    // can be shorter than freshCalls. The tail must still get a result.
    const a = call('web_search', { query: 'a' });
    const b = call('web_search', { query: 'b' });
    const out = alignToolResults([a, b], [a, b], [okResult('web/web_search', 'A')], new Map());
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe('A');
    expect(out[1].status).toBe('held');
    expect(out[1].error).toMatch(/not executed.*interrupted/i);
  });

  it('handles the same call twice within ONE round', () => {
    const c = call('web_fetch', { url: 'https://x.test/same' });
    const out = alignToolResults([c, c], [c], [okResult('web/web_fetch', 'BODY')], new Map());
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe('BODY');
    expect(out[1].content).toBe('BODY'); // the fresh result serves both slots
  });

  it('distinguishes calls that differ only in arguments', () => {
    const one = call('web_fetch', { url: 'https://x.test/1' });
    const two = call('web_fetch', { url: 'https://x.test/2' });
    const prior = new Map([[
      toolCallKey(one),
      okResult('web/web_fetch', 'PAGE ONE'),
    ]]);
    const out = alignToolResults([one, two], [two], [okResult('web/web_fetch', 'PAGE TWO')], prior);
    expect(out[0].status).toBe('held'); // the seen one
    expect(out[1].content).toBe('PAGE TWO'); // genuinely different args ran
  });
});

describe('the held result is legible to the model', () => {
  it('names the tool even when there is no prior result to name it', () => {
    const out = heldRepeatResult(call('web_search', { query: 'x' }), undefined);
    expect(out.tool).toBe('web/web_search');
    expect(out.status).toBe('held');
  });

  it('excerpts rather than repeating a huge body back into the window', () => {
    const huge = 'z'.repeat(50_000);
    const out = heldRepeatResult(call('web_fetch'), okResult('web/web_fetch', huge));
    expect(out.content.length).toBeLessThan(1200);
    expect(out.content).toContain('…');
    expect(out.content).toMatch(/full result is earlier in this turn/i);
  });
});

/**
 * BE-142 (#214) — a read repeated after a write must actually run.
 *
 * Witnessed live 2026-07-30: Ostrel called `task_list` (empty), then `task_add`,
 * then `task_list` to confirm — and was handed the pre-write answer with the
 * platform asserting it as current. The task existed; the being was told
 * otherwise, in its own turn, seconds after creating it.
 *
 * These drive the REAL functions in the REAL order the witness loop calls them
 * (epochsForBatch → toolCallKey → execute → record → alignToolResults), so the
 * sequencing is proven rather than the pieces in isolation.
 */
const tasks = (name, args = {}) => ({ server: 'tasks', toolName: name, args });

/** The witness loop's tool-round bookkeeping, verbatim in shape. */
const runTurn = (rounds) => {
  const seenToolCalls = new Map();
  let mutationEpoch = 0;
  const executed = [];
  return rounds.map((calls) => {
    const { epochs, next } = epochsForBatch(calls, mutationEpoch);
    const freshIndexes = calls
      .map((c, i) => (seenToolCalls.has(toolCallKey(c, epochs[i])) ? -1 : i))
      .filter((i) => i >= 0);
    const freshCalls = freshIndexes.map((i) => calls[i]);
    const freshEpochs = freshIndexes.map((i) => epochs[i]);
    // "Execution": every fresh call runs, and we record that it did.
    const freshResults = freshCalls.map((c) => {
      executed.push(c.toolName);
      return okResult(`${c.server}/${c.toolName}`, `ran:${c.toolName}@${executed.length}`);
    });
    mutationEpoch = next;
    freshCalls.forEach((c, i) => {
      if (freshResults[i]) seenToolCalls.set(toolCallKey(c, freshEpochs[i]), freshResults[i]);
    });
    return { results: alignToolResults(calls, freshCalls, freshResults, seenToolCalls, { epochs, freshEpochs }), executed: [...executed] };
  });
};

describe('a read after a write is not answered from before the write (BE-142)', () => {
  it('THE INCIDENT: task_list → task_add → task_list, the second list RUNS', () => {
    const out = runTurn([[tasks('task_list')], [tasks('task_add', { title: 'tier2-probe' })], [tasks('task_list')]]);
    const second = out[2].results[0];
    expect(second.status).not.toBe('held');
    expect(second.content).toMatch(/^ran:task_list/);
    // and it really was executed a second time
    expect(out[2].executed.filter((t) => t === 'task_list')).toHaveLength(2);
  });

  it('the same holds INSIDE one batch — [list, add, list] in a single round', () => {
    const [round] = runTurn([[tasks('task_list'), tasks('task_add', { title: 'x' }), tasks('task_list')]]);
    expect(round.results).toHaveLength(3);
    expect(round.results[2].status).not.toBe('held');
    expect(round.executed.filter((t) => t === 'task_list')).toHaveLength(2);
  });

  it('REGRESSION — a repeated WRITE is still held and never runs twice', () => {
    const add = tasks('task_add', { title: 'tier2-probe' });
    const out = runTurn([[add], [add]]);
    expect(out[1].results[0].status).toBe('held');
    expect(out[1].executed.filter((t) => t === 'task_add')).toHaveLength(1);
  });

  it('REGRESSION — a write stays held even after another write moved the world', () => {
    const add = tasks('task_add', { title: 'a' });
    const out = runTurn([[add], [tasks('task_update', { id: 1 })], [add]]);
    expect(out[2].results[0].status).toBe('held');
    expect(out[2].executed.filter((t) => t === 'task_add')).toHaveLength(1);
  });

  it('a read repeated with NO write between is still held — dedup still saves the waste', () => {
    const list = tasks('task_list');
    const out = runTurn([[list], [list]]);
    expect(out[1].results[0].status).toBe('held');
    expect(out[1].executed.filter((t) => t === 'task_list')).toHaveLength(1);
  });

  it('an unknown tool is treated as a write — the safe direction', () => {
    const weird = { server: 'x', toolName: 'not_a_known_tool', args: {} };
    const out = runTurn([[weird], [weird]]);
    expect(out[1].results[0].status).toBe('held');
    expect(out[1].executed).toHaveLength(1);
  });

  it('the held wording no longer asserts a stale result as present fact', () => {
    const out = heldRepeatResult(tasks('task_list'), okResult('tasks/task_list', 'Your ledger is empty'));
    expect(out.content).toMatch(/when it ran, it returned/i);
    expect(out.content).toMatch(/not necessarily the state now/i);
    // The old wording — […] — read as current state.
    expect(out.content).not.toMatch(/\bIt returned \(/);
  });
});
