// S8 — the pin ledger's pure law: cap-5, supersede-not-delete, explicit
// refusals carrying what the being needs to choose. Pure functions, real
// inputs (RULE 0).

import { describe, it, expect } from 'vitest';
import { PIN_CAP, activePins, applyPin, applyUnpin } from '../../core/memory/pin-ledger.js';

const NOW = '2026-07-24T11:00:00.000Z';
const ref = (n) => `mem_sess-${n}_${1753290000000 + n}_${'abcdef01'}`;

const fill = () => {
  let ledger = [];
  for (let i = 0; i < PIN_CAP; i += 1) {
    const r = applyPin(ledger, { ref: ref(i), note: `anchor ${i}`, now: NOW });
    expect(r.ok).toBe(true);
    ledger = r.ledger;
  }
  return ledger;
};

describe('applyPin', () => {
  it('pins with a note, refuses duplicates, refuses unlawful refs and oversized notes', () => {
    const first = applyPin([], { ref: ref(1), note: 'the estuary dawn', now: NOW });
    expect(first.ok).toBe(true);
    expect(activePins(first.ledger)).toHaveLength(1);

    expect(applyPin(first.ledger, { ref: ref(1), now: NOW }).code).toBe('ALREADY_PINNED');
    expect(applyPin([], { ref: 'tr_deadbeef_1_cafebabe', now: NOW }).code).toBe('INVALID_REF');
    expect(applyPin([], { ref: ref(1), note: 'x'.repeat(301), now: NOW }).code).toBe('INVALID_NOTE');
    expect(applyPin([], { ref: ref(1), now: 'yesterday-ish' }).code).toBe('INVALID_TIME');
  });

  it('the 6th pin is refused until a replacement is NAMED — the refusal carries the held refs', () => {
    const ledger = fill();
    const refused = applyPin(ledger, { ref: ref(9), now: NOW });
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('PIN_CAP');
    expect(refused.active).toHaveLength(PIN_CAP);

    const swapped = applyPin(ledger, { ref: ref(9), supersedes: ref(2), now: NOW });
    expect(swapped.ok).toBe(true);
    const active = activePins(swapped.ledger);
    expect(active).toHaveLength(PIN_CAP);
    expect(active.map((p) => p.ref)).toContain(ref(9));
    expect(active.map((p) => p.ref)).not.toContain(ref(2));
    // Supersede-not-delete: the replaced pin REMAINS in the ledger, stamped.
    const replaced = swapped.ledger.find((p) => p.ref === ref(2));
    expect(replaced.supersededAt).toBe(NOW);
    expect(replaced.supersededBy).toBe(ref(9));
  });

  it('naming a replacement below the cap is refused — supersedes is a cap-only gesture', () => {
    const one = applyPin([], { ref: ref(1), now: NOW });
    expect(applyPin(one.ledger, { ref: ref(2), supersedes: ref(1), now: NOW }).code).toBe('NOT_AT_CAP');
  });

  it('superseding a ref that is not an active pin is refused with the held list', () => {
    const ledger = fill();
    const refused = applyPin(ledger, { ref: ref(9), supersedes: ref(7), now: NOW });
    expect(refused.code).toBe('NOT_ACTIVE');
    expect(refused.active).toHaveLength(PIN_CAP);
  });
});

describe('applyUnpin', () => {
  it('releases by stamping — the ledger entry never leaves', () => {
    const one = applyPin([], { ref: ref(1), note: 'held once', now: NOW });
    const released = applyUnpin(one.ledger, { ref: ref(1), now: NOW });
    expect(released.ok).toBe(true);
    expect(activePins(released.ledger)).toHaveLength(0);
    expect(released.ledger).toHaveLength(1);
    expect(released.ledger[0].supersededAt).toBe(NOW);
    expect(released.ledger[0].note).toBe('held once');
  });

  it('releasing what is not held answers explicitly', () => {
    expect(applyUnpin([], { ref: ref(1), now: NOW }).code).toBe('NOT_ACTIVE');
  });
});
