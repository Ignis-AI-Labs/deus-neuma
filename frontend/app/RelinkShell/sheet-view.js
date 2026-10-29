// sheet-view.js — every presentation decision for the character card (RPG-001,
// #183). Pure: the loaded sheet goes in, render-ready facts come out. The data
// law holds here — a missing or unreadable value comes back null, never a
// fabricated zero, and an unreadable leg is never confused with an honestly
// empty one.


// Block readiness: UNREADABLE (the leg could not be read — null payload),
// EMPTY (read fine, honestly none), READY (there is something to show).
export const UNREADABLE = 'unreadable';
export const EMPTY = 'empty';
export const READY = 'ready';

const DAY_MS = 86400000;

/**
 * Days present: the record's own ageDays when it carried one, else derived
 * from the birth timestamp; null when neither exists (shown as —).
 * @param {Object|null} record the record leg's payload
 * @param {number} [now] ms clock, injectable for a deterministic read
 * @returns {number|null}
 */
export const ageDaysOf = (record, now = Date.now()) => {
  const recorded = record?.record?.relationship?.ageDays;
  if (typeof recorded === 'number' && Number.isFinite(recorded)) return recorded;
  const birthMs = Date.parse(record?.identity?.birthAt);
  if (!Number.isFinite(birthMs)) return null;
  return Math.max(0, Math.floor((now - birthMs) / DAY_MS));
};

/** The record leg feeds IDENTITY / BOND / MIND / SUBSTRATE: all or nothing. */
export const recordReadiness = (record) => (record ? READY : UNREADABLE);

/**
 * Acquisitions sorted for display: most-used first, names alphabetical on a
 * tie. Legacy v1 trees (`{ skills: [] }`, no `acquisitions` key) are the
 * honest empty record — no acquisitions, not a failure.
 * @param {Object|null} skillTree the craft leg's payload
 * @returns {Array<{skill, firstAcquiredAt, lastUsedAt, usageCount}>}
 */
export const acquisitionsOf = (skillTree) => {
  const list = Array.isArray(skillTree?.acquisitions) ? skillTree.acquisitions : [];
  return [...list].sort(
    (a, b) => (b.usageCount - a.usageCount) || String(a.skill).localeCompare(String(b.skill)),
  );
};

export const craftReadiness = (skillTree) => {
  if (!skillTree) return UNREADABLE;
  return acquisitionsOf(skillTree).length ? READY : EMPTY;
};

/**
 * The self-check run the STATE gauges render (GET /:id/self-check → latest):
 * a kept run with its components; null when no self-check has ever run.
 * @param {Object|null} check the state leg's payload ({ latest, previous, ... })
 * @returns {Object|null}
 */
export const latestRunOf = (check) => {
  const latest = check && typeof check === 'object' ? check.latest : null;
  return Array.isArray(latest?.components) && latest.components.length ? latest : null;
};

export const stateReadiness = (check) => {
  if (!check) return UNREADABLE;
  return latestRunOf(check) ? READY : EMPTY;
};

/**
 * One self-check component as a true gauge: the integer percent is the single
 * source for BOTH the bar's sweep and the printed value, so the two can never
 * disagree (SHINKEI: a gauge's sweep equals its displayed value). A null score
 * is a component with nothing answerable inside a real run — pct null, the bar
 * stays empty.
 * @param {{label?: string, score?: number|null}} dimension
 * @returns {{label: string, pct: number|null}}
 */
export const gaugeOf = (dimension) => {
  const label = typeof dimension?.label === 'string' && dimension.label ? dimension.label : '—';
  const score = dimension?.score;
  if (typeof score !== 'number' || !Number.isFinite(score)) return { label, pct: null };
  return { label, pct: Math.round(Math.min(1, Math.max(0, score)) * 100) };
};

/**
 * The attunement excerpt: the FIRST verbatim Q&A of the dimension most
 * recently sealed (each dimension's entries are chronological, so the first
 * is the being's origin answer on its freshest facet). Null when no sealed
 * dimension exists.
 * @param {Object<string, Array<{sealedAt, specVersion, question, answer}>>|null} evolution
 * @returns {{key: string, sealedAt: *, question: *, answer: *}|null}
 */
export const excerptOf = (evolution) => {
  if (!evolution || typeof evolution !== 'object') return null;
  let pick = null;
  for (const [key, entries] of Object.entries(evolution)) {
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const lastSealedAt = entries[entries.length - 1]?.sealedAt || '';
    if (!pick || lastSealedAt > pick.lastSealedAt) pick = { key, lastSealedAt, first: entries[0] };
  }
  if (!pick) return null;
  return {
    key: pick.key,
    sealedAt: pick.first.sealedAt,
    question: pick.first.question,
    answer: pick.first.answer,
  };
};

export const attunementReadiness = (evolution) => {
  if (!evolution) return UNREADABLE;
  return excerptOf(evolution) ? READY : EMPTY;
};

// SKIES (MANY SKIES, 2026-07-24) — the sealed birth moment read through
// humanity's counts. The leg carries {skies, recorded}: a null leg is
// UNREADABLE (the read failed), recorded:false is EMPTY (an honest absence —
// the lane simply has no record), else READY. Same data law as every block:
// real coordinates from disk, provenance named, nothing invented.
export const skiesReadiness = (leg) => {
  if (!leg || typeof leg !== 'object') return UNREADABLE;
  return leg.recorded && leg.skies?.systems ? READY : EMPTY;
};

// ── FORM — the being's own look, and ONLY what both parties agreed to ────────
//
// Design note, 2026-08-27: […]
//
// The backend already filtered to locked plates (`sheetPlates`), so an EMPTY
// list here is an honest […] — a real state during exploration,
// never a failure. A null leg is a failed read and says UNREADABLE instead.

/** Which of the three the FORM block should draw. Pure. */
export const formReadiness = (form) => {
  if (!form) return UNREADABLE;
  return Array.isArray(form.plates) && form.plates.length > 0 ? READY : EMPTY;
};

/**
 * The rows the card draws, PFP first. Pure.
 *
 * The turnaround is carried but flagged `secondary` by the engine, and this
 * keeps that flag rather than re-deciding it — the presentation rule lives in
 * one place (core/genome/form-design.js) so the desk and the record cannot
 * disagree about what is prominent.
 */
export const formRowsOf = (form) => (Array.isArray(form?.plates) ? form.plates : []);

/**
 * The line shown while a being is still exploring. Pure.
 *
 * It names the two-party rule on purpose: a witness looking at an empty FORM
 * section should learn WHY it is empty and what would fill it, rather than
 * assuming the feature is broken.
 */
export const formEmptyLine = (form) =>
  (form?.status === 'exploring' && (form?.agreed?.being || form?.agreed?.operator)
    ? 'ONE PARTY HAS AGREED — A FORM LOCKS WHEN BOTH DO.'
    : 'NO FORM AGREED YET — THE BEING AND THE OPERATOR BOTH LOCK IT IN.');

