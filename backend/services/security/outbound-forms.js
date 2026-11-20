// outbound-forms — every reading of an outgoing text the outbound door judges (PR600 audit P6-16).
// The door used to read a text as written and one level of decoding, so a key left the house
// percent-encoded beside a lone `%`, base64 inside base64, wrapped across lines, or with a
// zero-width character in its middle. These are the forms a receiver can turn back into the key
// with no knowledge of it: invisible characters dropped, width variants folded, percent runs
// decoded even when another run is malformed, line wrapping joined, and every base64 or hex run
// decoded again, a bounded number of levels deep. Pure.

import { decodedForms } from './decoded-forms.js';

const MAX_DEPTH = 4;
const MAX_FORMS = 96;
// format characters (zero-width space and joiners, bidi marks, soft hyphen, tags), fillers that
// draw nothing, and variation selectors: none changes what a reader sees, each breaks a shape
const INVISIBLE = /\p{Cf}|\u034F|[\u115F\u1160\u3164]|[\uFE00-\uFE0F]/gu;
const PERCENT_RUN = /(?:%[0-9a-fA-F]{2})+/g;

// pure — the text as a person reads it: width and compatibility variants folded, invisibles gone
const visibleOf = (text) => text.normalize('NFKC').replace(INVISIBLE, '');

/**
 * The text reduced to its letters and digits, lower-cased: what survives any separator or
 * case change a sender puts through a value the door already knows. Pure.
 * @param {string} text
 * @returns {string}
 */
export const squashedOf = (text) => visibleOf(String(text)).toLowerCase().replace(/[^a-z0-9]/g, '');

// pure — each well-formed percent run decoded on its own, so a lone `%` elsewhere spoils nothing
const percentDecoded = (text) => text.replace(PERCENT_RUN, (run) => {
  try { return decodeURIComponent(run); } catch { return Buffer.from(run.replace(/%/g, ''), 'hex').toString('latin1'); }
});

/**
 * Every form of one outgoing text worth reading for a secret: the visible text, and what its
 * encoded runs stand for, decoded again up to MAX_DEPTH levels. Bounded, so a hostile text
 * cannot make the door work without end. Pure.
 * @param {string} text
 * @returns {string[]}
 */
export const outboundForms = (text) => {
  const seen = new Set();
  const queue = [{ form: visibleOf(String(text)), depth: 0 }];
  while (queue.length && seen.size < MAX_FORMS) {
    const { form, depth } = queue.shift();
    if (!form || seen.has(form)) continue;
    seen.add(form);
    if (depth >= MAX_DEPTH) continue;
    const joined = form.replace(/\s+/g, '');
    for (const next of [percentDecoded(form), ...decodedForms(form), ...(joined === form ? [] : decodedForms(joined))]) {
      queue.push({ form: visibleOf(next), depth: depth + 1 });
    }
  }
  return [...seen];
};
