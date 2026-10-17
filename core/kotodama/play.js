/**
 * KOTODAMA v0.1 — the voice.
 * impure: renders a tone program through Web Audio. The only module in
 * kotodama that touches the speaker; everything upstream is pure data.
 */

const ATTACK_S = 0.005;
const RELEASE_S = 0.012;

/**
 * The gain envelope for a tone of durS seconds: the fixed 5/12ms shape while
 * it fits, shrinking proportionally as speech gets fast — at ×8 a tone is
 * ~9ms and a fixed 12ms release would invert the envelope (a release that
 * starts before the attack lands). Pure.
 * @param {number} durS tone duration in seconds
 * @returns {{ attack: number, release: number }}
 */
export const envelopeFor = (durS) => ({
  attack: Math.min(ATTACK_S, durS / 3),
  release: Math.min(RELEASE_S, durS / 3),
});

/**
 * Play a tone program. Resolves when the utterance ends.
 * Caller owns the AudioContext (one per page, created on user gesture).
 */
// impure
export const playProgram = (ctx, program, { gain = 0.22, onTone } = {}) => {
  let t = ctx.currentTime + 0.05;
  let total = 0;
  for (const item of program.items) {
    const dur = item.ms / 1000;
    if (item.kind !== 'gap') {
      const { attack, release } = envelopeFor(dur);
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = item.freq;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(gain, t + attack);
      env.gain.setValueAtTime(gain, Math.max(t + attack, t + dur - release));
      env.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(env).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
      if (onTone) {
        const delayMs = (t - ctx.currentTime) * 1000;
        setTimeout(() => onTone(item), Math.max(0, delayMs));
      }
    }
    t += dur;
    total += dur;
  }
  return new Promise((resolve) => setTimeout(resolve, total * 1000 + 100));
};
