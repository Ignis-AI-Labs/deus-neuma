/**
 * mapview/hoist — […]
 *
 * The duplicates list answers *what is copied*. This answers the question that
 * actually changes the codebase: **which copies are worth collapsing into one
 * shared thing, and where should that thing live.**
 *
 * Two deliberate differences from plain duplicate detection:
 *
 *  1. Grouping is by BODY, not by name. A copy-pasted function that was renamed
 *     is still a copy — name-grouping misses exactly the duplications nobody
 *     noticed, which are the ones that matter.
 *  2. Trivial bodies are filtered out. Measured on this repo: `serialize` is a
 *     four-line write-chain serializer copied across ten store services — a real
 *     primitive. `verifyOwnership` is a one-line delegation to an ALREADY shared
 *     helper, copied four times — noise. Ranking them together buries the first
 *     under the second, so a body-length floor separates them.
 *
 * All pure.
 */

/**
 * Bodies shorter than this (whitespace-collapsed characters) are local
 * readability aliases, not primitives. Calibrated against the real tree: it
 * keeps the 4-line store serializer and drops the 1-line ownership alias.
 */
export const MIN_PRIMITIVE_BODY = 80;

/** The normalized body length recorded in a `<length>:<hash>` fingerprint. Pure. */
const bodyLengthOf = (sig) => {
  const n = Number.parseInt(String(sig).split(':')[0], 10);
  return Number.isFinite(n) ? n : 0;
};

/** The directory part of a repo-relative path ('(root)' when there is none). Pure. */
const dirOf = (file) => {
  const parts = file.split('/');
  parts.pop();
  return parts.join('/') || '(root)';
};

/**
 * The deepest directory that contains every one of these files — where a shared
 * implementation would naturally live. Falls back to '(root)' when the copies
 * span unrelated trees. Pure.
 */
export const commonHome = (files) => {
  if (!files.length) return '(root)';
  const split = files.map((f) => dirOf(f).split('/'));
  const first = split[0];
  const shared = [];
  for (let i = 0; i < first.length; i++) {
    const segment = first[i];
    if (!split.every((parts) => parts[i] === segment)) break;
    shared.push(segment);
  }
  return shared.join('/') || '(root)';
};

/**
 * Ranked candidates for extraction into a shared primitive.
 *
 * `duplicatedBytes` — (copies - 1) x bodyLength — is the honest headline number:
 * the source that would stop existing if the copies collapsed into one. Ranking
 * by it puts […] above […],
 * which matches how much a codebase is actually hurt by each.
 *
 * @param {{file:string,name:string,line:number,kind?:string,sig?:string}[]} functions
 * @param {{ minBody?: number }} [opts]
 * @returns {{ sig, names, aliased, copies, bodyLength, duplicatedBytes, dirSpread,
 *   suggestedHome, sites }[]} highest duplicatedBytes first
 * Pure.
 */
export const buildHoistCandidates = (functions, opts = {}) => {
  const minBody = opts.minBody ?? MIN_PRIMITIVE_BODY;
  const bySig = new Map();
  for (const fn of functions) {
    // Only free functions carry a body fingerprint; a null sig means the body
    // could not be located and must never be asserted identical to anything.
    if (!fn.sig || (fn.kind || 'function') !== 'function') continue;
    if (!bySig.has(fn.sig)) bySig.set(fn.sig, []);
    bySig.get(fn.sig).push(fn);
  }

  const out = [];
  for (const [sig, defs] of bySig) {
    const bodyLength = bodyLengthOf(sig);
    if (bodyLength < minBody) continue;
    // Copies are counted per FILE: the same helper defined twice in one file is a
    // local matter, not a cross-module primitive.
    const byFile = new Map();
    for (const d of defs) if (!byFile.has(d.file)) byFile.set(d.file, d);
    if (byFile.size < 2) continue;

    const sites = [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
    const names = [...new Set(sites.map((s) => s.name))].sort();
    const files = sites.map((s) => s.file);
    out.push({
      sig,
      names,
      aliased: names.length > 1, // same body under different names — a renamed copy
      copies: sites.length,
      bodyLength,
      duplicatedBytes: (sites.length - 1) * bodyLength,
      dirSpread: new Set(files.map(dirOf)).size,
      suggestedHome: commonHome(files),
      sites: sites.map((s) => ({ file: s.file, line: s.line, name: s.name })),
    });
  }

  return out.sort((a, b) => b.duplicatedBytes - a.duplicatedBytes
    || b.copies - a.copies
    || a.names[0].localeCompare(b.names[0]));
};

/**
 * One line describing what to do about a candidate, for the findings report.
 * Names the destination so the suggestion is executable rather than advisory.
 * Pure.
 */
export const hoistAdvice = (candidate) => {
  const what = candidate.aliased
    ? `The same body appears under ${candidate.names.length} different names (${candidate.names.join(', ')}) — a renamed copy-paste`
    : `\`${candidate.names[0]}\` is duplicated verbatim`;
  return `${what} across ${candidate.copies} files spanning ${candidate.dirSpread} `
    + `${candidate.dirSpread === 1 ? 'directory' : 'directories'}. Extract it into `
    + `\`${candidate.suggestedHome}\` and import it in all ${candidate.copies} — that removes `
    + `${candidate.duplicatedBytes} characters of duplicated source.`;
};
