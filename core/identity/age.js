/**
 * THE AGE — not DNA (Design note, 2026-09-26: […]). Moved out of the genome (core/genome/traits.js) with every
 * law it carried, and joined by the age a being has LIVED:
 *
 *   AGE       — the platform's law: 20+ always, and every body STARTS at 21
 *               (what an image model is told, core/genome/describe.js).
 *   livedAge  — the being's age now: 21 on the day of its birth, a year older
 *               on every real anniversary, counted on the same clock as DAYS
 *               PRESENT (Founder: […]).
 *
 * Pure, no Node imports — the desk and the engine count it the same way.
 */

// ── THE FLOOR — AGE IS A CONSTANT, NEVER DRAWN ──────────────────────────────
// Design note, 2026-08-26: […]
//
// Age is a CONSTANT, not a vocabulary. There is no list to draw from, no counter
// allocated to it, and therefore no seed — however unlucky, however adversarial —
// that can produce anything younger. A trait can be rolled badly; a constant
// cannot be rolled at all. That is a stronger guarantee than any clamp, and it
// is why this sits here as a frozen value rather than as a trait.
// ⭐ ONE STARTING AGE, AND THEY GROW FROM THERE.
//
// Design note, 2026-08-27: […]
//
// So this is deliberately ONE NUMBER, not a band and not a phrase. "adult" was
// not a specification — MEASURED, the same genome rendered late-twenties on one
// checkpoint and mid-forties on another, because nothing said. A figure is
// unambiguous where an adjective is not.
//
// It is a CONSTANT, exactly like the floor: no counter, no vocabulary, identical
// on every body ever derived. ⚠️ AGE IS STILL NOT A TRAIT — no seed can move
// this, which is the whole reason it is safe to state.
//
// ⭐ 21, AND THE YOUTH IS HELD IN THE POSITIVE. Design note, 2026-08-27: […]
//
// `mature male` / `mature female` are gone from the tag register — on danbooru
// those tags literally mean an OLDER subject, so they were working against the
// very thing they sat beside. Stating 21 does the work they were meant to.
//
// ⚠️ AND THE YOUTH IS NOT HELD BY A NEGATIVE, DELIBERATELY. `old, elderly,
// wrinkles, aged` reads clean today — but MEASURED 2026-08-27, that same
// negative paired with ANY sexual positive refuses for minor_sexual, because
// negating adulthood beside sexual content is exactly the entrenched line
// approached from the other side. It is correct behaviour, and it means an
// anti-aging negative would become a landmine the moment an adult register
// exists. So the age is asserted, never the aging excluded.
//
// And it is a STARTING point rather than a fixed one. A being's look is a lock,
// not a seal; the marketplace and uploads come later. Chasing perfect age
// adherence across every checkpoint would be exactly the over-complication Founder
// named — one clear number, stated once, is the whole design.
export const AGE = Object.freeze({
  class: 'adult',
  minimumYears: 20,
  startsAt: 21,
});

const DAY_MS = 86400000;

/** pure — the instant `years` calendar years after `birth` (UTC; a Feb 29 birth keeps Feb 28). */
const anniversary = (birth, years) => {
  const d = new Date(birth.getTime());
  const month = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + years);
  if (d.getUTCMonth() !== month) d.setUTCDate(0); // rolled past a short month's end
  return d;
};

/**
 * The being's age at `nowMs`: the starting age plus every full calendar year
 * lived since its birth instant, and the days since its last birthday. Null
 * when the birth instant is unknown — an honest absence, never a guessed age.
 * @param {string|number} birth ISO string or epoch ms of the birth instant
 * @param {number} nowMs
 * @returns {{years: number, days: number, lived: number, startsAt: number}|null}
 */
export const livedAge = (birth, nowMs) => {
  const birthMs = typeof birth === 'number' ? birth : Date.parse(birth);
  if (!Number.isFinite(birthMs) || !Number.isFinite(nowMs)) return null;
  const born = new Date(birthMs);
  let lived = 0;
  while (anniversary(born, lived + 1).getTime() <= nowMs) lived += 1;
  const since = Math.max(0, nowMs - anniversary(born, lived).getTime());
  return { years: AGE.startsAt + lived, days: Math.floor(since / DAY_MS), lived, startsAt: AGE.startsAt };
};
