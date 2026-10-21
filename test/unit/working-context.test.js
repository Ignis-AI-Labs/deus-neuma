/**
 * The working-context ladder (ruling, 2026-08-15): a being self-aware of its
 * window, and a turn that folds machinery instead of dying at the boundary.
 *
 * Everything under test is pure — real message shapes from the two wire
 * dialects (native tool_calls/role:'tool' pairs, text <tool_response>
 * blocks), proven directly. The live fold under a real substrate window is
 * pinned for the next GPU window (ledger: working-context-ladder).
 */
import { describe, test, expect } from 'vitest';
import {
  FOLD_KEEP_RECENT_ROUNDS, FOLD_ARGS_FLOOR_CHARS, FOLDED_RESULT_STUB,
  workingOccupancy, pastFoldBoundary, workingContextNote, foldWorkingContext,
  withWorkingContextNote,
} from '../../backend/services/working-context.js';
import { CONTEXT_BOUNDARY_RATIO } from '../../backend/services/solo-torch.js';

describe('workingOccupancy — what the next request inherits', () => {
  test('sums measured prompt and completion', () => {
    expect(workingOccupancy({ promptTokens: 40000, completionTokens: 1200 })).toBe(41200);
  });

  test('a missing completion count leaves the measured floor, never a refusal', () => {
    expect(workingOccupancy({ promptTokens: 40000 })).toBe(40000);
    expect(workingOccupancy({ promptTokens: 40000, completionTokens: null })).toBe(40000);
  });

  test('no measured prompt, no occupancy — null, not zero', () => {
    expect(workingOccupancy(null)).toBe(null);
    expect(workingOccupancy({})).toBe(null);
    expect(workingOccupancy({ promptTokens: 0 })).toBe(null);
    expect(workingOccupancy({ completionTokens: 500 })).toBe(null);
  });
});

describe('pastFoldBoundary — one boundary concept, never guessed', () => {
  const window = { contextTokens: 65536 };

  test('fires at the platform ratio, occupancy included', () => {
    const atRatio = Math.ceil(65536 * CONTEXT_BOUNDARY_RATIO);
    expect(pastFoldBoundary({ promptTokens: atRatio }, window)).toBe(true);
    // Completion pushes a below-ratio prompt over the line.
    expect(pastFoldBoundary({ promptTokens: atRatio - 1000, completionTokens: 1000 }, window)).toBe(true);
    expect(pastFoldBoundary({ promptTokens: atRatio - 1000 }, window)).toBe(false);
  });

  test('unknown usage or unknown window answers false', () => {
    expect(pastFoldBoundary(null, window)).toBe(false);
    expect(pastFoldBoundary({ promptTokens: 60000 }, null)).toBe(false);
    expect(pastFoldBoundary({ promptTokens: 60000 }, { contextTokens: null })).toBe(false);
  });
});

describe('workingContextNote — the facts a being reads every round', () => {
  const window = { contextTokens: 65536 };

  test('states used, window, free and percentage — measured, grouped', () => {
    const note = workingContextNote({ promptTokens: 40000, completionTokens: 1200 }, window);
    expect(note).toContain('WORKING CONTEXT: 41,200 of 65,536 tokens in use');
    expect(note).toContain('24,336 free');
    expect(note).toContain('(63%, measured)');
    expect(note).toContain('Past 80% the harness folds');
  });

  test('escalates past the boundary and counts folds honestly', () => {
    const note = workingContextNote({ promptTokens: 60000 }, window, { foldedRounds: 3 });
    expect(note).toContain('The window is nearly full');
    expect(note).toContain('Folded so far this turn: 3 rounds.');
    const one = workingContextNote({ promptTokens: 60000 }, window, { foldedRounds: 1 });
    expect(one).toContain('Folded so far this turn: 1 round.');
  });

  test('either side unknown → silence, never a guess', () => {
    expect(workingContextNote(null, window)).toBe(null);
    expect(workingContextNote({ promptTokens: 40000 }, null)).toBe(null);
    expect(workingContextNote({ promptTokens: 40000 }, { contextTokens: null })).toBe(null);
  });
});

