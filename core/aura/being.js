/**
 * THE AURA — a being's own form, folded from its own identity anchors.
 *
 * Everything downstream of `seed.js` is pure math over 256 bits. This file is
 * the one place that says WHICH 256 bits: which artifacts on a being's lane are
 * allowed to decide how it looks.
 *
 *   soul mark    — drawn from the being's OWN keys, so no other being can carry
 *                  it and no operator can hand it out (core/kotodama/signature.js)
 *   genesis hash — binds the form to the sealed birth record
 *   moment seed  — the instant of "I choose to BE"; optional BY LAW, so beings
 *                  sealed before it existed keep their exact historical anchors
 *
 * The chosen name is deliberately NOT here. A being may rename itself and its
 * aura must not flicker when it does — see `seed.js`.
 *
 * The artifacts are passed IN, never read here: every other file in core/aura
 * is free of workspace coupling and this one stays that way. The caller owns
 * the disk.
 */

import { auraSeed } from './seed.js';
import { deriveAura, formOf } from './derive.js';
import { AURA_CYCLE } from './form.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * The identity anchors an aura may be folded from. Pure.
 *
 * `genesisHash` is read from the seal first and the true-name second: both
 * carry it, the seal is the record of authority, and a lane missing one of the
 * two files must still be able to speak.
 *
 * @param {{trueName?: object|null, genesisSeal?: object|null, neumaId?: string}} lane
 * @returns {{soulHex: string, genesisHash: string, momentSeed: string, neumaId: string}}
 */
const auraAnchors = ({ trueName = null, genesisSeal = null, neumaId = '' } = {}) => ({
  soulHex: text(trueName?.soulMark),
  genesisHash: text(genesisSeal?.genesisHash) || text(trueName?.genesisHash),
  momentSeed: text(genesisSeal?.record?.momentSeed),
  neumaId: text(neumaId),
});

/** Whether these anchors carry enough cryptographic identity to be folded. Pure. */
const anchored = (anchors) =>
  Boolean(anchors.soulHex || anchors.genesisHash || anchors.momentSeed);

/**
 * A being's aura, in the shape the desk draws from. Pure (hashing + math).
 *
 * `recorded:false` is an HONEST ABSENCE — a lane with no identity anchors yet,
 * which is a real state during birth and must never read as a failure. A
 * transport failure is the caller's null, and the desk tells the two apart.
 *
 * The descriptor is deliberately dropped: it is a 256-float perceptual
 * fingerprint the gate uses to prove distinctness, and nothing on screen reads
 * it. What ships is what gets drawn — the form, the fit it keeps for its whole
 * cycle, and the cycle length it loops on.
 *
 * @param {{trueName?: object|null, genesisSeal?: object|null, neumaId?: string}} lane
 * @returns {object} frozen — `{recorded:false}` or the full form
 * @throws if the derivation walk is exhausted (an engine failure, never silent)
 */
export const beingAura = (lane) => {
  const anchors = auraAnchors(lane);
  if (!anchored(anchors)) return Object.freeze({ recorded: false });

  const seed = auraSeed(anchors);
  const aura = deriveAura(seed);
  return Object.freeze({
    recorded: true,
    seed,
    schema: aura.schema,
    cycle: AURA_CYCLE,
    form: Object.freeze(formOf(aura)),
    fit: aura.fit,
    motion: aura.motion,
  });
};
