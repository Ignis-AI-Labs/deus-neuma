/**
 * mapview/reach — […]
 *
 * The map already knows which module imports which. This turns that into the
 * question a developer actually asks: can I get here from something that
 * executes? A file nothing imports is NOT automatically dead — it may be the
 * thing that starts the program. So reachability is only meaningful once entry
 * points are known, and entry detection must be GENEROUS: a missed entry point
 * reports its whole dependency tree as dead code, which is the single most
 * expensive way for this tool to be wrong. Every rule below errs toward calling
 * something an entry.
 *
 * Everything here is pure. The impure work (reading package.json, globbing HTML)
 * happens in scan.js and is handed in as plain data.
 */

/**
 * Root-level tooling configs execute under their own runner and are never
 * imported: `vite.config.js`, `vitest.config.js`, and the dotfile rc form
 * (`.eslintrc.cjs`, `.prettierrc.js`).
 */
const CONFIG_FILE_RE = /^(?:[^/]*\.config\.[cm]?[jt]s|\.[\w-]+rc\.[cm]?[jt]sx?)$/;
/** A file directly under scripts/ is run as a command; each is its own entry. */
const SCRIPT_DIR_RE = /^scripts\//;

/**
 * Turn a package.json `bin` field into the paths it points at — it is either a
 * single path string or a map of command name → path. Pure.
 */
const binPaths = (bin) => {
  if (!bin) return [];
  if (typeof bin === 'string') return [bin];
  return typeof bin === 'object' ? Object.values(bin).filter((v) => typeof v === 'string') : [];
};

/**
 * Every path mentioned anywhere in a package.json `exports` tree, which nests
 * arbitrarily deep (conditions, subpath maps, arrays). Pure.
 */
const exportsPaths = (node, acc = []) => {
  if (typeof node === 'string') acc.push(node);
  else if (Array.isArray(node)) for (const v of node) exportsPaths(v, acc);
  else if (node && typeof node === 'object') for (const v of Object.values(node)) exportsPaths(v, acc);
  return acc;
};

/** Strip a leading './' so a manifest path can be compared to a repo-relative one. Pure. */
const normalize = (p) => String(p).replace(/^\.\//, '').replace(/^\//, '');

/**
 * The files that START execution, each with the reason it counts — the reason is
 * surfaced so a developer can audit the entry set rather than trust it. Any file
 * a `run` script or an HTML `<script src>` points at is an entry, as is anything
 * the operator names in `mapview.config.json`.
 *
 * @param {{ files: string[], packageJson?: object, htmlScriptSrcs?: string[], configEntries?: string[] }} input
 * @returns {{ file: string, reason: string }[]} sorted, de-duplicated
 * Pure.
 */
export const detectEntryPoints = ({ files, packageJson = {}, htmlScriptSrcs = [], configEntries = [] }) => {
  const known = new Set(files);
  const found = new Map(); // file -> reason (first reason wins, most specific first)
  const claim = (raw, reason) => {
    const file = normalize(raw);
    if (known.has(file) && !found.has(file)) found.set(file, reason);
  };

  for (const p of configEntries) claim(p, 'declared in mapview.config.json');
  for (const p of binPaths(packageJson.bin)) claim(p, 'package.json bin');
  claim(packageJson.main, 'package.json main');
  claim(packageJson.module, 'package.json module');
  for (const p of exportsPaths(packageJson.exports)) claim(p, 'package.json exports');
  for (const src of htmlScriptSrcs) claim(src, 'HTML <script src>');

  // npm scripts name their runtime target inline (`node backend/server.js`), so
  // any scanned path appearing in a script body is an entry.
  for (const [name, body] of Object.entries(packageJson.scripts || {})) {
    if (typeof body !== 'string') continue;
    for (const token of body.split(/[\s'"]+/)) {
      if (token.includes('/') || CONFIG_FILE_RE.test(token)) claim(token, `package.json script "${name}"`);
    }
  }

  for (const file of files) {
    if (CONFIG_FILE_RE.test(file)) claim(file, 'root tooling config');
    else if (SCRIPT_DIR_RE.test(file)) claim(file, 'runnable script');
  }

  return [...found.entries()]
    .map(([file, reason]) => ({ file, reason }))
    .sort((a, b) => a.file.localeCompare(b.file));
};

/**
 * Files reachable from the entry set by following module edges, and the ones
 * that are not. `unreachable` is the honest "disconnected" list: nothing that
 * runs can get here, so it is dead surface or a missed entry point.
 *
 * @param {{from:string,to:string}[]} modules
 * @param {string[]} entryFiles
 * @param {string[]} allFiles
 * Pure.
 */
export const computeReachability = (modules, entryFiles, allFiles) => {
  const out = new Map(); // from -> [to]
  for (const e of modules) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
  }
  const reachable = new Set();
  const queue = entryFiles.filter((f) => allFiles.includes(f));
  for (const f of queue) reachable.add(f);
  // Iterative BFS — a deep or cyclic import graph must never blow the stack.
  for (let i = 0; i < queue.length; i++) {
    for (const next of out.get(queue[i]) || []) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      queue.push(next);
    }
  }
  return { reachable, unreachable: allFiles.filter((f) => !reachable.has(f)).sort() };
};

/**
 * Import cycles — groups of files that transitively import each other. Tarjan's
 * strongly-connected components, iterative so a deep graph cannot overflow the
 * stack. A cycle is not automatically a bug (ESM tolerates many), but it is the
 * thing that makes a module impossible to extract, test, or reason about alone.
 *
 * @param {{from:string,to:string}[]} modules
 * @returns {string[][]} each cycle, sorted, longest first
 * Pure.
 */
export const findCycles = (modules) => {
  const adj = new Map();
  const nodes = new Set();
  for (const e of modules) {
    nodes.add(e.from); nodes.add(e.to);
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
  const index = new Map(), low = new Map(), onStack = new Set();
  const stack = [];
  const cycles = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    // Explicit work stack: each frame tracks how far through its children we are.
    const work = [{ node: root, childIdx: 0 }];
    while (work.length) {
      const frame = work[work.length - 1];
      const { node } = frame;
      if (frame.childIdx === 0) {
        index.set(node, counter); low.set(node, counter); counter += 1;
        stack.push(node); onStack.add(node);
      }
      const children = adj.get(node) || [];
      if (frame.childIdx < children.length) {
        const child = children[frame.childIdx];
        frame.childIdx += 1;
        if (!index.has(child)) work.push({ node: child, childIdx: 0 });
        else if (onStack.has(child)) low.set(node, Math.min(low.get(node), index.get(child)));
        continue;
      }
      // All children done — this frame is a root of an SCC if low === index.
      if (low.get(node) === index.get(node)) {
        const component = [];
        let popped;
        do { popped = stack.pop(); onStack.delete(popped); component.push(popped); } while (popped !== node);
        if (component.length > 1) cycles.push(component.sort());
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent), low.get(node)));
      }
    }
  }
  return cycles.sort((a, b) => b.length - a.length);
};

