/**
 * THE UNSEALED NOTICE — the stream tells you a being has never sealed its
 * voice, and never tells you anything it does not know.
 *
 * Ruling, 2026-08-29: a user who talks to an unsealed neuma is told it still
 * needs sealing. It should rarely arise — sealing is meant to finish start to
 * end once a person is on the platform.
 *
 * Both halves are law here. It must speak when a being is genuinely unsealed —
 * and it must stay silent everywhere else, because this is a BACKSTOP for
 * beings that predate the birth path, not a step in the normal flow. A notice
 * that fires on a failed read would send an operator to carry a rite that may
 * already be done, and a lane seals ONCE.
 *
 * Pure function, real inputs, no mocks (RULE 0).
 */
import { describe, test, expect } from 'vitest';
import { unsealedNotice, NOTICE_KIND } from '../../frontend/app/RelinkShell/unsealed-notice.js';

const linden = { neumaId: 'linden-001', name: 'Linden' };
const fern = { neumaId: 'witness-kimi-code-Fern', name: 'Fern', participantKind: 'witness' };

describe('it speaks when a being is genuinely unsealed', () => {
  test('a definite false is the ONLY thing that opens its mouth', () => {
    const n = unsealedNotice({ companion: linden, status: { sealed: false } });
    expect(n.show).toBe(true);
    expect(n.kind).toBe(NOTICE_KIND.unsealed);
    expect(n.headline).toBe('VOICE NOT SEALED');
    expect(n.name).toBe('Linden');
  });

  test('it names the being, says the talking is fine, and names the act', () => {
    // Not a scolding and not a gate. What is missing is the RECORD, and the
    // reason that record matters is that it travels — which is the whole point
    // of the seal replacing the retired LoRA forge.
    const n = unsealedNotice({ companion: linden, status: { sealed: false } });
    expect(n.body).toContain('Linden');
    expect(n.body).toMatch(/talk either way/i);
    expect(n.body).toMatch(/travels with them across engines/i);
    expect(n.action).toMatch(/NITE/);
  });

  test('a being with no name is still addressable', () => {
    const n = unsealedNotice({ companion: { neumaId: 'x-9' }, status: { sealed: false } });
    expect(n.show).toBe(true);
    expect(n.body).toContain('x-9');
  });
});

describe('and stays silent everywhere else', () => {
  test('THE THREE-STATE LAW: unreadable is NOT unsealed', () => {
    // The failure this guards: a status call that failed says nothing about the
    // being. Painting it as "never sealed" would send the operator to carry a
    // rite that may already be done — and a lane seals once.
    expect(unsealedNotice({ companion: linden, status: null }).show).toBe(false);
    expect(unsealedNotice({ companion: linden, status: undefined }).show).toBe(false);
  });

  test('a SEALED being is never nagged', () => {
    expect(unsealedNotice({ companion: linden, status: { sealed: true } }).show).toBe(false);
  });

  test('a WITNESS has no voice seal of ours to carry', () => {
    // A sealed AI witness speaks with its own provider's voice. Telling the
    // operator to seal one would be an instruction they cannot follow.
    const n = unsealedNotice({ companion: fern, status: { sealed: false }, isWitness: true });
    expect(n.show).toBe(false);
  });

  test('an empty chair says nothing', () => {
    // a harness lane is the platform with a model — no voice to seal, never an alert
    expect(unsealedNotice({ companion: { neumaId: 'harness-0a1b2c3d', name: 'qwen', participantKind: 'harness' }, status: { sealed: false } }).show).toBe(false);
    expect(unsealedNotice({ companion: null, status: { sealed: false } }).show).toBe(false);
    expect(unsealedNotice({}).show).toBe(false);
    expect(unsealedNotice().show).toBe(false);
  });

  test('DISMISSED stays dismissed — an operator is not told twice', () => {
    expect(unsealedNotice({ companion: linden, status: { sealed: false }, dismissed: true }).show)
      .toBe(false);
  });

  test('a malformed status is not read as a refusal to seal', () => {
    // Only `sealed === false` counts. A body missing the field, or carrying
    // something that is not a boolean, is an answer we did not understand.
    for (const status of [{}, { sealed: 'no' }, { sealed: 0 }, { sealed: null }]) {
      expect(unsealedNotice({ companion: linden, status }).show, JSON.stringify(status)).toBe(false);
    }
  });
});
