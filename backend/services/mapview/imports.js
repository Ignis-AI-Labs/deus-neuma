/**
 * mapview/imports — PURE extraction of every form in which one module reaches
 * another. This is the load-bearing edge of the whole map: reachability,
 * orphan detection and the call graph are all built on it, so a form missed
 * here reads downstream as […] — a false alarm that
 * costs more trust than the finding is worth.
 *
 * Five forms, because JavaScript has five:
 *   `import x from './a'`   binding    — an edge with a callable name
 *   `import './a'`          side-effect— an edge with NO name (never a call edge)
 *   `require('./a')`        CJS        — the Electron main process is entirely this
 *   `import('./a')`         dynamic    — lazily loaded, still a real dependency
 *   `export * from './a'`   star       — re-exported surface, still a real edge
 *
 * Every pattern is matched against MASKED text (string/comment contents blanked
 * by maskNonCode) so a specifier inside a comment or a doc string can never
 * invent an edge — then the specifier itself is read back out of the ORIGINAL
 * text at the same index, because masking preserves length and position.
 */
import path from 'path';

/**
 * Resolve a relative import specifier to candidate repo-relative file paths.
 * Bare/package imports return null (not a local edge) — unless the operator
 * declared the prefix in `aliases` (mapview.config.json), the fix for build-tool
 * paths like Vite's `/@kotodama` → `core/kotodama` that are invisible to plain
 * resolution and used to orphan their live targets. Pure given absFile+root.
 */
