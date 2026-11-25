// clipboard-guard.js — after the desk copies a wallet address, check that the
// clipboard still holds it. A clipboard hijacker swaps a copied address for
// its own within a moment; the paste then pays the thief.
//
// The check is the desktop shell's (window.neuma.clipboardCheck): it answers
// "same", or the DIFFERENT address of the same chain it found — never any
// other clipboard content. A browser tab has no shell and no check; there the
// guard does nothing rather than ask the page for clipboard-read.
//
// A swap is reported to the house's threat ledger, which raises the card.

import { reportClipboardSwap } from './cso-client.js';

// A hijacker answers a copy in milliseconds; the second look catches a slow one.
const LOOK_AFTER_MS = Object.freeze([400, 1500]);

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Watch one copied address. Resolves to the swapped-in address when the
 * clipboard was changed to a different address, else null.
 * @param {string} copied the address the desk just put on the clipboard
 * @param {{check?: Function, report?: Function, lookAfterMs?: number[]}} [opts]
 * @returns {Promise<?string>}
 */
// impure
export const guardCopiedAddress = async (copied, {
  check = typeof window !== 'undefined' ? window.neuma?.clipboardCheck : undefined,
  report = reportClipboardSwap,
  lookAfterMs = LOOK_AFTER_MS,
} = {}) => {
  if (typeof check !== 'function' || !copied) return null;
  let waited = 0;
  for (const at of lookAfterMs) {
    await sleep(at - waited);
    waited = at;
    const verdict = await check(copied);
    if (verdict && !verdict.same && verdict.found) {
      await report({ copied, found: verdict.found });
      return verdict.found;
    }
  }
  return null;
};
