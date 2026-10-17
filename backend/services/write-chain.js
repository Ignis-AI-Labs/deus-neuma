/**
 * The read-modify-write chain every whole-file JSON store needs.
 *
 * A store that reads a map, edits one key and writes the whole map back spans two
 * awaits. Two concurrent mutations for DIFFERENT keys interleave across that gap
 * and the last writer clobbers the first — one caller's change silently vanishes.
 * Each store therefore funnels its mutations through one in-process chain.
 *
 * The repo map flagged this exact body duplicated verbatim across a dozen stores
 * (`node tools/mapview/cli.mjs check` → hoist-candidate `serialize`), so it lives
 * here once; the 16 hand-copied copies were consolidated into it under SIZE-001
 * (each store keeps its OWN chain — a shared chain would serialize unrelated
 * stores against each other).
 *
 * IN-PROCESS ONLY: two processes sharing one file are still last-writer-wins,
 * which is acceptable for re-settable operator preferences and NOT for sovereign
 * data — that lands through the workspace engine, not a whole-file map.
 */

/**
 * Make a serializer: every function handed to it runs after the previous one
 * settled, in call order. A rejected mutation never poisons the chain — the next
 * one still runs.
 * @returns {(fn: () => Promise<*>) => Promise<*>} the serializing runner
 */
export const createWriteChain = () => {
  let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(fn, fn);
    chain = run.then(() => {}, () => {});
    return run;
  };
};
