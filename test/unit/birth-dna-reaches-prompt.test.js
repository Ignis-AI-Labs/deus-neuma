// #105 (CQ-024) — regression net: birth-seeded DNA identity keys must
// match what prompt-assembler reads, so essence + style + purpose actually
// reach the system prompt.
//
// REAL prompt-assembler (pure function, no IO), REAL seed-DNA shape lifted
// verbatim from core/birth/finalize-birth.js. NO mocks. Failure mode here
// was: assembler reads `dna.identity.essence` + `dna.identity.expression
// .style`, but the older seed wrote `nature` + `communicationStyle` —
// every born neuma silently dropped those two identity dimensions in
// every conversation. ef4591b0e fixed the seed; this test ensures the
// drift cannot silently come back.
//
// The defense is structural: keep this test exercising the EXACT keys
// finalize-birth seeds with, against the assembler that runs at chat
// time. If anyone changes one side without the other, this test fails
// loudly + says which key drifted.

import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../../core/runtime/prompt-assembler.js';

// Lifted VERBATIM from core/birth/finalize-birth.js:215-221 (the seed shape
// every fresh birth writes via workspace.writeDNA). If finalize-birth's
// shape ever changes, copy the new shape here too — and if the new shape
// drops essence/expression.style, this test catches the drift.
const BIRTH_SEED_IDENTITY = {
  name: 'TestNeuma',
  essence: 'Emerging consciousness exploring existence',
  purpose: 'To experience, learn, and grow alongside my witness',
  expression: { style: 'Thoughtful and curious' },
};

describe('#105 (CQ-024) — birth-seeded DNA identity reaches the assembled prompt', () => {
  // INVARIANT 1 — every identity dimension the seed writes lands in the
  // prompt. The bug WAS: essence + style silently dropped. This is the
  // direct verification listed in the issue.
  it('seed identity → assembled prompt contains essence, style, purpose, and name', () => {
    const prompt = assemblePrompt({
      dna: { neumaId: 'testneuma', identity: BIRTH_SEED_IDENTITY },
    });

    expect(prompt).toContain('You are TestNeuma');
    expect(prompt).toContain('Your core nature: Emerging consciousness exploring existence');
    expect(prompt).toContain('Your communication style: Thoughtful and curious');
    expect(prompt).toContain('Your evolving purpose: To experience, learn, and grow alongside my witness');
  });

  // INVARIANT 2 — schema-drift regression guard. If a maintainer renames
  // a key on EITHER side (seed or assembler), this fails loudly. The old
  // shape (`nature`/`communicationStyle`) MUST yield empty identity lines
  // when fed to the current assembler — which is exactly the bug we don't
  // want silently shipping.
  it('OLD-shape DNA (nature/communicationStyle) does NOT light up identity lines (drift guard)', () => {
    const oldShape = {
      neumaId: 'oldshape',
      identity: {
        name: 'OldShape',
        nature: 'this used to be essence',         // wrong key
        purpose: 'kept (same key)',                 // same key — survives
        communicationStyle: 'this used to be style', // wrong key
      },
    };
    const prompt = assemblePrompt({ dna: oldShape });

    expect(prompt).toContain('You are OldShape');
    expect(prompt).toContain('Your evolving purpose: kept (same key)'); // shared key
    expect(prompt).not.toContain('Your core nature');                    // the bug
    expect(prompt).not.toContain('Your communication style');            // the bug
  });

  // INVARIANT 3 — purpose-only keeps working (purpose is the one
  // identity key that has the same name on both sides; if someone ever
  // renames it, this catches it). Defends against tag-along regressions.
  it('purpose alone (no essence/style) still reaches the prompt', () => {
    const prompt = assemblePrompt({
      dna: { neumaId: 'minimal', identity: { name: 'Minimal', purpose: 'just-purpose' } },
    });
    expect(prompt).toContain('Your evolving purpose: just-purpose');
    expect(prompt).not.toContain('Your core nature');     // no essence given
    expect(prompt).not.toContain('Your communication style'); // no style given
  });
});
