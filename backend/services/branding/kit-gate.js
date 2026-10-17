// kit-gate — nothing goes out under a brand nobody has defined.
//
// Design note, 2026-08-30: […]
//
// He chose the strict floor: the FULL kit, and marketing acts REFUSE rather
// than warn. So this module exists to make that refusal identical wherever it
// fires — a being that meets one wording at `render_card` and a different one
// at `campaigns/create` learns two rules instead of one.
//
// THE REFUSAL IS THE FEATURE. A gate that says "not ready" and stops has only
// moved the problem; the reply carries the whole checklist, grouped by section,
// with a line on what each field is FOR. Somebody blocked by this should be
// able to finish the kit from the refusal alone, without going and reading a
// schema.
//
// impure — resolves the kit through the operator's own ground.

import { loadBrand } from './brand-tokens.js';
import { kitReadiness, readinessReport } from './kit-readiness.js';

/**
 * May work go out under this brand? impure.
 *
 * @param {string} brand
 * @param {string|null} wallet - the operator's wallet, for their own kits
 * @returns {Promise<{ok: true, tokens: object, dir: string}|{ok: false, reason: string}>}
 */
export const requireReadyKit = async (brand, wallet = null) => {
  const named = String(brand || '').trim();
  if (!named) {
    return { ok: false, reason: 'name the brand this is for — marketing work always belongs to one.' };
  }
  const loaded = await loadBrand(named, { wallet });
  if (!loaded.ok) {
    // A brand with NO kit is a different fault from an incomplete one, and it
    // gets a different sentence: there is nothing to finish, only something to
    // start.
    return {
      ok: false,
      reason: `There is no brand kit for "${named}" yet, so nothing may go out under it.\n`
        + `${loaded.error}\n\n`
        + 'A brand kit is set up ONCE, before the work: it is the standing instruction'
        + " for what this company says, how it looks, and what it must never claim."
        + ` Create ${named}/brand.json in the house ground's brands/ folder and fill it in.`,
    };
  }
  const readiness = kitReadiness(loaded.tokens);
  if (!readiness.ready) return { ok: false, reason: readinessReport(named, readiness) };
  return { ok: true, tokens: loaded.tokens, dir: loaded.dir };
};
