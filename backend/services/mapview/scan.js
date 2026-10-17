/**
 * mapview/scan — the one IMPURE edge: walk a directory, read source files, and
 * hand each to the pure extractor, then to the pure graph assembler. Everything
 * that touches the filesystem lives here; extract.js and graph.js stay pure.
 */
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { CODE_EXT, extractFile } from './extract.js';
import { buildGraph } from './graph.js';
import { buildFindings } from './findings.js';
import { annotateConfirmations } from './confirm.js';
import { BASELINE_RELPATH, diffAgainstBaseline } from './delta.js';
import { RETIRED_TOOL_HINTS } from '../intents/retired-tools.js';

const SKIP_DIRS = Object.freeze(new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', '.turbo',
  '.cache', 'vendor', '.venv', 'venv', '__pycache__', '.sc', 'artifacts', 'cache',
  'typechain-types', '.vercel', 'public',
]));
const TEST_DIRS = Object.freeze(new Set(['test', 'tests', '__tests__', 'e2e', 'spec', '__mocks__']));
// Retired code is a TOP-LEVEL convention (`<root>/archive`). Skipping it stops
// dead channels being invented, but the skip is scoped to the root only — a
// nested `routes/archive/` in some other repo is live code and must be mapped.
//
// `release` joins it for the same reason and a sharper one: it is
// electron-builder's `directories.output`, and because the app ships with
// `asar: false` a packaged build drops a COMPLETE second (and, once Windows is
// built, third) copy of backend/ and core/ inside it. From 2026-08-01 every
// edit to a supervisor or route reported its own functions as […] and every express route as "registered 3×" — the
// scanner reading our own shipped output as rival source. Root-scoped, so a
// nested `<pkg>/release/` elsewhere still maps.
const ROOT_ONLY_SKIP = Object.freeze(new Set(['archive', 'release']));
const isTestFile = (name) => /\.(test|spec|e2e)\.[jt]sx?$/.test(name);
const READ_BATCH = 64;

/** Per-repo mapview law: declared entry points and the signed layer rules. */
export const CONFIG_FILENAME = 'mapview.config.json';

/**
 * Walk the tree yielding `{ abs, isTest }`. Tests are ALWAYS yielded, tagged —
 * they are excluded from the production surface (they describe it, they are not
 * it) but their imports are the only evidence that an export is used at all.
 * Dropping them at the walk cost 402 of 488 "dead export" findings to false
 * positives, so the caller partitions rather than the walk discarding.
 */
// impure — filesystem walk
export async function* walk(dir, opts) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Hidden directories (.git, .ai6, .cache, scratch tooling) are convention
      // for non-source: skipping them keeps retired excerpts and tool state off
      // the live map. This is the standard scanner default (ripgrep et al.).
      if (e.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      if (dir === opts.root && ROOT_ONLY_SKIP.has(e.name)) continue;
      // A declared exclude is pruned HERE, not filtered after: every file under
      // it was dropped anyway, but walking benchmarks/sources alone was 18k
      // directories and ~0.7 s of every scan (2026-10-05).
      if (opts.isExcluded?.(path.relative(opts.root, full))) continue;
      yield* walk(full, { ...opts, inTestDir: opts.inTestDir || TEST_DIRS.has(e.name) });
    } else if (e.isFile() && CODE_EXT.has(path.extname(e.name))) {
      yield { abs: full, isTest: Boolean(opts.inTestDir) || isTestFile(e.name) };
    }
  }
}

/** Read and parse a JSON file, or return null when absent/unparseable. */
// impure — reads the filesystem
const readJson = async (absPath) => {
  try { return JSON.parse(await fs.readFile(absPath, 'utf8')); } catch { return null; }
};

/**
 * The module paths an HTML page loads via `<script type="module" src="...">`.
 * A Vite app's true entry point is named nowhere but its index.html, so without
 * this the entire frontend tree reads as unreachable. Only root-level and
 * one-level-deep pages are read — deep HTML fixtures are not app entry points.
 */
