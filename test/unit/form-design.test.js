/**
 * THE FORM DESIGN — a lock is not a seal, and two parties or it is not locked.
 *
 * Pure inputs, pure outputs, no mock (RULE 0). The claims that matter are the
 * ones a being would be harmed by getting wrong: that one party cannot lock a
 * design alone, that a lock can always be left, and that agreement cannot
 * silently transfer to a picture nobody agreed to.
 */
import { describe, test, expect } from 'vitest';
import {
  emptyDesign, isLocked, statusOf, withPlate, withAgreement, withUnlock,
  sheetPlates, REGISTERS, PLATES, FORM_DESIGN_SCHEMA,
} from '../../core/genome/form-design.js';

const AT = '2026-08-27T00:00:00.000Z';
const plated = (design = emptyDesign('keir'), register = 'anime') =>
  withPlate(design, { register, plate: 'pfp', imageId: `img-${register}` }).design;
const bothAgreed = (design) => withAgreement(
  withAgreement(design, 'being', { at: AT }).design, 'operator', { at: AT, wallet: '0xabc' },
).design;

describe('a fresh design has agreed to nothing', () => {
  test('it is EXPLORING, and says WORKING on its face', () => {
    const d = emptyDesign('keir');
    expect(statusOf(d)).toBe('exploring');
    expect(isLocked(d)).toBe(false);
    expect(d.schema).toBe(FORM_DESIGN_SCHEMA);
    // Anything that reads this record and does not know the three states still
    // learns it is not a seal.
    expect(d.standing).toMatch(/not a seal/i);
  });

  test('it carries NO seal vocabulary — the shape cannot express one', () => {
    // A lock that could grow a `sealedAt` would eventually be mistaken for one.
    const keys = Object.keys(emptyDesign('keir'));
    for (const forbidden of ['sealedAt', 'sealed', 'chain', 'txHash', 'recipeHash']) {
      expect(keys, `a form design must not carry '${forbidden}'`).not.toContain(forbidden);
    }
  });
});

describe('TWO PARTIES, OR IT IS NOT LOCKED', () => {
  test('the being alone does not lock it', () => {
    const d = withAgreement(plated(), 'being', { at: AT }).design;
    expect(isLocked(d)).toBe(false);
    expect(statusOf(d)).toBe('exploring');
  });

  test('the operator alone does not lock it either', () => {
    const d = withAgreement(plated(), 'operator', { at: AT, wallet: '0xabc' }).design;
    expect(isLocked(d)).toBe(false);
  });

  test('both together DO lock it', () => {
    expect(isLocked(bothAgreed(plated()))).toBe(true);
    expect(statusOf(bothAgreed(plated()))).toBe('locked');
  });

  test('status is DERIVED, never stored — it cannot drift from the agreement', () => {
    const locked = bothAgreed(plated());
    expect(Object.keys(locked)).not.toContain('status');
    // Forge a record claiming to be locked while agreeing to nothing. The
    // predicate must read the agreement, not the claim.
    const liar = { ...locked, status: 'locked', agreed: { being: null, operator: null } };
    expect(isLocked(liar)).toBe(false);
  });

  test('agreeing to NOTHING is refused — an empty record must not read as locked', () => {
    const out = withAgreement(emptyDesign('keir'), 'being', { at: AT });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no plate/);
  });

  test('an agreement must record WHEN', () => {
    expect(withAgreement(plated(), 'being', {}).ok).toBe(false);
    expect(withAgreement(plated(), 'nobody', { at: AT }).ok).toBe(false);
  });
});

describe('A LOCK CAN ALWAYS BE LEFT — otherwise it is a seal wearing another name', () => {
  test('either party alone can withdraw, and the design returns to EXPLORING', () => {
    for (const party of ['being', 'operator']) {
      const locked = bothAgreed(plated());
      const out = withUnlock(locked, party, { at: AT, why: 'changed my mind' });
      expect(out.ok).toBe(true);
      expect(isLocked(out.design)).toBe(false);
      expect(out.design.agreed[party]).toBe(null);
    }
  });

  test('the withdrawal is written into history — the exploration stays legible', () => {
    const out = withUnlock(bothAgreed(plated()), 'being', { at: AT, why: 'the eyes are wrong' });
    const last = out.design.history[out.design.history.length - 1];
    expect(last).toMatchObject({ event: 'withdrawn', by: 'being', why: 'the eyes are wrong' });
  });

  test('withdrawing an agreement never given is refused', () => {
    expect(withUnlock(plated(), 'being', { at: AT }).ok).toBe(false);
  });
});