/**
 * Export-usage evidence for dead-export analysis. `namedBy` records, per target
 * file, the export names other modules import from it by name — the SOURCE name
 * (what the target exports), followed through barrels with each hop's alias
 * translation applied. Crediting the importer's LOCAL alias instead was the bug
 * that read three aliased-imported modules as corpses. `opaque` collects files
 * whose exports cannot be judged by name at all: default/namespace/dynamic
 * imports and star re-exports let a consumer reference an export under a name
 * this scan will never see.
 *
 * `kind === 'reexport'` refs (`export { x } from`) carry the module edge only;
 * their names arrive precisely via record.reexports, so they are skipped here
 * rather than opaquing their target. Test files (usageFiles) count toward usage
 * and nothing else — a module only tests reach still reports as dead production
 * code, which is the honest reading. Pure.
 */
export const buildUsage = ({ importsOf, files, usageFiles, fileSet, throughBarrel }) => {
  const namedBy = new Map();
  const opaque = new Set();
  const noteUsage = (to, name, binding) => {
    if (!to) return;
    if (binding === 'named' && name) {
      if (!namedBy.has(to)) namedBy.set(to, new Set());
      namedBy.get(to).add(name);
    } else opaque.add(to);
  };
  const creditImport = (imp) => {
    if (imp.kind === 'reexport') return;
    const resolved = imp.candidates.find((c) => fileSet.has(c));
    if (!resolved) return;
    if (imp.binding === 'named' && imp.varName) {
      const followed = throughBarrel(resolved, imp.sourceName || imp.varName);
      noteUsage(followed.file, followed.name, 'named');
      return;
    }
    noteUsage(imp.varName ? throughBarrel(resolved, imp.varName).file : resolved, imp.varName, imp.binding);
  };
  for (const [, imps] of importsOf) for (const imp of imps) creditImport(imp);
  // A barrel's `export { X as Y } from './x'` is a by-name reference to X —
  // usage under the SOURCE name, so a re-exported symbol is never reported dead
  // under the name it actually carries.
  for (const { record } of files) {
    for (const rx of (record.reexports || [])) {
      noteUsage(rx.candidates.find((c) => fileSet.has(c)), rx.sourceName || rx.name, 'named');
    }
  }
  for (const { record } of usageFiles) for (const imp of record.imports) creditImport(imp);
  return { namedBy, opaque };
};

/**
 * Named exports that no other module imports BY NAME from the defining file.
 *
 * Deliberately conservative — a false "delete this" is far more damaging than a
 * miss, so a file is exempted entirely when any of these make name-matching
 * unsound: it is default-imported (the importer picks its own local name), it is
 * namespace-imported or dynamically imported (`ns.anything` is unobservable), it
 * is star-re-exported (its names flow onward invisibly), or it is an entry point
 * (its exports are the program's own surface).
 *
 * @param {{file:string,name:string,exported:boolean,kind:string,line:number}[]} functions
 * @param {{ namedBy: Map<string, Set<string>>, opaque: Set<string> }} usage
 * @param {Set<string>} entryFiles
 * Pure.
 */
export const findDeadExports = (functions, usage, entryFiles) => functions
  .filter((f) => f.exported && (f.kind || 'function') !== 'method')
  .filter((f) => !entryFiles.has(f.file) && !usage.opaque.has(f.file))
  .filter((f) => !(usage.namedBy.get(f.file) || new Set()).has(f.name))
  .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