// impure — reads the filesystem
const htmlEntrySrcs = async (absRoot) => {
  const out = [];
  const pages = [];
  for (const dir of ['', 'frontend', 'public', 'src']) {
    const abs = path.join(absRoot, dir);
    const entries = await fs.readdir(abs, { withFileTypes: true }).catch(() => []);
    for (const e of entries) if (e.isFile() && e.name.endsWith('.html')) pages.push({ dir, abs: path.join(abs, e.name) });
  }
  // Electron windows load documents from ANYWHERE under electron/
  // (BrowserWindow.loadFile), so that tree is walked in full — a page there IS
  // a window, and its scripts are real entries. The wallet confirm window
  // (electron/wallet/confirm.html → confirm.js) read as dead before this.
  const walkHtml = async (dir) => {
    const entries = await fs.readdir(path.join(absRoot, dir), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) await walkHtml(rel);
      else if (e.isFile() && e.name.endsWith('.html')) pages.push({ dir, abs: path.join(absRoot, rel) });
    }
  };
  await walkHtml('electron');
  for (const page of pages) {
    const text = await fs.readFile(page.abs, 'utf8').catch(() => null);
    if (!text) continue;
    for (const m of text.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)) {
      const src = m[1];
      if (/^[a-z]+:\/\//i.test(src)) continue; // a CDN script is not a local entry
      // Resolve against the page's own directory, then make it repo-relative.
      const abs = path.resolve(path.dirname(page.abs), src.replace(/^\//, './'));
      out.push(path.relative(absRoot, abs));
    }
  }
  return out;
};

/**
 * Scan a directory into an architecture graph.
 * @param {string} root - absolute directory to scan
 * @param {{ includeTests?: boolean }} [opts]
 * @returns {Promise<object>} the graph (see graph.js)
 */
// impure — reads the filesystem
export const scanArchitecture = async (root, opts = {}) => {
  const absRoot = path.resolve(root);
  const rel = (p) => path.relative(absRoot, p) || path.basename(p);
  // Repo law and manifest are read FIRST — the walk and the extractor both take
  // direction from them (declared excludes, import aliases, bin entries).
  const packageJson = await readJson(path.join(absRoot, 'package.json')) || {};
  const config = await readJson(path.join(absRoot, CONFIG_FILENAME)) || {};
  const aliases = (config.aliases && typeof config.aliases === 'object') ? config.aliases : null;
  // Declared non-source trees (vendored benchmark sources, gitignored scratch):
  // scanning them buried the report — 31% of one dead-export run was noise from
  // code this repo does not own or has already disowned.
  const excluded = Array.isArray(config.excludePaths) ? config.excludePaths : [];
  const isExcluded = (rf) => excluded.some((p) => rf === p || rf.startsWith(`${p}/`));

  const found = [];
  for await (const f of walk(absRoot, { ...opts, root: absRoot, isExcluded })) found.push(f);

  // `package.json bin` targets are real programs but usually carry no extension,
  // so the walk never yields them — which used to orphan every tree reachable
  // only through a bin shim (all 22 cli/ files read as dead). Read them in.
  const binValues = typeof packageJson.bin === 'string'
    ? [packageJson.bin]
    : Object.values(packageJson.bin || {}).filter((v) => typeof v === 'string');
  const walked = new Set(found.map((f) => rel(f.abs)));
  for (const raw of binValues) {
    const relBin = raw.replace(/^\.\//, '');
    if (walked.has(relBin) || isExcluded(relBin)) continue;
    found.push({ abs: path.join(absRoot, relBin), isTest: false });
  }

  // Production surface vs usage-only witnesses. A test proves an export is used
  // but is never itself part of the architecture — unless the caller explicitly
  // asks to map the tests too.
  // Read a bounded batch at a time (never thousands of open files at once),
  // keeping the walk's order — the digest and the graph read it in order.
  const wanted = found.map(({ abs, isTest }) => ({ abs, isTest, relFile: rel(abs) }))
    .filter(({ relFile }) => !isExcluded(relFile));
  const read = [];
  for (let i = 0; i < wanted.length; i += READ_BATCH) {
    const batch = await Promise.all(wanted.slice(i, i + READ_BATCH).map((f) => fs.readFile(f.abs, 'utf8')
      .then((text) => ({ ...f, text }), () => null)));
    for (const f of batch) if (f) read.push(f);
  }

  const htmlScriptSrcs = await htmlEntrySrcs(absRoot);
  // The repo's own top level — read here (impure) so the hygiene check stays pure.
  const rootEntries = (await fs.readdir(absRoot).catch(() => []));

  const retiredToolNames = Object.keys(RETIRED_TOOL_HINTS || {});
  const sizeBaseline = await fs.readFile(path.join(absRoot, 'scripts/file-size-baseline.json'), 'utf8')
    .then(JSON.parse).catch(() => ({}));
  const ledger = await readJson(path.join(absRoot, '.mapview', 'confirmations.json'));

  // THE MEMO (opt-in, `opts.memo`, 2026-09-28 smoothness pass). Extracting and
  // assembling this repo costs ~4s of CPU; the desk re-asked it on every REPO
  // MAP open. Every input the graph is built from — each file's path and full
  // text, the manifest, the law, the baselines, the ledger — folds into one
  // digest; an identical digest returns the graph already built. Exact, never
  // a timestamp guess: one changed byte anywhere rebuilds.
  let digest = null;
  if (opts.memo) {
    const h = createHash('sha1');
    h.update(JSON.stringify([packageJson, config, htmlScriptSrcs, rootEntries, sizeBaseline, ledger, retiredToolNames, Boolean(opts.includeTests)]));
    for (const f of read) h.update(`${f.isTest ? 't' : 'p'}\0${f.relFile}\0${f.text}\0`);
    digest = h.digest('hex');
    if (opts.memo.digest === digest) return opts.memo.graph;
  }

  const files = [];
  const usageFiles = [];
  const fileSizes = {};
  for (const { abs, isTest, relFile, text } of read) {
    // LINE count, measured exactly as scripts/check-file-size.mjs measures it —
    // the two must agree or the map reports violations the gate cannot see.
    const split = text.split('\n');
    fileSizes[relFile] = text.endsWith('\n') ? split.length - 1 : split.length;
    const entry = { relFile, text, record: extractFile(relFile, text, abs, absRoot, { aliases }) };
    if (isTest && !opts.includeTests) usageFiles.push(entry);
    else files.push(entry);
  }
  const graph = buildGraph(files, {
    root: path.basename(absRoot),
    scannedFiles: files.length,
    usageFiles,
    packageJson,
    htmlScriptSrcs,
    configEntries: Array.isArray(config.entryPoints) ? config.entryPoints : [],
    layers: config.layers || null,
    protocol: config.protocol?.rules || null,
    rootEntries,
    rootAllowlist: config.rootAllowlist || null,
    fileSizes,
    retiredToolNames,
    sizeBaseline,
  });
  // CONFIRMATION TIER (MAPVIEW-013, #393): verified verdicts from the repo's
  // ledger ride every finding, so a reader always knows hypothesis from
  // receipt. Stale rows (verdicts whose finding no longer occurs) surface on
  // meta rather than rotting silently.
  const { anomalies, confirmed, stale } = annotateConfirmations(graph.anomalies, ledger?.rows);
  graph.anomalies = anomalies;
  graph.meta.confirmations = { confirmed, stale };
  if (opts.memo) { opts.memo.digest = digest; opts.memo.graph = graph; }
  return graph;
};

/** Scan a directory and return only the plan-ready findings report. */
// impure — reads the filesystem
export const scanFindings = async (root, opts = {}) => buildFindings(await scanArchitecture(root, opts));

/**
 * Scan a directory and report only what is NEW since its committed baseline —
 * the compiler's bargain the CLI has always kept, in the engine so every
 * front end (CLI, /api/v1/map, the skill) answers identically (#391). Shape
 * matches `mapview check --json`: { repo, baselined, introduced, resolvedCount }.
 * `baselined: false` means the repo never accepted a baseline — the caller
 * decides whether to fall back to the full report.
 */
// impure — reads the filesystem
export const scanCheck = async (root, opts = {}) => checkFromGraph(root, await scanArchitecture(root, opts));

/** The check report from a graph already built. */
// impure — reads the committed baseline
export const checkFromGraph = async (root, graph) => {
  const baseline = await readJson(path.join(path.resolve(root), BASELINE_RELPATH));
  const { baselined, introduced, resolved } = diffAgainstBaseline(graph, baseline);
  return { repo: graph.meta.root, baselined, introduced, resolvedCount: resolved.length };
};
