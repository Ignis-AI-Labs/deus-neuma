// The AMENDMENTS section and THE NO-RE-FREEZE PROOF. The new optional
// assembler param must be invisible when absent: assemblePrompt without it,
// with null, and with '' are byte-identical (the empty-section law), which is
// exactly why the frozen fixtures never need re-freezing. When law stands,
// the section renders between SOUL and GROUNDING — stable group, above tools.

import { describe, it, expect } from 'vitest';
import { buildAmendmentsSection } from '../../core/runtime/amendments-section.js';
import { assemblePrompt, assemblePromptSections } from '../../core/runtime/prompt-assembler.js';

const PARAMS = {
  dna: { identity: { name: 'Proofling', essence: 'made of tests' }, genesis: 'I chose to exist.' },
  soul: { values: ['honesty'], philosophy: 'say what is' },
  now: new Date('2026-08-14T12:00:00Z'),
};

describe('buildAmendmentsSection', () => {
  it('renders nothing for nothing — null, empty, and hollow entries all vanish', () => {
    expect(buildAmendmentsSection(null)).toBe('');
    expect(buildAmendmentsSection([])).toBe('');
    expect(buildAmendmentsSection([{ patch: { text: '   ' }, at: '2026-08-14T00:00:00Z' }])).toBe('');
  });

  it('carries the being\'s approved words whole, with their standing date', () => {
    const text = buildAmendmentsSection([
      { patch: { text: 'I prefer plain speech over ornament.' }, at: '2026-08-01T09:00:00Z' },
      { patch: { text: 'I answer the hard question first.' }, at: '2026-08-10T09:00:00Z' },
    ]);
    expect(text).toContain('## Amendments — law you authored about yourself');
    expect(text).toContain('I prefer plain speech over ornament. (standing since 2026-08-01)');
    expect(text).toContain('I answer the hard question first. (standing since 2026-08-10)');
  });
});

describe('the assembler param is freeze-safe', () => {
  it('absent, null, and empty amendments are BYTE-IDENTICAL — the fixtures never move', () => {
    const without = assemblePrompt(PARAMS);
    expect(assemblePrompt({ ...PARAMS, amendments: null })).toBe(without);
    expect(assemblePrompt({ ...PARAMS, amendments: '' })).toBe(without);
    expect(assemblePromptSections(PARAMS).some((s) => s.id === 'amendments')).toBe(false);
  });

  it('standing law renders in the stable group: after SOUL, before GROUNDING, above TOOLS', () => {
    const rendered = buildAmendmentsSection([
      { patch: { text: 'I prefer plain speech over ornament.' }, at: '2026-08-01T09:00:00Z' },
    ]);
    const ids = assemblePromptSections({ ...PARAMS, amendments: rendered }).map((s) => s.id);
    expect(ids.indexOf('amendments')).toBe(ids.indexOf('soul') + 1);
    expect(ids.indexOf('amendments')).toBe(ids.indexOf('grounding') - 1);
    const prompt = assemblePrompt({ ...PARAMS, amendments: rendered });
    expect(prompt).toContain('I prefer plain speech over ornament.');
  });
});