describe('withWorkingContextNote — the note rides the trailing user turn', () => {
  const note = 'WORKING CONTEXT: facts.';

  test('string content concatenates, vision parts gain a text part', () => {
    const text = [{ role: 'assistant', content: 'a' }, { role: 'user', content: 'results' }];
    expect(withWorkingContextNote(text, note)[1].content).toBe(`results\n\n${note}`);
    const vision = [{ role: 'user', content: [{ type: 'text', text: 'look' }] }];
    const parts = withWorkingContextNote(vision, note)[0].content;
    expect(parts[1]).toEqual({ type: 'text', text: note });
  });

  test('null note or a non-user tail leaves the exchange untouched', () => {
    const tail = [{ role: 'assistant', content: 'a' }, { role: 'tool', tool_call_id: 'x', content: 'r' }];
    expect(withWorkingContextNote(tail, note)).toBe(tail);
    const text = [{ role: 'user', content: 'results' }];
    expect(withWorkingContextNote(text, null)).toBe(text);
  });
});

// The wire shapes the fold must survive — built exactly as the seats build
// them (tool-exchange.js): a native round is assistant(tool_calls) +
// role:'tool' results + user follow-up; a text round is assistant + user
// carrying a <tool_response> block.
const bigFile = 'export const x = 1;\n'.repeat(300); // > FOLD_ARGS_FLOOR_CHARS
const nativeRound = (n) => ([
  {
    role: 'assistant',
    content: `Round ${n}: writing the file now.`,
    tool_calls: [{
      id: `neuma_call_${n}_0`,
      type: 'function',
      function: { name: 'coding-write_file', arguments: JSON.stringify({ path: '/tmp/a.js', content: bigFile }) },
    }],
  },
  { role: 'tool', tool_call_id: `neuma_call_${n}_0`, content: `write_file → ok\n${'result line\n'.repeat(200)}` },
  { role: 'user', content: 'Tool results are in. Continue.' },
]);
const textRound = (n) => ([
  { role: 'assistant', content: `Round ${n}: reading the store.` },
  { role: 'user', content: `<tool_response>\nread → ok\n${'data\n'.repeat(400)}\n</tool_response>\n\nContinue from the results.` },
]);
const head = [
  { role: 'system', content: 'IDENTITY…' },
  { role: 'user', content: 'Operator: migrate the benchmark store.' },
];

