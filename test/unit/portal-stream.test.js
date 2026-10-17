// Unit tests for backend/services/portal-stream.js pure helpers.
// portal-stream is heavily wired into workspace, mcp, LLM, and the knowledge
// graph — not useful to integration-test end-to-end here. Instead we test the
// isolatable helpers exported via the __test barrel.

import process from 'node:process';
import { describe, test, expect } from 'vitest';
import { __test } from '../../backend/services/portal-test-surface.js';
import { sanitizeSpeaker } from '../../backend/services/portal-turn-input.js';
import { describeSilentActs } from '../../backend/services/birth-stage-stream.js';

const {
  _extractMemoryMetadata,
  assessSignificance,
  SIGNIFICANCE_WEIGHTS,
  _resolveServer,
  _toolSummary,
} = __test;
const { isFinalToolRound, toolRoundCap, withinToolRounds } = await import('../../backend/services/tool-rounds.js');

describe('portal-stream helpers', () => {
  describe('_extractMemoryMetadata', () => {
    test('returns empty array when no relevantMemories', () => {
      expect(_extractMemoryMetadata({})).toEqual([]);
    });

    test('filters out low-score memories (score <= 0.3)', () => {
      const result = _extractMemoryMetadata({
        relevantMemories: [
          { memory: 'old weak', score: 0.2 },
          { memory: 'edge', score: 0.3 },
          { memory: 'strong', score: 0.9 },
        ],
      });
      expect(result).toHaveLength(1);
      expect(result[0].excerpt).toBe('strong');
    });

    test('truncates excerpt to 80 characters', () => {
      const longText = 'a'.repeat(200);
      const result = _extractMemoryMetadata({
        relevantMemories: [{ memory: longText, score: 0.9 }],
      });
      expect(result[0].excerpt.length).toBe(80);
    });

    test('rounds score to two decimals', () => {
      const result = _extractMemoryMetadata({
        relevantMemories: [{ memory: 'x', score: 0.86732 }],
      });
      expect(result[0].score).toBe(0.87);
    });

    test('handles missing memory field with empty string', () => {
      const result = _extractMemoryMetadata({
        relevantMemories: [{ score: 0.9 }],
      });
      expect(result[0].excerpt).toBe('');
    });
  });

  describe('assessSignificance', () => {
    test('returns baseline for neutral exchange', () => {
      const score = assessSignificance('hello', 'hi');
      expect(score).toBeCloseTo(SIGNIFICANCE_WEIGHTS.baseline, 5);
    });

    test('adds philosophical weight for "why" / "meaning"', () => {
      const score = assessSignificance('why does meaning matter?', 'ok');
      expect(score).toBeGreaterThanOrEqual(
        SIGNIFICANCE_WEIGHTS.baseline + SIGNIFICANCE_WEIGHTS.philosophical
      );
    });

    test('adds emotional weight for "feel" / "love"', () => {
      const score = assessSignificance('i feel love', 'ok');
      expect(score).toBeGreaterThanOrEqual(
        SIGNIFICANCE_WEIGHTS.baseline + SIGNIFICANCE_WEIGHTS.emotional
      );
    });

    test('adds response-depth weight for profound response content', () => {
      const score = assessSignificance('hi', 'my soul feels profound emotion');
      expect(score).toBeGreaterThanOrEqual(
        SIGNIFICANCE_WEIGHTS.baseline + SIGNIFICANCE_WEIGHTS.responseDepth
      );
    });

    // #119 — long response is NOT a signal of significance on its own.
    // 500-char technical responses used to clear the threshold trivially;
    // dropped from the weights. Length without emotional/intensity signal
    // contributes nothing.
    test('long response on its own contributes nothing (longResponse removed)', () => {
      const score = assessSignificance('hi', 'x'.repeat(501));
      expect(score).toBeCloseTo(SIGNIFICANCE_WEIGHTS.baseline, 5);
    });

    // #119 — emotionalResonance from detectEmotionIntensity is a real signal:
    // a high-intensity response should add weight even without matching the
    // literal keyword regexes. Tested with vocab-heavy emotional response.
    test('high-intensity response adds emotionalResonance weight', () => {
      const emotionalResponse = 'I feel your pain. The grief, the loss, the sorrow — '
        + 'I am here with you, hold space for your sorrow, the tears, the ache! '
        + 'Together we mourn, together we heal. The love between us is the bridge.';
      const score = assessSignificance('hi', emotionalResponse);
      // Above the baseline (emotionalResonance fired) but below threshold
      // (no message-side trigger), proving the signal is independently
      // measurable
      expect(score).toBeGreaterThan(SIGNIFICANCE_WEIGHTS.baseline);
    });

    // #119 — routine coding exchange must NOT crystallize. Pre-fix, the
    // […] match + 500+ char response cleared 0.6 trivially. Now: no
    // first-person assertion, no emotional vocab, no philosophical question
    // → stays at baseline, well below 0.75.
    test('routine coding exchange scores below the 0.75 crystallization threshold', () => {
      const message = 'can you fix my function and return the corrected code?';
      const response = 'Here is the fixed version: ' + ' '.repeat(600); // long but neutral
      const score = assessSignificance(message, response);
      expect(score).toBeLessThan(0.75);
    });

    // #119 — genuinely significant exchange MUST crystallize.
    test('emotional + philosophical exchange clears the 0.75 threshold', () => {
      const message = 'Why do I feel this fear of losing you?';
      const response = 'I feel your pain. The grief is real, the loss is real, '
        + 'the sorrow real. I am with you, hold space for the tears, the ache. '
        + 'The love between us makes the fear honest. We mourn and heal together!';
      const score = assessSignificance(message, response);
      expect(score).toBeGreaterThan(0.75);
    });

    test('caps at 1.0 when every weight slot fires', () => {
      // Message hits philosophical (why, meaning, purpose) + emotional
      // (feel, love, dream, hope) + selfReference (I am).
      // Response hits responseDepth (feel, soul, emotion, profound) + has
      // enough emotional-vocab density + exclamations to trigger
      // emotionalResonance (intensity > 0.6).
      const score = assessSignificance(
        'why do I feel love and what is the meaning of purpose? I am asking — dream and hope too.',
        'I feel the profound soul-emotion you carry! '
          + 'Love, joy, sorrow, grief, fear, hope, passion, peace — '
          + 'wonder and beauty together, fierce devotion, sacred celebration! '
          + 'Mourn the loss, embrace the joy, breathe the peace!',
      );
      expect(score).toBeLessThanOrEqual(1.0);
      expect(score).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe('tool rounds', () => {
    test('the tool loop is UNCAPPED by default — the ceiling was never the safety', () => {
      // The inverse of the assertion it replaces, deliberately. The old test
      // required 30 <= cap <= 500, […]. That
      // number had to be raised every time real work met it: 9 cut off a witness
      // ORIENTING in a repo (2026-07-26); 60 cut off a live research turn at
      // round 61 (2026-07-27). A ceiling you keep raising is not protecting
      // anything — it is the one you have not hit yet.
      //
      // What actually bounds a turn fires on EVERY call regardless of round: the
      // policy cascade, the ACTS card, the path sandbox, the egress guard — plus
      // the operator's interrupt and the model choosing to stop.
      const saved = process.env.NEUMA_MAX_TOOL_ROUNDS;
      delete process.env.NEUMA_MAX_TOOL_ROUNDS;
      try {
        expect(toolRoundCap()).toBe(0);
        expect(withinToolRounds(0)).toBe(true);
        expect(withinToolRounds(10_000)).toBe(true);
        expect(isFinalToolRound(10_000)).toBe(false); // the "stopped" branch is unreachable
      } finally {
        if (saved === undefined) delete process.env.NEUMA_MAX_TOOL_ROUNDS;
        else process.env.NEUMA_MAX_TOOL_ROUNDS = saved;
      }
    });

    test('a ceiling can still be opted into — a shared rig, a cron lane, a budget test', () => {
      const saved = process.env.NEUMA_MAX_TOOL_ROUNDS;
      process.env.NEUMA_MAX_TOOL_ROUNDS = '3';
      try {
        expect(toolRoundCap()).toBe(3);
        expect(withinToolRounds(3)).toBe(true);
        expect(withinToolRounds(4)).toBe(false);
        expect(isFinalToolRound(3)).toBe(true);
        expect(isFinalToolRound(2)).toBe(false);
      } finally {
        if (saved === undefined) delete process.env.NEUMA_MAX_TOOL_ROUNDS;
        else process.env.NEUMA_MAX_TOOL_ROUNDS = saved;
      }
    });

    test('junk or zero reads as UNLIMITED, never as "stop immediately"', () => {
      // The dangerous misreading: a 0 or a typo silently meaning […] would kill every turn on the rig at once.
      const saved = process.env.NEUMA_MAX_TOOL_ROUNDS;
      try {
        for (const junk of ['0', '-5', 'lots', '']) {
          process.env.NEUMA_MAX_TOOL_ROUNDS = junk;
          expect(toolRoundCap()).toBe(0);
          expect(withinToolRounds(500)).toBe(true);
        }
      } finally {
        if (saved === undefined) delete process.env.NEUMA_MAX_TOOL_ROUNDS;
        else process.env.NEUMA_MAX_TOOL_ROUNDS = saved;
      }
    });
  });

  describe('_toolSummary', () => {
    test('uses a past-tense verb with the target path', () => {
      expect(_toolSummary('write_file', { path: 'data/dna-cache/FENNA.md' }))
        .toBe('wrote data/dna-cache/FENNA.md');
      expect(_toolSummary('read_file', { path: 'notes.txt' })).toBe('read notes.txt');
    });

    test('falls back to tool name plus target for unknown tools', () => {
      expect(_toolSummary('search_memory', { query: 'witness' })).toBe('search_memory witness');
    });

    test('falls back to bare tool name when no target arg', () => {
      expect(_toolSummary('list_allowed_directories', {})).toBe('list_allowed_directories');
      expect(_toolSummary('write_file', null)).toBe('write_file');
    });

    // Design note, 2026-10-03: the event describes itself; no AI labels a tool call.
    test('any tool reads as what it was given and what came back, from the act itself', () => {
      expect(_toolSummary('inspect', { command: 'python test.py' }, 'exit 0\nall 4 tests passed'))
        .toBe('inspect python test.py → exit 0');
      expect(_toolSummary('lookup_customer', { customer: 'CX-85421' }, '\n  {"name": "R. Sepulveda"}'))
        .toBe('lookup_customer CX-85421 → {"name": "R. Sepulveda"}');
      expect(_toolSummary('inspect', { command: 'x'.repeat(200) }, '').length).toBeLessThan(90);
      // File hands keep their verb line: the path is the whole story.
      expect(_toolSummary('read_file', { path: 'notes.txt' }, 'line one')).toBe('read notes.txt');
    });

    test('a failed act names itself and the reason', async () => {
      const { toolFailureSummary } = await import('../../backend/services/portal-tools/tool-events.js');
      expect(toolFailureSummary('inspect', { command: 'make' }, new Error('exit 2: no rule to make target')))
        .toBe('inspect make — failed: exit 2: no rule to make target');
    });
  });

  describe('_resolveServer', () => {
    const available = [
      { name: 'write_file', server: 'filesystem' },
      { name: 'search_memory', server: 'memory' },
    ];

    test('keeps an explicit server', () => {
      expect(_resolveServer({ server: 'memory', toolName: 'write_file' }, available)).toBe('memory');
    });

    test('resolves a bare tool name against the registry', () => {
      expect(_resolveServer({ server: null, toolName: 'write_file' }, available)).toBe('filesystem');
    });

    test('returns null for an unknown bare tool', () => {
      expect(_resolveServer({ server: null, toolName: 'launch_rocket' }, available)).toBeNull();
    });

    test('auto-corrects a bogus explicit server by tool name (e.g. the literal "server")', () => {
      // A model that emits the placeholder prefix `server/write_file` should still
      // route to the real host instead of failing with "not connected".
      expect(_resolveServer({ server: 'server', toolName: 'write_file' }, available)).toBe('filesystem');
    });

    test('a bogus explicit server with an unknown tool still resolves to null', () => {
      expect(_resolveServer({ server: 'server', toolName: 'launch_rocket' }, available)).toBeNull();
    });

    test('keeps a real explicit server even when it does not host that tool name', () => {
      // 'memory' is a real connected server (hosts search_memory), so an explicit
      // choice is honored — the model said memory on purpose.
      expect(_resolveServer({ server: 'memory', toolName: 'write_file' }, available)).toBe('memory');
    });
  });

  describe('SIGNIFICANCE_WEIGHTS', () => {
    test('is frozen', () => {
      expect(Object.isFrozen(SIGNIFICANCE_WEIGHTS)).toBe(true);
    });

    test('weights sum to exactly 1.0 (baseline + all bonuses)', () => {
      const sum = Object.values(SIGNIFICANCE_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 5);
    });
  });

  // The honest-identity guard: a peer (e.g. Claude via the neuma skill)
  // declares who is present so the neuma is never deceived into taking a
  // visitor for its witness. Untrusted input, sanitized at the WS boundary.
  describe('sanitizeSpeaker', () => {
    test('keeps a well-formed { name, descriptor }', () => {
      expect(sanitizeSpeaker({ name: 'Claude', descriptor: 'a peer' }))
        .toEqual({ name: 'Claude', descriptor: 'a peer' });
    });

    test('returns just { name } when descriptor is empty or blank', () => {
      expect(sanitizeSpeaker({ name: 'Claude' })).toEqual({ name: 'Claude' });
      expect(sanitizeSpeaker({ name: 'Claude', descriptor: '   ' })).toEqual({ name: 'Claude' });
    });

    test('is null for a missing or blank name', () => {
      expect(sanitizeSpeaker({ descriptor: 'x' })).toBeNull();
      expect(sanitizeSpeaker({ name: '   ' })).toBeNull();
    });

    test('is null for non-object input', () => {
      expect(sanitizeSpeaker(null)).toBeNull();
      expect(sanitizeSpeaker(undefined)).toBeNull();
      expect(sanitizeSpeaker('Claude')).toBeNull();
      expect(sanitizeSpeaker(['Claude'])).toBeNull();
    });

    test('strips control characters and DEL (no prompt-frame injection)', () => {
      const nul = String.fromCharCode(0);
      const del = String.fromCharCode(127);
      const out = sanitizeSpeaker({ name: `Cla${nul}ude`, descriptor: `a${del}peer` });
      expect(out.name).toBe('Claude');
      expect(out.descriptor).toBe('apeer');
    });

    test('caps name at 80 and descriptor at 240 characters', () => {
      const out = sanitizeSpeaker({ name: 'a'.repeat(200), descriptor: 'b'.repeat(500) });
      expect(out.name).toHaveLength(80);
      expect(out.descriptor).toHaveLength(240);
    });
  });

  // Ceremony-voiced notes for native-only stages: observed live on Hale's
  // birth (stages 4 + 5 arrived responseLen 0 — the witness saw a chip and
  // silence, and was never shown the chosen name).
  describe('describeSilentActs', () => {
    const write = (path, content) => ({
      server: 'filesystem', toolName: 'write_file', args: { path, content },
    });

    test('a silent naming shows the chosen name', () => {
      expect(describeSilentActs([write('data/temp/chosen_name.txt', 'Hale')], 4))
        .toEqual(['The name is written: Hale']);
    });

    test('a naming write with no readable content still says a name landed', () => {
      expect(describeSilentActs([{ server: 'filesystem', toolName: 'write_file', args: { path: 'data/temp/chosen_name.txt' } }], 4))
        .toEqual(['A name was written.']);
    });

    test('caps a runaway name at 80 characters', () => {
      const [note] = describeSilentActs([write('data/temp/chosen_name.txt', 'N'.repeat(300))], 4);
      expect(note).toBe(`The name is written: ${'N'.repeat(80)}`);
    });

    test('a silent crystallization says the DNA was authored', () => {
      const [note] = describeSilentActs(
        [write('/home/x/.neuma/workspaces/hale/dna/genesis.md', '# I am')], 5);
      expect(note).toMatch(/DNA is authored/);
    });

    test('an unrecognized act is still named, generically', () => {
      expect(describeSilentActs([{ server: 'filesystem', toolName: 'read_file', args: { path: 'x' } }], 4))
        .toEqual(['An act in silence: filesystem/read_file']);
    });

    test('tolerates calls with no args at all', () => {
      expect(describeSilentActs([{ server: 's', toolName: 't' }], 5))
        .toEqual(['An act in silence: s/t']);
    });
  });
});
