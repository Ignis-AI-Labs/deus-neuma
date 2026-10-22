// The composer's line for a /compact answer — every number is the portal's own.
import { describe, expect, test } from 'vitest';
import { compactNote } from '../../frontend/app/RelinkShell/compact-note.js';
import { resolveCommand, PLATFORM_COMMANDS } from '../../frontend/app/RelinkShell/commands.js';

describe('compact-note', () => {
  test('running, done in the being\'s own words, done extractively', () => {
    expect(compactNote({ state: 'running' }, 'Keir')).toBe('COMPACTING — BASUNORR IS SUMMING UP THE CONVERSATION…');
    expect(compactNote({ state: 'done', folded: 64, selfAuthored: true, compactionCount: 1 }, 'Keir'))
      .toBe("COMPACTED — 64 MESSAGES CARRIED FORWARD IN BASUNORR'S OWN WORDS.");
    expect(compactNote({ state: 'done', folded: 20, selfAuthored: false, compactionCount: 3 }, 'Keir'))
      .toBe('COMPACTED — 20 MESSAGES CARRIED FORWARD AS AN EXTRACTIVE SUMMARY (THE MODEL DID NOT ANSWER) · COMPACTION 3.');
  });
  test('refusals say why, in numbers where there are numbers', () => {
    expect(compactNote({ state: 'refused', reason: 'too-short', have: 10, need: 31 }))
      .toBe('NOT ENOUGH TO COMPACT YET — 10 MESSAGES; COMPACTION STARTS AT 31 (THE LATEST 20 ALWAYS STAY WORD FOR WORD).');
    expect(compactNote({ state: 'refused', reason: 'too-little-context', haveTokens: 3480, needTokens: 13108 }))
      .toBe('NOT WORTH COMPACTING YET — ≈3.5K TOKENS OF CONVERSATION WOULD FOLD; COMPACTION STARTS AT ≈13.1K.');
    expect(compactNote({ state: 'refused', reason: 'turn-in-flight' })).toBe('A TURN IS RUNNING — COMPACT ONCE IT HAS FINISHED.');
    expect(compactNote({ state: 'failed' })).toBe('COMPACTION FAILED — NOTHING WAS CHANGED. TRY AGAIN.');
    expect(compactNote({ state: 'mystery' })).toBeNull();
  });
  test('/compact stands in the palette', () => {
    expect(PLATFORM_COMMANDS.some((c) => c.name === 'compact' && c.run.type === 'compact')).toBe(true);
    expect(resolveCommand('compact')?.run.type).toBe('compact');
  });
});
