// Incremental sync planner for generated vault notes. Pure: desired note
// models + an index of what's on disk in, a plan out. The invariant that
// matters: a note a human has edited in the vault is NEVER overwritten —
// hand edits win until the human deletes the note or passes --force.
//
// Existing-file index entries carry:
//   sourceHash     — source_hash stamped in the file's frontmatter
//   stampedBodyHash — body_hash stamped in the file's frontmatter
//   actualBodyHash — hash of the body as it exists on disk now
// stamped ≠ actual ⇒ the note was hand-edited after generation.

/**
 * @param {ReadonlyArray<{ relPath: string, sourceHash: string }>} desired
 * @param {Map<string, { sourceHash: string, stampedBodyHash: string, actualBodyHash: string }>} existing
 * @param {{ force?: boolean }} [opts]
 * @returns {{ creates: object[], updates: object[], preserved: string[], unchanged: number }}
 */
export const planSync = (desired, existing, { force = false } = {}) => {
  const creates = [];
  const updates = [];
  const preserved = [];
  let unchanged = 0;

  for (const note of desired) {
    const current = existing.get(note.relPath);
    if (!current) {
      creates.push(note);
      continue;
    }
    const handEdited = current.stampedBodyHash !== current.actualBodyHash;
    if (handEdited && !force) {
      preserved.push(note.relPath);
      continue;
    }
    if (current.sourceHash === note.sourceHash && !handEdited) {
      unchanged += 1;
      continue;
    }
    updates.push(note);
  }

  return Object.freeze({
    creates: Object.freeze(creates),
    updates: Object.freeze(updates),
    preserved: Object.freeze(preserved),
    unchanged,
  });
};