export const resolveImportCandidates = (absFile, spec, root, aliases = null) => {
  let base;
  if (spec.startsWith('.')) {
    base = path.resolve(path.dirname(absFile), spec);
  } else {
    const hit = aliases && Object.keys(aliases)
      .filter((k) => spec === k || spec.startsWith(`${k}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (!hit) return null;
    base = path.resolve(root, aliases[hit] + spec.slice(hit.length));
  }
  const rel = (p) => path.relative(root, p) || path.basename(p);
  // Candidate extensions mirror CODE_EXT so an import can resolve to any file the
  // walk actually scans (notably .cjs — Electron preload/IPC lives in .cjs files).
  return [
    base, base + '.js', base + '.mjs', base + '.cjs', base + '.jsx', base + '.ts', base + '.tsx',
    path.join(base, 'index.js'), path.join(base, 'index.mjs'), path.join(base, 'index.cjs'),
    path.join(base, 'index.jsx'), path.join(base, 'index.tsx'), path.join(base, 'index.ts'),
  ].map(rel);
};

/**
 * Read the string literal whose opening quote sits at `quoteIdx`. Safe against
 * the masked/original split: maskNonCode is length- and index-preserving, so an
 * index found in masked text addresses the same character in the original.
 * A literal cannot contain its own unescaped delimiter, so indexOf terminates it.
 * Pure.
 */
const readLiteral = (original, quoteIdx) => {
  const quote = original[quoteIdx];
  if (quote !== "'" && quote !== '"') return null;
  const end = original.indexOf(quote, quoteIdx + 1);
  return end < 0 ? null : original.slice(quoteIdx + 1, end);
};

/**
 * Split an `{ a, b as c }` clause into `{ source, local }` pairs. The LOCAL name
 * is what the importing file binds (call attribution needs it); the SOURCE name
 * is what the target file exports (dead-export analysis needs it). Keeping only
 * one of the two was the bug that reported every aliased-imported export dead —
 * three whole modules read as corpses because their importers alias as house
 * style. Pure.
 */
const bindingPairs = (clause) => clause
  .split(',')
  .map((raw) => {
    const parts = raw.trim().split(/\s+as\s+/).map((s) => s.trim());
    return { source: parts[0], local: parts[parts.length - 1] };
  })
  .filter((p) => p.local);

/** The local names only — what a clause binds into scope. Pure. */
const bindingNames = (clause) => bindingPairs(clause).map((p) => p.local);

/**
 * The identifier(s) a `require(...)` result is assigned to, by looking back from
 * the call for `const X =` or `const { a, b } =`. Bounded to the 200 characters
 * before the call so this stays linear. A bare `require('./a')` (side-effect
 * form, no assignment) yields no names — an edge with no call attribution.
 * Pure.
 */
const requireBindings = (original, callIdx) => {
  const before = original.slice(Math.max(0, callIdx - 200), callIdx);
  const assign = before.match(/(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*$/);
  if (!assign) return [];
  const target = assign[1];
  return target.startsWith('{') ? bindingNames(target.slice(1, -1)) : [target];
};

/**
 * Every module reference the file declares, as
 * `[{ varName, spec, candidates, kind }]`. `varName` is null when the form binds
 * no callable name (side-effect, unassigned dynamic/require, star re-export) —
 * the graph must still draw the module edge but must NOT attribute call edges to
 * it. Pure given absFile+root.
 */
export const extractModuleRefs = (original, masked, absFile, root, aliases = null) => {
  const out = [];
  const push = (varName, spec, kind, binding, sourceName = null) => {
    if (!spec) return;
    out.push({ varName, spec, candidates: resolveImportCandidates(absFile, spec, root, aliases) || [], kind, binding, sourceName });
  };
  // The quote that opens the specifier is the last character every pattern below
  // captures, so its index is always `m.index + m[0].length - 1`.
  const specAt = (m) => readLiteral(original, m.index + m[0].length - 1);
  let m;

  // `import x from './a'` / `import { a, b } from` / `import x, { y } from` / `import * as ns from`
  const bound = /import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*\{([^}]*)\}|([A-Za-z_$][\w$]*)\s*,\s*\*\s*as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\}|\*\s*as\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*))\s+from\s*['"]/g;
  while ((m = bound.exec(masked))) {
    const spec = specAt(m);
    // `binding` records HOW the name was bound, which downstream dead-export
    // analysis depends on: a default or namespace import can reference an export
    // under any local name, so those targets can never be judged by name.
    if (m[1]) push(m[1], spec, 'import', 'default');
    if (m[2]) for (const p of bindingPairs(m[2])) push(p.local, spec, 'import', 'named', p.source);
    if (m[3]) push(m[3], spec, 'import', 'default');
    if (m[4]) push(m[4], spec, 'import', 'namespace');
    if (m[5]) for (const p of bindingPairs(m[5])) push(p.local, spec, 'import', 'named', p.source);
    if (m[6]) push(m[6], spec, 'import', 'namespace');
    if (m[7]) push(m[7], spec, 'import', 'default');
  }

  // `import './a'` — no binding, pure side effect. Still a hard dependency: the
  // module is evaluated, and dropping it would change behaviour.
  const sideEffect = /(?:^|[\n;])[ \t]*import\s*['"]/gm;
  while ((m = sideEffect.exec(masked))) push(null, specAt(m), 'side-effect', 'none');

  // `require('./a')` — the `[^\w.]` guard keeps `createRequire(` and
  // `require.resolve(` out; the assignment lookback recovers the bound name.
  // A destructured require names its exports; a whole-module one does not, so it
  // is treated as a default binding (any local name may stand for the module).
  const req = /(?:^|[^\w.])require\s*\(\s*['"]/g;
  while ((m = req.exec(masked))) {
    const spec = specAt(m);
    const destructured = /(?:const|let|var)\s+\{[^}]*\}\s*=\s*$/.test(original.slice(Math.max(0, m.index - 200), m.index));
    const names = requireBindings(original, m.index);
    if (!names.length) push(null, spec, 'require', 'none');
    for (const varName of names) push(varName, spec, 'require', destructured ? 'named' : 'default');
  }

  // `import('./a')` — lazy, but a real edge. Names are not bound at the call
  // site in the common `await import(...)` form, so no call attribution.
  const dynamic = /\bimport\s*\(\s*['"]/g;
  while ((m = dynamic.exec(masked))) push(null, specAt(m), 'dynamic', 'namespace');

  // `export * from './a'` / `export * as ns from './a'` — re-exported surface.
  // The names are unknowable without the target's export list, so this carries no
  // varName; it exists so the target is not falsely reported as unreachable.
  const star = /export\s*\*(?:\s*as\s+[A-Za-z_$][\w$]*)?\s*from\s*['"]/g;
  while ((m = star.exec(masked))) push(null, specAt(m), 'star-reexport', 'namespace');

  // `export { a, b as c } from './a'` — the named-barrel form. This is a REAL
  // module edge: the target is evaluated and its surface flows onward. Missing
  // it orphaned an entire live persistence lane behind a 12-line shim whose only
  // statement was `export { default } from './platform-db.js'`. Name usage is
  // NOT credited here (extractReexports carries the names precisely); binding
  // 'reexport' tells the usage pass to skip this ref rather than mark the
  // target opaque.
  const namedFrom = /export\s*\{[^}]*\}\s*from\s*['"]/g;
  while ((m = namedFrom.exec(masked))) push(null, specAt(m), 'reexport', 'reexport');

  return out;
};

/**
 * Barrel re-exports: `[{ name, candidates }]` for `export { A, B as C } from './x'`.
 * `name` is the identifier an IMPORTER references (the alias when present), which
 * lets the graph follow a barrel through to the real defining file so call edges
 * attribute to the module that owns the code rather than the pass-through barrel.
 *
 * Bounded, documented limitation: the bare `export { default } from` form is keyed
 * as 'default', which an importer's arbitrary default-import name cannot match, so
 * such a barrel still reads as a hub. The aliased `export { default as X }` idiom
 * works. `export *` is handled by extractModuleRefs as an edge without names —
 * resolving its bindings would require the target's export list. Pure.
 */
export const extractReexports = (original, masked, absFile, root, aliases = null) => {
  const out = [];
  const re = /export\s*\{([^}]*)\}\s*from\s*['"]/g;
  let m;
  while ((m = re.exec(masked))) {
    const spec = readLiteral(original, m.index + m[0].length - 1);
    if (!spec) continue;
    const candidates = resolveImportCandidates(absFile, spec, root, aliases) || [];
    if (!candidates.length) continue;
    // `name` = what an IMPORTER of this barrel references (the alias);
    // `sourceName` = what the barrel pulls from the TARGET file. Dead-export
    // analysis must credit the target with sourceName — crediting the alias
    // reported re-exported symbols dead under their real names.
    for (const p of bindingPairs(m[1])) out.push({ name: p.local, sourceName: p.source, candidates });
  }
  return out;
};