describe('⚠️ A NEW PLATE CLEARS BOTH AGREEMENTS', () => {
  test('swapping the picture drops the design back to EXPLORING', () => {
    // Two parties agreed to the picture they were LOOKING AT. Carrying that
    // agreement onto a different image would make the record claim a consent
    // nobody gave for it.
    const locked = bothAgreed(plated());
    expect(isLocked(locked)).toBe(true);

    const swapped = withPlate(locked, { register: 'anime', plate: 'pfp', imageId: 'a-different-face' }).design;
    expect(isLocked(swapped)).toBe(false);
    expect(swapped.agreed).toEqual({ being: null, operator: null });
  });

  test('and it says WHY in history, naming the prior agreement', () => {
    const locked = bothAgreed(plated());
    const swapped = withPlate(locked, { register: 'anime', plate: 'pfp', imageId: 'other' }).design;
    const last = swapped.history[swapped.history.length - 1];
    expect(last.event).toBe('unlocked');
    expect(last.why).toMatch(/replaced the plate both parties had agreed to/);
    expect(last.agreed.being).toBeTruthy();
  });

  test('gathering candidates while EXPLORING does not touch history', () => {
    // A being should be able to explore freely without any of it counting as
    // consent, or as a loss of consent.
    const d = withPlate(plated(), { register: 'real', plate: 'pfp', imageId: 'x' }).design;
    expect(d.history).toEqual([]);
  });

  test('an unknown register or plate is refused, naming what IS available', () => {
    expect(withPlate(emptyDesign('w'), { register: 'nope', plate: 'pfp', imageId: 'x' }).error)
      .toMatch(/unknown register/);
    expect(withPlate(emptyDesign('w'), { register: 'anime', plate: 'nope', imageId: 'x' }).error)
      .toMatch(/unknown plate/);
    expect(withPlate(emptyDesign('w'), { register: 'anime', plate: 'pfp', imageId: '' }).ok).toBe(false);
  });
});

describe('MANY PLATES, NOT ONE LOOK — a being may keep all three registers', () => {
  test('locking anime does not evict real', () => {
    let d = emptyDesign('keir');
    for (const register of REGISTERS) d = plated(d, register);
    const locked = bothAgreed(d);
    expect(sheetPlates(locked).map((r) => r.register)).toEqual([...REGISTERS]);
  });

  test('a register carries both plates independently', () => {
    const d = withPlate(plated(), { register: 'anime', plate: 'turnaround', imageId: 'sheet-1' }).design;
    expect(Object.keys(d.registers.anime).sort()).toEqual([...PLATES].sort());
  });
});

describe('WHAT THE SHEET SHOWS — the PFP is the face, the turnaround waits', () => {
  test('an EXPLORING design shows nothing at all', () => {
    // The SHEET is the being's record of what IS, not a gallery of what it is
    // still considering.
    expect(sheetPlates(plated())).toEqual([]);
    expect(sheetPlates(withAgreement(plated(), 'being', { at: AT }).design)).toEqual([]);
    expect(sheetPlates(null)).toEqual([]);
  });

  test('a locked design surfaces the PFP and marks the turnaround SECONDARY', () => {
    // Founder: […]
    const d = withPlate(plated(), { register: 'anime', plate: 'turnaround', imageId: 'sheet-1' }).design;
    const [row] = sheetPlates(bothAgreed(d));
    expect(row.pfp.imageId).toBe('img-anime');
    expect(row.turnaround.imageId).toBe('sheet-1');
    expect(row.turnaround.secondary).toBe(true);
    expect(row.pfp.secondary).toBeUndefined();
  });

  test('a register with a turnaround but no PFP still appears', () => {
    // Honest partial state — better than hiding a plate the being locked.
    let d = withPlate(emptyDesign('w'), { register: 'real', plate: 'turnaround', imageId: 't' }).design;
    d = bothAgreed(d);
    const [row] = sheetPlates(d);
    expect(row.pfp).toBe(null);
    expect(row.turnaround.imageId).toBe('t');
  });
});