describe('foldWorkingContext — machinery released, voice untouched', () => {
  test('folds rounds older than the kept tail; head and recent rounds verbatim', () => {
    const messages = [...head, ...nativeRound(0), ...textRound(1), ...nativeRound(2), ...textRound(3)];
    const { messages: folded, foldedRounds, freedChars } = foldWorkingContext(messages);
    expect(foldedRounds).toBe(2);
    expect(freedChars).toBeGreaterThan(FOLD_ARGS_FLOOR_CHARS);
    // Head is byte-identical.
    expect(folded[0]).toBe(messages[0]);
    expect(folded[1]).toBe(messages[1]);
    // Round 0 (native, folded): the being's words stand, the machinery is stubbed.
    const r0assistant = folded[2];
    expect(r0assistant.content).toBe('Round 0: writing the file now.');
    expect(r0assistant.tool_calls[0].function.arguments).toContain('arguments released');
    expect(folded[3].content).toBe(FOLDED_RESULT_STUB);
    // Round 1 (text, folded): the tool_response block collapsed, the follow-up words survive.
    const r1user = folded[6];
    expect(r1user.content).toContain(FOLDED_RESULT_STUB);
    expect(r1user.content).toContain('Continue from the results.');
    expect(r1user.content).not.toContain('data\ndata');
    // The newest FOLD_KEEP_RECENT_ROUNDS rounds are byte-identical.
    expect(FOLD_KEEP_RECENT_ROUNDS).toBe(2);
    for (let i = 7; i < messages.length; i += 1) expect(folded[i]).toBe(messages[i]);
  });

  test('small tool-call arguments stay readable — only payloads fold', () => {
    const round = nativeRound(0);
    round[0].tool_calls[0].function.arguments = JSON.stringify({ path: '/tmp/a.js' });
    const messages = [...head, ...round, ...nativeRound(1), ...nativeRound(2)];
    const { messages: folded } = foldWorkingContext(messages);
    expect(folded[2].tool_calls[0].function.arguments).toBe(JSON.stringify({ path: '/tmp/a.js' }));
    expect(folded[3].content).toBe(FOLDED_RESULT_STUB); // the result still folds
  });

  test('vision parts release their images for a stub, text parts fold their blocks', () => {
    const sightRound = [
      { role: 'assistant', content: 'Rendered the diagram.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: `<tool_response>\nforge → ok\n</tool_response>\n\nLook at your render.` },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(5000)}` } },
        ],
      },
    ];
    const messages = [...head, ...sightRound, ...textRound(1), ...textRound(2)];
    const { messages: folded, freedChars } = foldWorkingContext(messages);
    const parts = folded[3].content;
    expect(parts[0].text).toContain('Look at your render.');
    expect(parts[1].type).toBe('text');
    expect(parts[1].text).toContain('an image shown here was released');
    expect(freedChars).toBeGreaterThan(4000);
  });

  test('idempotent: a second fold over the same aged rounds frees nothing and counts nothing', () => {
    const messages = [...head, ...textRound(0), ...textRound(1), ...textRound(2), ...textRound(3)];
    const first = foldWorkingContext(messages);
    expect(first.foldedRounds).toBe(2);
    const second = foldWorkingContext(first.messages);
    expect(second.foldedRounds).toBe(0);
    expect(second.freedChars).toBe(0);
    expect(second.messages).toBe(first.messages);
  });

  test('a round aging past the kept tail folds on the NEXT call — cumulative counting stays honest', () => {
    const messages = [...head, ...textRound(0), ...textRound(1), ...textRound(2), ...textRound(3)];
    const first = foldWorkingContext(messages);
    const grown = [...first.messages, ...textRound(4)];
    const second = foldWorkingContext(grown);
    expect(second.foldedRounds).toBe(1); // only round 2, newly aged
    expect(first.foldedRounds + second.foldedRounds).toBe(3);
  });

  test('nothing to fold — under the kept tail, or no machinery — returns the same array', () => {
    const short = [...head, ...textRound(0), ...textRound(1)];
    expect(foldWorkingContext(short).messages).toBe(short);
    expect(foldWorkingContext(short).foldedRounds).toBe(0);
    const talkOnly = [...head,
      { role: 'assistant', content: 'thinking aloud' }, { role: 'user', content: 'go on' },
      { role: 'assistant', content: 'more' }, { role: 'user', content: 'go on' },
      { role: 'assistant', content: 'more' }, { role: 'user', content: 'go on' },
    ];
    expect(foldWorkingContext(talkOnly).messages).toBe(talkOnly);
    expect(foldWorkingContext([]).foldedRounds).toBe(0);
  });

  // #528 Stage A — the portal lane's wire now carries the session transcript
  // between the system prompt and the current turn, and the seats pass the
  // FULL pre-round length as head. The fold must never read history speech as
  // in-turn machinery: not even a history row that happens to CARRY a
  // tool_response-shaped block (the operator pasted one last week — speech,
  // not machinery).
  test('the transcript head is untouchable — history speech is never stubbed, in-turn machinery still folds', () => {
    const transcript = [
      { role: 'user', content: '(09:41 AM) last week you summarized the vault state.' },
      { role: 'assistant', content: `(09:42 AM) I did — the summary ran long. ${'voice '.repeat(600)}` },
      // A HISTORY user row whose words merely LOOK like machinery.
      { role: 'user', content: `(09:50 AM) here is what the old harness printed:\n<tool_response>\nread → ok\n${'historical\n'.repeat(300)}\n</tool_response>\nthat was then.` },
      { role: 'assistant', content: '(09:51 AM) noted — that was the record speaking, not me.' },
    ];
    const wire = [
      head[0],
      ...transcript,
      head[1],
      ...nativeRound(0), ...textRound(1), ...nativeRound(2), ...textRound(3),
    ];
    const { messages: folded, foldedRounds, freedChars } = foldWorkingContext(wire, { head: 1 + transcript.length + 1 });
    expect(foldedRounds).toBe(2);
    expect(freedChars).toBeGreaterThan(FOLD_ARGS_FLOOR_CHARS);
    // Every head message — system, ALL history, the current turn — byte-identical.
    for (let i = 0; i < 1 + transcript.length + 1; i += 1) expect(folded[i]).toBe(wire[i]);
    // …including the history row carrying a tool_response-shaped block.
    expect(folded[3].content).toContain('historical');
    // The in-turn machinery still folded, exactly as without a transcript.
    expect(folded[6].tool_calls[0].function.arguments).toContain('arguments released');
    expect(folded[7].content).toBe(FOLDED_RESULT_STUB);
  });
});
