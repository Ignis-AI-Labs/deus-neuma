// doc-fence.js — one home for the markdown code-fence sizer (SIZE-005).
// Was duplicated as `fenceFor` (project-files.js) and `_docFence`
// (portal-stream.js) — identical bodies, two names.

/**
 * pure — fence a body with a backtick run longer than any inside it, so a
 * document's own code fence can never break out of its block.
 * @param {string} body
 * @returns {string} the fence string (always at least three backticks)
 */
export const docFence = (body) => {
  let longest = 0;
  for (const run of body.match(/`+/g) || []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
};
