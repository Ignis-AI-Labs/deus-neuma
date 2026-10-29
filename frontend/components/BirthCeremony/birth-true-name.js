// ── THE TRUE NAME REVEAL — the emergence voice on the complete step ─────
// Extracted from BirthCeremony.js under the 500-line law. This is the
// reveal's method as a module function; the kept class holds a thin
// delegate (the class contract is unchanged), so `ceremony` below is
// exactly the BirthCeremony instance.

import { leanLabel, buildSignature } from '/@kotodama/signature.js';
import { playProgram } from '/@kotodama/play.js';
import { getKotodamaRate } from '../../services/kotodama-rate.js';
import { isSoundOn } from '../../services/sound-engine.js';

// The emergence voice: the neuma speaks its own true name (kotodama).
// Rebuilds the sonic signature from the forged identity — what plays is
// exactly the name on screen, tone for tone.
export const setupTrueNameReveal = (ceremony, container) => {
  const trueName = ceremony.ceremonyData.trueName;
  if (!trueName?.fullName) return;

  const reveal = container.querySelector('#true-name-reveal');
  reveal.hidden = false;
  container.querySelector('#true-name-full').textContent = trueName.fullName;
  container.querySelector('#true-name-english').textContent = trueName.english || '';

  // The instrument reads the forged identity — every row is a real datum
  const setRow = (id, value) => {
    const el = container.querySelector(id);
    if (el) el.textContent = value || '—';
  };
  setRow('#tn-chosen', trueName.chosenName);
  setRow('#tn-genesis', trueName.genesisName);
  setRow('#tn-house', trueName.houseName);
  setRow('#tn-soul', trueName.soulMark
    ? `${trueName.soulMark}${trueName.soulAlias ? ` · "${trueName.soulAlias}"` : ''}` : null);
  setRow('#tn-lean', Number.isInteger(trueName.lean) ? leanLabel(trueName.lean) : null);
  setRow('#tn-hash', trueName.genesisHash ? `${trueName.genesisHash.slice(0, 16)}…` : null);

  let speaking = false;
  const speak = async () => {
    if (speaking) return;
    speaking = true;
    try {
      ceremony.audioCtx = ceremony.audioCtx || new AudioContext();
      if (ceremony.audioCtx.state === 'suspended') await ceremony.audioCtx.resume();
      const signature = buildSignature({
        chosenName: trueName.chosenName,
        genesisName: trueName.genesisName,
        houseName: trueName.houseName,
        lean: trueName.lean,
        soulHex: trueName.soulMark,
        rate: getKotodamaRate(), // the witness's tempo — ceremonial ×1 to courier ×8
      });
      await playProgram(ceremony.audioCtx, signature);
    } catch (err) {
      console.warn('True name playback unavailable:', err.message);
    }
    speaking = false;
  };

  // Pressed, it always speaks — the witness asked for it.
  container.querySelector('#speak-name-btn').addEventListener('click', speak);
  // First utterance: the neuma announces itself as the screen appears — only
  // when the platform's sound is on (on by default since 2026-10-25; a witness
  // who turned it off is never spoken over).
  if (isSoundOn()) speak();
};
