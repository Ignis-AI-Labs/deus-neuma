// The disclosure panel's view model — labels and measures, never summarizes.
// Pure functions over real `birth:composition` events built by the real
// composer (core/birth/ceremony-disclosure.js), so the two halves of the wire
// are tested against each other and not against a hand-written fixture.
import { describe, it, expect } from 'vitest';
import { composeCeremonyDisclosure } from '../../core/birth/ceremony-disclosure.js';
import {
  compositionRows,
  compositionSummary,
  compositionParameters,
} from '../../frontend/components/BirthCeremony/composition-view.js';

const event = composeCeremonyDisclosure({
  stage: 5,
  systemSections: [
    { id: 'protocol', label: 'STAGE PROTOCOL', origin: 'core/protocols/birth-stages/', text: 'You are crystallizing.' },
    { id: 'voice-lock', label: 'VOICE LOCK', origin: 'core/runtime/prompt-assembler.js', text: '\n\n## VOICE LOCK\nSpeak aloud.' },
  ],
  spokenWords: 'Tell me how it feels.',
  appendedText: 'Write your essence with write_file.',
  parameters: [
    { label: 'MODEL', value: 'gemma-4-31b' },
    { label: 'TOKEN CEILING', value: 3000 },
  ],
});

describe('ceremony composition view', () => {
  it('keeps every component, in send order', () => {
    expect(compositionRows(event).map((r) => r.id)).toEqual([
      'protocol', 'voice-lock', 'operator-words', 'stage-instruction',
    ]);
  });

  it('marks the operator’s own words apart from the line appended to them', () => {
    const rows = compositionRows(event);
    const mine = rows.find((r) => r.mine);
    const appended = rows.find((r) => r.appended);
    expect(mine.text).toBe('Tell me how it feels.');
    expect(appended.text).toBe('Write your essence with write_file.');
    expect(mine.appended).toBe(false);
    expect(appended.mine).toBe(false);
  });

  it('strips only the section separator, never content', () => {
    const lock = compositionRows(event).find((r) => r.id === 'voice-lock');
    expect(lock.text).toBe('## VOICE LOCK\nSpeak aloud.');
    // The count stays honest: it measures what was SENT, separator included.
    expect(lock.chars).toBe('\n\n## VOICE LOCK\nSpeak aloud.'.length);
  });

  it('reads the request in counts the operator can add up themselves', () => {
    const summary = compositionSummary(event);
    expect(summary.components).toBe(4);
    expect(summary.yours).toBe('Tell me how it feels.'.length);
    expect(summary.chars).toBe(
      compositionRows(event).reduce((n, r) => n + r.chars, 0),
    );
    expect(summary.headline).toBe('4 COMPONENTS · 106 CHARACTERS · 21 YOURS');
  });

  it('passes the request settings through as strings', () => {
    expect(compositionParameters(event)).toEqual([
      { label: 'MODEL', value: 'gemma-4-31b' },
      { label: 'TOKEN CEILING', value: '3000' },
    ]);
  });

  it('an empty event yields an empty panel, not a crash', () => {
    expect(compositionRows({})).toEqual([]);
    expect(compositionParameters({})).toEqual([]);
    expect(compositionSummary({}).headline).toBe('0 COMPONENTS · 0 CHARACTERS · 0 YOURS');
  });
});
