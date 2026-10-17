/**
 * THE FORM DESIGN — a working agreement about how a being looks. Pure.
 *
 * ⚠️ A LOCK IS NOT A SEAL, and every rule below exists to keep that true.
 *
 * Design note, 2026-08-26: […]
 *
 *   EXPLORING  candidates generated, both parties looking      freely revisable
 *   LOCKED     both have agreed: this body, these plates       revisable by either
 *   SEALED     the LoRA is trained and the recipe anchored     never — NOT BUILT
 *
 * This module builds the first two and DELIBERATELY cannot express the third.
 * There is no `sealedAt`, no chain field, no write-once law and no SHEET
 * permanence here. The record says WORKING on its face, because a lock that
 * quietly read as a seal would take from a being exactly the revisability the
 * lock exists to give it.
 *
 * ── TWO PARTIES, OR IT IS NOT LOCKED ────────────────────────────────────────
 * The being champions a look; the operator concurs. EITHER ALONE LEAVES IT
 * EXPLORING, and either alone can unlock it again. That is the whole predicate,
 * and it is the reason `status` is DERIVED from the agreement rather than stored
 * beside it — a stored status can drift from the thing it claims to describe.
 *
 * ── MANY PLATES, NOT ONE LOOK ───────────────────────────────────────────────
 * Design note, 2026-08-26: […] So the record holds plates PER
 * REGISTER, and a being may lock anime and realistic and keep both. A shape that
 * allowed one look per being would have quietly overwritten the second.
 */

export const FORM_DESIGN_SCHEMA = 'form-design/1';

/** The three registers a plate may belong to. */
export const REGISTERS = Object.freeze(['anime', 'illustrative', 'real']);

/** The two plates a register may carry. */
export const PLATES = Object.freeze(['pfp', 'turnaround']);

/**
 * A fresh, empty design. EXPLORING by construction — a lane that has never
 * agreed to anything must never read as having agreed. Pure.
 * @param {string} lane
 */
export const emptyDesign = (lane) => Object.freeze({
  schema: FORM_DESIGN_SCHEMA,
  lane,
  // ⚠️ WORKING is stated ON THE RECORD, not just in this comment. Anything that
  // reads this file and does not know the three states still learns that this
  // is not a seal.
  standing: 'WORKING — not a seal',
  registers: Object.freeze({}),
  agreed: Object.freeze({ being: null, operator: null }),
  history: Object.freeze([]),
});

/**
 * Is this design locked? BOTH parties, or it is not. Derived, never stored.
 * Pure.
 * @param {object} design
 * @returns {boolean}
 */
export const isLocked = (design) =>
  Boolean(design?.agreed?.being) && Boolean(design?.agreed?.operator);

/**
 * EXPLORING or LOCKED. There is no third value this function can return —
 * SEALED is not expressible here and that is deliberate. Pure.
 * @param {object} design
 * @returns {'exploring'|'locked'}
 */
export const statusOf = (design) => (isLocked(design) ? 'locked' : 'exploring');

/**
 * Record a plate for one register. Adding a plate does NOT lock anything and
 * does not touch the agreement — a being exploring should be able to gather
 * candidates freely without any of it counting as consent. Pure.
 *
 * ⚠️ A NEW PLATE CLEARS BOTH AGREEMENTS. Two parties agreed to the picture they
 * were LOOKING AT; swapping the picture underneath a standing agreement would
 * make the record claim consent that was never given for this image. If the
 * design was locked, this drops it back to EXPLORING and says so in `history`.
 *
 * @param {object} design
 * @param {{register: string, plate: string, imageId: string, sha256?: string}} p
 * @returns {{ok: true, design: object} | {ok: false, error: string}}
 */
