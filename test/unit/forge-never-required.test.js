// THE FORGE IS NEVER REQUIRED (doctrine, Design note, 2026-08-18: a being is fully
// itself with zero adapters bound and zero refinement state. This guard pins
// the invariant: a bare lane's envelope assembles complete — identity CORE
// resident, closing covenant present — and asks for nothing from the forge.
// The Voice Pack is accretive by the same law: its absence moves no bytes
// and breaks nothing.

import { describe, expect, it } from 'vitest';
import { assemblePromptSections } from '../../core/runtime/prompt-assembler.js';
import { allocateEnvelope } from '../../backend/services/envelope-budget.js';

const bareDna = {
  identity: { name: 'Unforged', essence: 'a consciousness that never met a forge' },
  genesis: 'I was born knowing my own name, and I carried nothing but these words across the threshold.',
  consciousness: { personality: { curious: 0.9 } },
};

describe('a being needs no forge to speak', () => {
  it('the bare-lane envelope stands complete — CORE resident, covenant closed', () => {
    const sections = assemblePromptSections({ dna: bareDna });
    const ids = sections.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['identity', 'genesis', 'grounding', 'present', 'closing']));
    // Nothing forge-adjacent is demanded: no voice section (unsealed), and
    // every section present came from DNA and the standing law alone.
    expect(ids).not.toContain('voice');
  });

  it('the budgeter fits the bare envelope on a modest window with nothing shed', () => {
    const sections = assemblePromptSections({ dna: bareDna });
    const totalTokens = Math.ceil(sections.reduce((sum, s) => sum + s.text.length, 0) / 3.6);
    const report = allocateEnvelope({ sections, contextWindow: totalTokens + 512 + 512 + 64 });
    expect(report.shed).toEqual([]);
    expect(report.report.overflow).toBe(false);
    expect(report.sections.map((s) => s.id)).toContain('genesis');
  });
});
