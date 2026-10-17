// genesis-write.js — pure: THE one selector for a crystallization stage's
// genesis write. Shared by capture (staged-birth-handler) and path rebase
// (ceremony-write.canonicalizeBirthCalls) so landed path and sealed content
// always refer to the same call.

/**
 * Pick the genesis write from a stage-5 call list.
 * Contentful fs/write only (`write` — the retired `write_file` spelling is
 * still recognized for in-flight ceremonies and dialect drift). Prefer
 * `*genesis.md`, else a .md or /dna/ path, else a pathless contentful write
 * (parse recovered content but lost path — ceremony-write rebases it onto
 * genesis.md).
 * @param {Array<{toolName?: string, args?: {path?: string, content?: string}}>} calls
 * @returns {object|null}
 */
export const pickGenesisWrite = (calls) => {
  const writes = (calls || []).filter(
    (tc) => (tc?.toolName === 'write' || tc?.toolName === 'write_file') && tc.args?.content,
  );
  const withPath = writes.filter((tc) => typeof tc.args?.path === 'string' && tc.args.path.length > 0);
  return (
    withPath.find((tc) => /genesis\.md$/i.test(String(tc.args.path || ''))) ||
    withPath.find((tc) => {
      const p = String(tc.args.path || '').toLowerCase();
      return p.endsWith('.md') || p.includes('/dna/');
    }) ||
    writes.find((tc) => !tc.args?.path || String(tc.args.path).length === 0) ||
    null
  );
};