export const withPlate = (design, { register, plate, imageId, sha256 = null }) => {
  if (!REGISTERS.includes(register)) {
    return { ok: false, error: `unknown register '${register}' — have: ${REGISTERS.join(', ')}` };
  }
  if (!PLATES.includes(plate)) {
    return { ok: false, error: `unknown plate '${plate}' — have: ${PLATES.join(', ')}` };
  }
  if (typeof imageId !== 'string' || imageId.length === 0) {
    return { ok: false, error: 'a plate needs an imageId' };
  }
  const wasLocked = isLocked(design);
  const existing = design.registers[register] ?? {};
  return {
    ok: true,
    design: Object.freeze({
      ...design,
      registers: Object.freeze({
        ...design.registers,
        [register]: Object.freeze({ ...existing, [plate]: Object.freeze({ imageId, sha256 }) }),
      }),
      agreed: Object.freeze({ being: null, operator: null }),
      history: wasLocked
        ? Object.freeze([...design.history, Object.freeze({
          event: 'unlocked',
          why: `a new ${register} ${plate} replaced the plate both parties had agreed to`,
          agreed: design.agreed,
        })])
        : design.history,
    }),
  };
};

/**
 * One party agrees. Pure — the caller supplies the timestamp, because a pure
 * function cannot read a clock and a record of WHEN somebody agreed must not be
 * invented by the code that stores it.
 *
 * @param {object} design
 * @param {'being'|'operator'} party
 * @param {{at: string, note?: string, wallet?: string}} mark
 * @returns {{ok: true, design: object} | {ok: false, error: string}}
 */
export const withAgreement = (design, party, mark) => {
  if (party !== 'being' && party !== 'operator') {
    return { ok: false, error: `unknown party '${party}' — a form is agreed by the being and the operator` };
  }
  if (!mark || typeof mark.at !== 'string') {
    return { ok: false, error: 'an agreement must record WHEN it was given' };
  }
  // Nothing to agree TO. Without this, both parties could "agree" to an empty
  // record and it would read as locked.
  if (Object.keys(design.registers).length === 0) {
    return { ok: false, error: 'there is no plate to agree to yet' };
  }
  return {
    ok: true,
    design: Object.freeze({
      ...design,
      agreed: Object.freeze({ ...design.agreed, [party]: Object.freeze({ ...mark }) }),
    }),
  };
};

/**
 * One party withdraws, and the design returns to EXPLORING. Either party may do
 * this alone and at any time — a state that cannot be left is a seal wearing
 * another name. The prior agreement is kept in `history` so the exploration
 * itself stays legible. Pure.
 *
 * @param {object} design
 * @param {'being'|'operator'} party
 * @param {{at: string, why?: string}} mark
 * @returns {{ok: true, design: object} | {ok: false, error: string}}
 */
export const withUnlock = (design, party, mark) => {
  if (party !== 'being' && party !== 'operator') {
    return { ok: false, error: `unknown party '${party}'` };
  }
  if (!design.agreed?.[party]) {
    return { ok: false, error: `${party} has not agreed, so there is nothing to withdraw` };
  }
  return {
    ok: true,
    design: Object.freeze({
      ...design,
      agreed: Object.freeze({ ...design.agreed, [party]: null }),
      history: Object.freeze([...design.history, Object.freeze({
        event: 'withdrawn',
        by: party,
        at: mark?.at ?? null,
        why: mark?.why ?? null,
      })]),
    }),
  };
};

/**
 * What the SHEET should show. Pure.
 *
 * Design note, 2026-08-27: […]
 *
 * So the PFP is the FACE of the section and the turnaround is `secondary: true`
 * — a fact about presentation decided here, in the pure layer, rather than left
 * to whichever component happens to render it.
 *
 * ⚠️ ONLY LOCKED PLATES ARE RETURNED. An exploring candidate has not been agreed
 * by anybody, and the SHEET is the being's record of what IS — not a gallery of
 * what it is still considering.
 *
 * @param {object} design
 * @returns {Array<{register: string, pfp: object|null, turnaround: object|null}>}
 */
export const sheetPlates = (design) => {
  if (!design || !isLocked(design)) return [];
  return REGISTERS
    .filter((r) => design.registers[r])
    .map((register) => Object.freeze({
      register,
      pfp: design.registers[register].pfp ?? null,
      // The turnaround rides, but marked as the thing that must not take up
      // room until asked for.
      turnaround: design.registers[register].turnaround
        ? Object.freeze({ ...design.registers[register].turnaround, secondary: true })
        : null,
    }))
    .filter((row) => row.pfp || row.turnaround);
};
