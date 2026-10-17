// One shared rule for every refinement record that will be canonically hashed:
// the record must be a TREE.
//
// Canonicalisation runs with alias rejection on, so an authority object sitting
// at two places in one record — the record's root and its event log, a live
// projection and the history list it was appended to — refuses at the digest
// rather than hashing ambiguously. Whichever side is the COPY takes a detached
// clone. `structuredClone` returns a MUTABLE clone, so it is frozen through.
//
// This is its own module because the rule was already learned twice in one
// file: once for the ceremony opening authority, then again for the consent
// evidence, because a helper private to one function is a rule the next
// function does not inherit. Import it; do not re-derive it.

const freezeTree = (node) => {
  if (node && typeof node === 'object') Object.values(Object.freeze(node)).forEach(freezeTree);
  return node;
};

/** A frozen deep copy that shares no object with its source. Pure. */
export const detachedAuthority = (value) => freezeTree(structuredClone(value));
