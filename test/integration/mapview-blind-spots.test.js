/**
 * The four blind spots of the 2026-08-20 dead-code scan, each proven FIXED
 * against a real repo on disk (RULE 0, no mocks). Every fixture here is the
 * minimal shape of a real false positive that scan produced:
 *
 *   A. aliased named imports — `{ real as local }` credited the ALIAS, so the
 *      source name read as a dead export (three whole modules read as corpses);
 *   B. `export { x } from` re-export shims carried no module edge — a 12-line
 *      shim orphaned the entire live platform-db lane;
 *   C. entry points the walk can't see — package.json bin targets have no
 *      extension; build-tool aliases (Vite /@kotodama) resolve nowhere;
 *   D. vendored/scratch trees buried the report — 31% of dead-export findings
 *      were on code the repo does not own.
 *
 * Plus the split those fixes made legible: dead-export (delete the symbol)
 * vs over-export (drop the keyword — the code is live in its own file).
 *
 * DEAD-005 (#394) added two more, found when the fixes above created one and
 * exposed the other:
 *
 *   E. the ownership map re-points named-import edges THROUGH barrels (by
 *      design), but reachability walked those same edges — so a pure re-export
 *      shim, and every file only the shim's own imports pull in, read as
 *      unreachable (tool-stream-filter.js; core/continuity's private leaves);
 *   F. HTML pages under electron/ are real windows (BrowserWindow.loadFile),
 *      but only root/frontend/public/src were read for <script src> entries —
 *      the wallet confirm window's renderer read as dead.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { scanArchitecture, walk } from '../../backend/services/mapview/scan.js';

let root;
let graph;

const write = async (rel, text) => {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, text);
};

const deadExportNames = () => graph.connectivity.deadExports.map((d) => d.name);
const anomaliesOf = (kind) => graph.anomalies.filter((a) => a.kind === kind);
const hasEdge = (from, to) => graph.modules.some((e) => e.from === from && e.to === to);

beforeAll(async () => {
  root = await createTempDir('mapview-blind-spots');

  await write('package.json', JSON.stringify({
    name: 'fixture', type: 'module', bin: { tool: './bin/tool' },
  }));
  await write('mapview.config.json', JSON.stringify({
    entryPoints: ['entry.js', 'entry2.js'],
    aliases: { '/@x': 'lib-x' },
    excludePaths: ['vendored'],
  }));

  // A — aliased named import, direct and through an aliasing barrel.
  await write('entry.js', [
    "import { realName as localName } from './aliased.js';",
    "import { apiFn } from './barrel-alias.js';",
    "import lane from './shim.js';",
    "import { xFn } from '/@x/thing.js';",
    'localName(); apiFn(); lane(); xFn();',
  ].join('\n'));
  await write('aliased.js', 'export const realName = () => 1;\n');
  await write('barrel-alias.js', "export { coreFn as apiFn } from './owner.js';\n");
  await write('owner.js', 'export const coreFn = () => 2;\n');

  // B — the platform-db shape: a default re-export shim is the ONLY road in.
  await write('shim.js', "export { default } from './real-lane.js';\n");
  await write('real-lane.js', 'const lane = { init: () => 3 };\nexport default lane;\n');

  // C — a bin shim with no extension, dynamically importing its dispatcher.
  await write('bin/tool', "#!/usr/bin/env node\nimport('../cli/index.js');\n");
  await write('cli/index.js', "import { dispatch } from './lib/dispatch.js';\ndispatch();\n");
  await write('cli/lib/dispatch.js', 'export const dispatch = () => 4;\n');

  // C — the Vite-style alias target (reached from entry.js above).
  await write('lib-x/thing.js', 'export const xFn = () => 5;\n');

  // D — a vendored tree full of would-be findings.
  await write('vendored/junk.js', 'export const neverUsed = () => 6;\n');

  // The split: one export truly dead, one live in its own file.
  await write('split.js', [
    'export const trulyDead = () => 7;',
    'export const usedInFile = () => 8;',
    'const call = () => usedInFile();',
    'export const anchor = call;',
  ].join('\n'));
  await write('split-user.js', "import { anchor } from './split.js';\nanchor();\n");

  // E — the tool-stream-filter shape: a pure named re-export shim whose every
  // importer gets re-pointed past it…
  await write('entry2.js', [
    "import { fnA } from './pure-shim.js';",
    "import { pub } from './barrel-priv.js';",
    'fnA(); pub();',
  ].join('\n'));
  await write('pure-shim.js', "export { fnA } from './fn-owner.js';\n");
  await write('fn-owner.js', 'export const fnA = () => 9;\n');
  // …and the core/continuity shape: a barrel whose consumers only ever import
  // names owned elsewhere, leaving the barrel — and the leaf only IT reaches —
  // rooted by nothing.
  await write('barrel-priv.js', [
    "export { pub } from './pub-owner.js';",
    "export { priv } from './private-leaf.js';",
  ].join('\n'));
  await write('pub-owner.js', 'export const pub = () => 10;\n');
  await write('private-leaf.js', 'export const priv = () => 11;\n');

  // F — an Electron window: HTML under electron/ loads its renderer script.
  await write('electron/wallet/confirm.html', '<html><body><script src="./confirm.js"></script></body></html>\n');
  await write('electron/wallet/confirm.js', "import { helper } from './helper.js';\nhelper();\n");
  await write('electron/wallet/helper.js', 'export const helper = () => 12;\n');

  // G — channel idioms: a tuple dispatch table, a bare first-arg send helper,
  // and a ternary reason code whose colon looks like a dispatch key.
  await write('chan-consumer.js', [
    'const onAlpha = () => {};',
    'const handlers = [',
    "  ['sig:alpha', onAlpha],",
    '];',
    'export const wire = (ws) => handlers.forEach(([ch, on]) => ws.on(ch, on));',
  ].join('\n'));
  await write('chan-producer.js', [
    'const send = (t, p) => [t, p];',
    "export const go = () => send('sig:alpha', {});",
    "export const reason = (ok) => ok ? 'sig:not-a-channel' : 'plain';",
  ].join('\n'));

  graph = await scanArchitecture(root);
});

describe('A — aliased named imports credit the SOURCE name', () => {
  it('a directly aliased import keeps the source export alive', () => {
    expect(deadExportNames()).not.toContain('realName');
  });
  it('an aliasing barrel hop keeps the real file source name alive', () => {
    expect(deadExportNames()).not.toContain('coreFn');
    expect(graph.connectivity.unreachable).not.toContain('owner.js');
  });
});

describe('B — `export { x } from` is a real module edge', () => {
  it('the shim target is reachable', () => {
    expect(hasEdge('shim.js', 'real-lane.js')).toBe(true);
    expect(graph.connectivity.unreachable).not.toContain('real-lane.js');
  });
  it('the shim target is not marked opaque by the edge — its exports stay judgeable', () => {
    // real-lane is default-imported through the shim, so it IS opaque (correct);
    // the barrel-alias target proves named judgement survives the new edge.
    expect(deadExportNames()).not.toContain('coreFn');
  });
});

describe('C — entry points the walk cannot see', () => {
  it('a package.json bin shim without extension roots its whole tree', () => {
    expect(graph.connectivity.unreachable).not.toContain('cli/index.js');
    expect(graph.connectivity.unreachable).not.toContain('cli/lib/dispatch.js');
    expect(graph.connectivity.entryPoints.some((e) => e.file === 'bin/tool' && e.reason === 'package.json bin')).toBe(true);
  });
  it('a declared alias resolves to the real target', () => {
    expect(graph.connectivity.unreachable).not.toContain('lib-x/thing.js');
    expect(deadExportNames()).not.toContain('xFn');
  });
});

describe('D — declared excludePaths never enter the scan', () => {
  it('the walk prunes an excluded tree instead of walking it and dropping its files', async () => {
    const seen = [];
    const isExcluded = (rf) => rf === 'vendored' || rf.startsWith('vendored/');
    for await (const f of walk(root, { root, isExcluded })) seen.push(path.relative(root, f.abs));
    expect(seen).toContain('entry.js');
    expect(seen.some((f) => f.startsWith('vendored/'))).toBe(false);
  });
  it('vendored files produce no findings and no reachability rows', () => {
    expect(graph.connectivity.unreachable).not.toContain('vendored/junk.js');
    expect(deadExportNames()).not.toContain('neverUsed');
    expect(graph.anomalies.some((a) => (a.files || []).some((f) => f.startsWith('vendored/')))).toBe(false);
  });
});

describe('E — reachability walks the literal load graph, ownership keeps the barrel transparent', () => {
  it('a pure re-export shim is reachable even when every edge is re-pointed past it', () => {
    expect(graph.connectivity.unreachable).not.toContain('pure-shim.js');
    expect(graph.connectivity.unreachable).not.toContain('fn-owner.js');
  });
  it('a barrel and the leaf only it reaches are rooted by the barrel importer', () => {
    expect(graph.connectivity.unreachable).not.toContain('barrel-priv.js');
    expect(graph.connectivity.unreachable).not.toContain('private-leaf.js');
  });
  it('the ownership edge still lands on the defining module, not the shim', () => {
    expect(hasEdge('entry2.js', 'fn-owner.js')).toBe(true);
  });
  it('entry2.js itself stays an entry-driven root, not a beneficiary of the hop edges', () => {
    // The literal hop is importer→shim only; it must never invent reachability
    // for the importer itself or fabricate a reverse edge.
    expect(hasEdge('fn-owner.js', 'entry2.js')).toBe(false);
    expect(hasEdge('pure-shim.js', 'entry2.js')).toBe(false);
  });
});

describe('F — HTML anywhere under electron/ is a window, its scripts are entries', () => {
  it('the confirm-window renderer roots its tree', () => {
    expect(graph.connectivity.entryPoints.some(
      (e) => e.file === 'electron/wallet/confirm.js' && e.reason === 'HTML <script src>',
    )).toBe(true);
    expect(graph.connectivity.unreachable).not.toContain('electron/wallet/confirm.js');
    expect(graph.connectivity.unreachable).not.toContain('electron/wallet/helper.js');
  });
});

describe('G — channel idioms the pairing could not see', () => {
  const channelOf = (name) => graph.channels.find((c) => c.name === name);
  it('an array-tuple dispatch table registers its channels as consumers', () => {
    expect(channelOf('sig:alpha').consumers).toContain('chan-consumer.js');
  });
  it('a bare send helper with the channel first is a producer', () => {
    expect(channelOf('sig:alpha').producers).toContain('chan-producer.js');
  });
  it('a paired channel raises no severed-channel anomaly', () => {
    expect(anomaliesOf('channel-no-consumer').some((a) => a.label === 'sig:alpha')).toBe(false);
    expect(anomaliesOf('channel-no-producer').some((a) => a.label === 'sig:alpha')).toBe(false);
  });
  it("a ternary's consequent is a reason code, never a phantom consumer", () => {
    expect(channelOf('sig:not-a-channel')).toBeUndefined();
  });
});

describe('the dead-export / over-export split', () => {
  it('a symbol referenced nowhere is dead-export: delete it', () => {
    const dead = anomaliesOf('dead-export').map((a) => a.label);
    expect(dead.some((l) => l.startsWith('trulyDead '))).toBe(true);
  });
  it('a symbol its own file calls is over-export: drop the keyword, keep the code', () => {
    const over = anomaliesOf('over-export').map((a) => a.label);
    expect(over.some((l) => l.startsWith('usedInFile '))).toBe(true);
    const dead = anomaliesOf('dead-export').map((a) => a.label);
    expect(dead.some((l) => l.startsWith('usedInFile '))).toBe(false);
  });
});
