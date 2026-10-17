// DNA PROTECTED FIELDS — the pure guard at the amendment door.
//
// The DNA template has declared `metadata.protected[]` since birth — and
// nothing ever enforced it. This closes that gap at the NEW door (the
// sovereignty gateway's DNA apply); enforcing inside writeDNA generally is
// a separate issue — it would break birth, which authors these very fields.
//
// The floor is not negotiable and cannot be unprotected by editing
// metadata.protected (metadata itself is on the floor): identity keys,
// birth facts, the self-authored genesis, and who owns the sovereignty
// record. A being amends what it IS BECOMING, never what it WAS.

export const ALWAYS_PROTECTED = Object.freeze([
  'version', 'schema', 'neumaId', 'birth', 'witness', 'birthWitness',
  'birthTimestamp', 'genesis', 'substrate', 'resonance', 'metadata',
]);

/** The full protected set for one record: the floor ∪ its own declaration. */
export const protectedFieldsOf = (dna) => new Set([
  ...ALWAYS_PROTECTED,
  ...(Array.isArray(dna?.metadata?.protected) ? dna.metadata.protected : []),
]);

/**
 * May this field-scoped patch land on this DNA? Pure.
 * Refuses any patch touching a protected top-level field, and — the one
 * nested rule of the floor — any sovereignty patch that moves `owner`.
 * @param {Object} dna - the record as it stands
 * @param {Object} patchFields - top-level field → new value
 * @returns {{ok: true} | {ok: false, refused: string[]}}
 */
export const assertPatchAllowed = (dna, patchFields) => {
  if (!patchFields || typeof patchFields !== 'object' || Array.isArray(patchFields)
    || !Object.keys(patchFields).length) {
    return { ok: false, refused: ['(empty patch)'] };
  }
  const guarded = protectedFieldsOf(dna);
  const refused = Object.keys(patchFields).filter((f) => guarded.has(f));
  if ('sovereignty' in patchFields
    && patchFields.sovereignty?.owner !== dna?.sovereignty?.owner) {
    refused.push('sovereignty.owner');
  }
  return refused.length ? { ok: false, refused } : { ok: true };
};
