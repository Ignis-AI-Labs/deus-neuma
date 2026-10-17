/**
 * Module-edge coverage across every import form JavaScript actually has, proven
 * against a REAL repo on disk (RULE 0, no mocks).
 *
 * This exists because the scanner used to recognise only `import … from`. On the
 * real tree that left ZERO module edges touching any `.cjs` file — Electron's
 * whole main process read as disconnected — and 93 files looked "never imported"
 * when many were reached by `require`, a side-effect import, a dynamic import,
 * or a star re-export. Every assertion below is the guard on one of those forms:
 * connectivity findings are only as honest as this list is complete.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { scanArchitecture } from '../../backend/services/mapview/scan.js';

let root;
let graph;

const write = async (rel, text) => {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, text);
};

/** Does the graph carry a module edge from → to? */
const hasEdge = (from, to) => graph.modules.some((e) => e.from === from && e.to === to);
/** The call-edge (if any) for a from → to pair. */
const callEdge = (from, to) => graph.callEdges.find((e) => e.from === from && e.to === to);

beforeAll(async () => {
  root = await createTempDir('mapview-import-forms');

  await write('entry.js', [
    "import { named } from './lib/named.js';",
    "import def from './lib/default.js';",
    "import * as ns from './lib/namespace.js';",
    "import './lib/side-effect.js';",
    "const lazy = async () => (await import('./lib/dynamic.js')).go();",
    'named(); def(); ns.thing(); lazy();',
  ].join('\n'));

  await write('main.cjs', [
    "const helper = require('./lib/cjs-helper.cjs');",
    "const { pick } = require('./lib/cjs-destructured.cjs');",
    "require('./lib/cjs-bare.cjs');",
    'helper(); pick();',
  ].join('\n'));

  await write('barrel.js', [
    "export * from './lib/star-target.js';",
    "export { named } from './lib/named.js';",
  ].join('\n'));

  await write('decoys.js', [
    '// require("./lib/commented-out.js") — a comment must never invent an edge',
    'const doc = "import x from \'./lib/in-a-string.js\'";',
    'const alsoDoc = `require("./lib/in-a-template.js")`;',
    'export const keep = () => doc + alsoDoc;',
  ].join('\n'));

  for (const leaf of ['named', 'default', 'namespace', 'side-effect', 'dynamic', 'star-target']) {
    await write(`lib/${leaf}.js`, `export const ${leaf.replace(/-(.)/g, (_, c) => c.toUpperCase())} = () => 1;\n`);
  }
  await write('lib/named.js', 'export const named = () => 1;\n');
  await write('lib/star-target.js', 'export const starThing = () => 1;\n');
  for (const leaf of ['cjs-helper', 'cjs-destructured', 'cjs-bare']) {
    await write(`lib/${leaf}.cjs`, 'module.exports = () => 1;\n');
  }

  graph = await scanArchitecture(root);
});

describe('every import form produces a module edge', () => {
  it('captures a named ESM import', () => {
    expect(hasEdge('entry.js', 'lib/named.js')).toBe(true);
  });
  it('captures a default ESM import', () => {
    expect(hasEdge('entry.js', 'lib/default.js')).toBe(true);
  });
  it('captures a namespace (`* as ns`) import', () => {
    expect(hasEdge('entry.js', 'lib/namespace.js')).toBe(true);
  });
  it('captures a side-effect import that binds no name', () => {
    expect(hasEdge('entry.js', 'lib/side-effect.js')).toBe(true);
  });
  it('captures a dynamic import()', () => {
    expect(hasEdge('entry.js', 'lib/dynamic.js')).toBe(true);
  });
  it('captures an assigned CJS require', () => {
    expect(hasEdge('main.cjs', 'lib/cjs-helper.cjs')).toBe(true);
  });
  it('captures a destructured CJS require', () => {
    expect(hasEdge('main.cjs', 'lib/cjs-destructured.cjs')).toBe(true);
  });
  it('captures a bare side-effect CJS require', () => {
    expect(hasEdge('main.cjs', 'lib/cjs-bare.cjs')).toBe(true);
  });
  it('captures `export * from` as a real edge', () => {
    expect(hasEdge('barrel.js', 'lib/star-target.js')).toBe(true);
  });
});

describe('call attribution is limited to forms that bind a callable name', () => {
  it('attributes calls through a named import', () => {
    expect(callEdge('entry.js', 'lib/named.js')?.count).toBeGreaterThan(0);
  });
  it('attributes calls through an assigned require', () => {
    expect(callEdge('main.cjs', 'lib/cjs-helper.cjs')?.count).toBeGreaterThan(0);
  });
  it('draws NO call edge for a side-effect import — there is no name to invoke', () => {
    expect(callEdge('entry.js', 'lib/side-effect.js')).toBeUndefined();
  });
  it('draws NO call edge for a dynamic import — the binding is not at the call site', () => {
    expect(callEdge('entry.js', 'lib/dynamic.js')).toBeUndefined();
  });
  it('draws NO call edge for `export * from` — the names are unknowable statically', () => {
    expect(callEdge('barrel.js', 'lib/star-target.js')).toBeUndefined();
  });
});

describe('a specifier that is not code never invents an edge', () => {
  it('ignores a require inside a line comment', () => {
    expect(hasEdge('decoys.js', 'lib/commented-out.js')).toBe(false);
  });
  it('ignores an import written inside a string literal', () => {
    expect(hasEdge('decoys.js', 'lib/in-a-string.js')).toBe(false);
  });
  it('ignores a require written inside a template literal', () => {
    expect(hasEdge('decoys.js', 'lib/in-a-template.js')).toBe(false);
  });
});
