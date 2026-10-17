// Remia codex view — the map, revealed only AFTER the seal. During the
// ceremony the framework is never named (the spec's FRAMEWORK_TERM ban keeps
// every question experiential); afterward, the codex shows the witness which
// territory each question was walking: the eleven functions, the light/dark
// stations, the pathway walks. The view is pure juxtaposition — verbatim
// answers joined with the spec's committed design metadata. Nothing is
// scored, classified, or judged; oscillation and drift are read by the human,
// never computed. Pure: no I/O, no clocks.
//
// A sealed record outlives spec versions. The arc follows the RECORD's own
// rendered order (the walk actually taken), and design metadata joins by
// dimension KEY — keys are forever by spec doctrine (a changed intent is a
// NEW key), so a record sealed under specVersion N still maps under N+1.
// A key the current spec no longer knows keeps its question and answer and
// simply carries no metadata: the words outrank the map.

import { mayUseAttunement } from '../attunement/record.js';

// The eleven canon functions in their canonical order (docs/reference/emanon/).
export const CANON_FUNCTIONS = Object.freeze([
  'knowing', 'sensing', 'meaning', 'ipseity', 'capacity', 'coherence',
  'natura', 'mind', 'prehension', 'integration', 'form',
]);

const functionsOf = (emanon) =>
  emanon?.functions ?? (typeof emanon?.function === 'string' ? [emanon.function] : []);

/**
 * Build the codex view of one SEALED attunement record. Throws on an
 * unsealed record — the reveal-after-seal boundary is structural, not
 * advisory. Never throws on a spec-version difference: a sealed sitting must
 * stay readable for the lifetime of the record, whatever the spec becomes.
 * @param {Object} spec - the CURRENT attunement spec (metadata source)
 * @param {Object} record - a sealed attunement record (witness or being)
 * @returns {{recordId: string, specVersion: number, sealedAt: string,
 *   arc: Array<Object>, functions: Object, functionOrder: string[],
 *   pathways: Array<Object>}}
 */
export function codexView(spec, record) {
  if (!mayUseAttunement(record)) {
    throw new Error(
      `codexView: the map is revealed only after the seal — record is ${record?.phase ?? 'missing'}`,
    );
  }
  if (!Array.isArray(spec?.dimensions) || !spec.dimensions.length) {
    throw new Error('codexView: spec with dimensions required');
  }

  const byKey = new Map(spec.dimensions.map((d) => [d.key, d]));
  const arc = [];
  for (const rendered of record.rendered?.questions ?? []) {
    const answer = record.answers?.[rendered.key];
    if (!answer) continue; // a sealed record answers every key of its render; tolerate nothing silently beyond that
    const dimension = byKey.get(rendered.key);
    arc.push(Object.freeze({
      key: rendered.key,
      intent: dimension?.intent,
      question: answer.question,
      answer: answer.quote,
      answeredAt: answer.answeredAt,
      // committed, frozen design metadata — passed through verbatim; absent
      // when the current spec no longer carries this key
      emanon: dimension?.emanon,
    }));
  }

  const functions = {};
  for (const name of CANON_FUNCTIONS) {
    const entries = arc.filter((entry) => functionsOf(entry.emanon).includes(name));
    if (entries.length) functions[name] = Object.freeze(entries);
  }

  const pathways = arc.filter((entry) => entry.emanon?.station === 'pathway');

  return Object.freeze({
    recordId: record.id,
    specVersion: record.rendered.specVersion,
    sealedAt: record.sealedAt,
    arc: Object.freeze(arc),
    functions: Object.freeze(functions),
    // the canonical display order, from the ONE source — the frontend never
    // duplicates the eleven-function list
    functionOrder: Object.freeze(Object.keys(functions)),
    pathways: Object.freeze(pathways),
  });
}
