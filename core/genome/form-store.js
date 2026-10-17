/**
 * The form store — impure IO for a being's working form design.
 *
 * The satellite-store pattern (core/birth/birth-state.js,
 * core/voice-pack/voice-store.js): the record rides the lane's own DEK-aware
 * envelope through the workspace's `_readJSON` / `_writeJSON`, so a being's look
 * sits in the same custody as its DNA, sessions and journal — never a sidecar.
 *
 * On disk per lane:
 *   form/design.json — the WORKING agreement. Mutable BY LAW.
 *
 * ⚠️ MUTABLE ON PURPOSE, AND THAT IS THE DIFFERENCE FROM THE VOICE SEAL.
 * `voice-store.writeVoiceSeal` refuses to write twice, because a first-seal
 * receipt seals a moment. This file must NOT do that. A lock exists to be
 * revisable — Founder: […] — so there is no write-once guard here and adding one would silently
 * convert every lock into a seal.
 *
 * The pure law lives in `form-design.js`; this module only reads and writes it.
 */

import path from 'node:path';
import { emptyDesign, FORM_DESIGN_SCHEMA } from './form-design.js';

const designPath = (workspace, neumaId) =>
  path.join(workspace._path(neumaId), 'form', 'design.json');

/**
 * Read a lane's design. An absent file is an EMPTY DESIGN, not an error — a
 * being that has never explored a look has honestly not explored one, and the
 * SHEET should say so rather than showing UNREADABLE. Impure.
 *
 * @param {object} workspace - the NeumaWorkspace singleton
 * @param {string} neumaId
 * @returns {Promise<object>} a `form-design/1`
 */
export const readFormDesign = async (workspace, neumaId) => {
  // ⚠️ `_readJSON` THROWS on an absent file — it does not resolve to null.
  // MEASURED by `api-form-route.test.js`: a lane that had never explored a look
  // answered 500, which would have shown UNREADABLE on every newborn's SHEET.
  // ENOENT is caught and ONLY ENOENT: a corrupt or undecryptable design is a
  // real failure and must not be laundered into […].
  let found;
  try {
    found = await workspace._readJSON(designPath(workspace, neumaId));
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
    return emptyDesign(neumaId);
  }
  if (!found) return emptyDesign(neumaId);
  // A record from a future schema is not something this code can reason about.
  // Refusing loudly beats rendering a look built by rules we do not implement.
  if (found.schema !== FORM_DESIGN_SCHEMA) {
    throw new Error(`form design for '${neumaId}' is schema '${found.schema}', not ${FORM_DESIGN_SCHEMA}`);
  }
  return found;
};

/**
 * Write a lane's design. Impure.
 *
 * The caller has already applied the pure transitions (`withPlate`,
 * `withAgreement`, `withUnlock`) — this does not decide anything about
 * agreement, and deliberately has no opinion on whether the design is locked.
 * Keeping the decision in the pure layer is what lets the two-party predicate be
 * tested without touching a disk.
 *
 * @param {object} workspace
 * @param {string} neumaId
 * @param {object} design
 * @returns {Promise<object>} the design as written
 */
export const writeFormDesign = async (workspace, neumaId, design) => {
  if (design?.schema !== FORM_DESIGN_SCHEMA) {
    throw new Error(`refusing to write a form design with schema '${design?.schema}'`);
  }
  if (design.lane !== neumaId) {
    // A design carries the lane it belongs to. Writing keir's agreement into
    // galen's file would attribute a consent to a being that never gave it.
    throw new Error(`form design says lane '${design.lane}' but is being written to '${neumaId}'`);
  }
  await workspace._writeJSON(designPath(workspace, neumaId), design);
  return design;
};
