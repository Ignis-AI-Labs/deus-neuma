// compose-cap.js — the composer's cap gauge, as pure arithmetic.
//
// A capped composer (the council's SAY law) tells the witness where they
// stand BEFORE the refusal ever fires: how many characters the draft
// holds, the cap, and the percent used — calm while there is room, NEAR
// as the cap approaches, OVER when a send would be refused. The length
// counted is the TRIMMED draft, because that is exactly what submit sends
// and exactly what the cap judges.

/** The NEAR threshold — the gauge warms at 80% of the cap. */
export const CAP_NEAR = 0.8;

/**
 * The gauge for a draft against a cap.
 * @param {number} len - trimmed draft length
 * @param {number|null|undefined} maxChars - the host's cap (falsy = uncapped)
 * @returns {{pct: number, level: 'calm'|'near'|'over', label: string}|null}
 *   null when there is nothing to show (no cap, or an empty draft)
 */
export const capGauge = (len, maxChars) => {
  if (!maxChars || !Number.isFinite(maxChars) || maxChars <= 0 || len <= 0) return null;
  const pct = Math.round((len / maxChars) * 100);
  const level = len > maxChars ? 'over' : len >= maxChars * CAP_NEAR ? 'near' : 'calm';
  return {
    pct,
    level,
    label: `${len.toLocaleString('en-US')} / ${maxChars.toLocaleString('en-US')} · ${pct}%`,
  };
};
