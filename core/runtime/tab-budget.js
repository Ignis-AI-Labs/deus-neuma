/**
 * TAB BUDGET — how many parallel sittings this machine may hold, and why not more.
 *
 * Design note, 2026-07-30:
 *
 *   […]
 *
 * ── WHAT IT NO LONGER DOES (ruling, 2026-10-15) ───────────────────────────────
 *
 * […] No tab — local or witness — is ever held
 * back from opening, focusing or connecting; the witness cap is gone with the
 * activation gate. The measured number caps GENERATION, where it is spent: the
 * house's line runs exactly as wide as `localBudget` would say (substrate-lease.js,
 * via resolveTeamCapacity), and a waiting chat is told its place.
 *
 * This module keeps the reading of that number — measured, unmeasured,
 * incomplete or stale, and the words for each — for every surface that shows it.
 *
 * Pure — every input is passed in. The caller owns the live counts and the
 * capacity read.
 */

/**
 * What a machine may RUN before its capacity has ever been measured.
 *
 * Deliberately conservative and deliberately NOT zero: a being should be
 * reachable on a machine nobody has benchmarked yet, but a single sitting is
 * the most we can promise without evidence. Guessing higher would be inventing
 * a ceiling, which is the one thing this module exists not to do.
 *
 * Design note, 2026-08-29: […]
 */
export const LOCAL_UNMEASURED_FLOOR = 1;

/** Why a local budget is what it is — the desk renders this, so it is data. */
export const LOCAL_BASIS = Object.freeze({
  measured: 'measured',
  unmeasured: 'unmeasured',
  incomplete: 'incomplete',
  stale: 'stale',
});

/**
 * Serving-engine model ids are NOT stable strings, and the staleness check
 * below is worthless if it compares them literally.
 *
 * One machine, one model, unchanged — recorded across this rig's own scan
 * history as `gemma-4-31b`, `google/gemma-4-31b-qat`, and today
 * `gemma-4-31B-it-Q8_0.gguf`, because llama-server's advertised id changed
 * under it. An exact match calls every one of those a different workload and
 * clamps a rig measured at 8 down to 1 — a false "stale" is not the safe
 * direction here, it silently strangles the desk and blames a re-scan the
 * operator has already done.
 *
 * So compare model FAMILY: drop the registry prefix, the file extension, and
 * the packaging suffixes (quantization, instruct-tuning, fine-tune tags) that
 * describe how a model was shipped rather than which model it is. What remains
 * is the identity — and `qwen3.5-122b-a10b` still differs from `gemma-4-31b`,
 * which is the case the guard exists for.
 */
const PACKAGING = /^(q\d+(_[a-z0-9]+)?|f16|fp16|bf16|int4|int8|awq|gptq|gguf|qat|it|instruct|chat|base|hf)$/;

/** Pure — a model id reduced to the family it names, or '' when unnamed. */
export const substrateFamily = (raw) => {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const tail = raw.trim().toLowerCase().split('/').pop()   // drop `google/`
    .replace(/\.(gguf|safetensors|bin)$/, '');             // drop the artifact extension
  const parts = tail.split('-');
  // Strip packaging from the END only: a leading token is the model's name.
  while (parts.length > 1 && PACKAGING.test(parts[parts.length - 1])) parts.pop();
  return parts.join('-');
};

/**
 * Pure — do these two ids name the same model? Unknown on either side is not a
 * mismatch: an absent name is no evidence of a changed workload.
 */
export const sameSubstrate = (a, b) => {
  const x = substrateFamily(a);
  const y = substrateFamily(b);
  if (!x || !y) return true;
  return x === y;
};

/**
 * The LOCAL budget: how many local sittings this rig may hold, and on what
 * evidence. Pure.
 *
 * @param {?{ceiling?: number, limitedBy?: string, incomplete?: boolean,
 *           substrate?: {model?: string}}} capacity - the latest capacity scan,
 *   or null when none has ever run
 * @param {?string} [activeSubstrate] - the model the machine serves NOW; when it
 *   differs from the scanned one the ceiling was measured for a different
 *   workload and is reported STALE rather than trusted
 * @returns {{limit: number, basis: string, limitedBy: (string|null),
 *            substrate: (string|null), reason: string}}
 */
export const localBudget = (capacity, activeSubstrate = null) => {
  const scanned = capacity?.substrate?.model ?? null;

  if (!capacity || typeof capacity.ceiling !== 'number' || !Number.isFinite(capacity.ceiling)) {
    return Object.freeze({
      limit: LOCAL_UNMEASURED_FLOOR,
      basis: LOCAL_BASIS.unmeasured,
      limitedBy: null,
      substrate: scanned,
      reason: 'This machine has never been measured for parallel work. '
        + `${LOCAL_UNMEASURED_FLOOR} local sitting may RUN at a time until a capacity scan gives a real number — `
        + 'the SUBSTRATE window holds the scan. Open as many tabs as you like; only running them at once is bounded.',
    });
  }

  // A partial scan is not a ceiling. It stopped early — often because the
  // machine was already struggling — so its highest reached concurrency is the
  // least trustworthy number in the file.
  if (capacity.incomplete === true) {
    return Object.freeze({
      limit: LOCAL_UNMEASURED_FLOOR,
      basis: LOCAL_BASIS.incomplete,
      limitedBy: capacity.limitedBy ?? null,
      substrate: scanned,
      reason: 'The last capacity scan did not finish, so its ceiling is not a measurement. '
        + `${LOCAL_UNMEASURED_FLOOR} local sitting may RUN at a time until a full scan completes — the SUBSTRATE window holds the scan.`,
    });
  }

  const ceiling = Math.max(0, Math.floor(capacity.ceiling));

  // The ceiling was measured against ONE model. A different model is a
  // different workload, and carrying the old number over would be the kind of
  // quiet inaccuracy that gets a machine killed.
  if (activeSubstrate && scanned && !sameSubstrate(activeSubstrate, scanned)) {
    return Object.freeze({
      limit: Math.min(ceiling, LOCAL_UNMEASURED_FLOOR),
      basis: LOCAL_BASIS.stale,
      limitedBy: capacity.limitedBy ?? null,
      substrate: scanned,
      reason: `The measured ceiling of ${ceiling} was taken on ${scanned}, but this machine `
        + `is serving ${activeSubstrate}. Re-scan in the SUBSTRATE window to RUN more than ${LOCAL_UNMEASURED_FLOOR} at a time.`,
    });
  }

  return Object.freeze({
    limit: ceiling,
    basis: LOCAL_BASIS.measured,
    limitedBy: capacity.limitedBy ?? null,
    substrate: scanned,
    reason: `${ceiling} local sitting${ceiling === 1 ? '' : 's'} may run at once, measured on this machine`
      + `${scanned ? ` with ${scanned}` : ''}`
      + `${capacity.limitedBy ? ` — bounded by ${capacity.limitedBy}` : ''}.`,
  });
};

/** The two kinds of sitting a tab can hold. */
export const TAB_KIND = Object.freeze({ local: 'local', witness: 'witness' });
