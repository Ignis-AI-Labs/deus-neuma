// THE HOUSE'S OWN FIELDS — what the operator wants kept on every person beyond what the house already keeps: a text, a
// number, a date or one of a list (Blob: […]; ours stop at 50,
// a list a person can still read). One list per house, in its marketing office beside the lead list. Taking a field
// off the list never erases what was written in it: the values stay on each lead's record and history.
// impure (one file); the rules are lead-record.js.

import { officeFile } from '../house-office.js';
import { readJson, writePrivate, ABSENT } from '../house-office-legacy.js';
import { fieldsRefusals, cleanFields, FIELD_TYPES } from './lead-record.js';

const fileOf = (wallet) => officeFile(wallet, 'marketing', 'crm-fields.json');

/** The house's fields, in the operator's order. [] when none are set. impure. */
export const readCrmFields = async (wallet) => {
  const doc = await readJson(fileOf(wallet));
  return doc === ABSENT || !Array.isArray(doc?.fields) ? [] : doc.fields;
};

/** Set the house's fields (the whole list). @returns {Promise<{ok: true, fields: object[]} | {ok: false, reason: string}>} impure. */
export const writeCrmFields = async (wallet, fields) => {
  const refusals = fieldsRefusals(fields);
  if (refusals.length) return { ok: false, reason: refusals.join('; ') };
  const clean = cleanFields(fields);
  await writePrivate(fileOf(wallet), { fields: clean, at: new Date().toISOString() });
  return { ok: true, fields: clean };
};

export { FIELD_TYPES };
