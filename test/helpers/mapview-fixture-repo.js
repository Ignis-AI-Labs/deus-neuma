/**
 * mapview fixture repo — the miniature-repo builder (write() + every fixture
 * file body) extracted VERBATIM from test/integration/mapview-scan.test.js
 * under the size law (docs/work/size-law-breakdown.md Part 4). It serves that
 * suite alone: the beforeAll/afterAll and every assertion stay in the test —
 * the builder writes the REAL tiny repo on disk (RULE 0, no mocks) and
 * returns its root.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createTempDir } from './temp-fs.js';

export const buildMapviewFixtureRepo = async () => {
  const root = await createTempDir('mapview-scan');

  const write = async (rel, text) => {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, text);
  };

  await write('server.js', [
    "import express from 'express';",
    "import fooRouter from './routes/foo-routes.js';",
    "import { doThing } from './lib/util.js';",
    'const app = express();',
    "app.use('/api/foo', fooRouter);",
    'const boot = () => { doThing(); doThing(); };',
    "ws.send('portal:hello', { ok: true });",
    'boot();',
  ].join('\n'));

  await write('routes/foo-routes.js', [
    "import express from 'express';",
    'const router = express.Router();',
    "router.get('/list', (req, res) => res.json([]));",
    "router.post('/', (req, res) => res.json({}));",
    "function handle(msg) { switch (msg.type) { case 'portal:hello': return true; } }",
    'export default router;',
  ].join('\n'));

  await write('lib/util.js', [
    'export const doThing = () => 42;',
    'const privateHelper = () => 1;',
    'export default doThing;',
  ].join('\n'));

  // A .cjs module imported and called — proves import resolution reaches .cjs.
  await write('lib/native.cjs', 'const ping = () => 1; module.exports = { ping };');
  await write('bridge.js', [
    "import { ping } from './lib/native.cjs';",
    'ping();',
  ].join('\n'));

  // A DOM-event channel: dispatchEvent(CustomEvent) produces, addEventListener
  // consumes — must pair (not read as severed).
  await write('ui/emit.js', "window.dispatchEvent(new CustomEvent('desk:flash', { detail: 1 }));");
  await write('ui/listen.js', "window.addEventListener('desk:flash', () => {});");

  // A class with methods — must surface as a class node plus its methods, and
  // must NOT invent functions out of the control-flow blocks inside them.
  await write('engine/vector.js', [
    'export class VectorEngine extends BaseEngine {',
    '  constructor(opts) { this.opts = opts; }',
    '  async index(items) {',
    '    for (const it of items) { if (it) { this.store(it); } }',
    '    while (this.busy) { doWait(); }',
    '    return items.length;',
    '  }',
    '  get ready() { return !this.busy; }',
    '  store(item) { return item; }',
    '}',
    'function topLevel() { return 1; }',
  ].join('\n'));

  // A barrel that re-exports doThing from lib/util.js; a consumer imports the
  // barrel and calls it. The call edge must attribute to the real module, not the
  // pass-through barrel — otherwise the barrel looks like a false hub.
  await write('barrel.js', "export { doThing } from './lib/util.js';");
  await write('barrel-consumer.js', [
    "import { doThing } from './barrel.js';",
    'doThing();',
  ].join('\n'));
  // Outbound egress: a real fetch to a literal host, a real WebSocket client, and
  // a COMMENTED-OUT rpc provider that must NOT be counted (no invented connection).
  await write('net/egress.js', [
    "export async function pull() {",
    "  const r = await fetch('https://api.example.com/v1/data', { method: 'GET' });",
    "  const s = await fetch(dynamicUrl);", // dynamic target → host null
    "  const ws = new WebSocket('wss://relay.example.net/socket');",
    "  // const dead = new JsonRpcProvider('https://sepolia.base.org'); // must be skipped",
    "  return db.fetch(r);", // .fetch method — must NOT match global fetch
    "}",
    // a `//` inside a STRING before a real fetch must not be read as a comment
    "export function ping() { log('a//b'); return fetch('https://ping.example.org/'); }",
    // window.fetch IS the global (counted); this.fetch is a method (excluded)
    "export function win() { this.fetch(0); return window.fetch('https://win.example.com/'); }",
  ].join('\n'));

  // Storage: import-anchored fs read/write. A default-import fs namespace binding,
  // a named-imported op, a commented op (skip), and a non-fs `.writeFile` method
  // that must NOT be mistaken for disk I/O.
  await write('disk/store.js', [
    "import fs from 'fs/promises';",
    'export async function save(p, d) {',
    "  await fs.mkdir('x', { recursive: true });", // write
    '  await fs.writeFile(p, d);',                  // write
    "  const cur = await fs.readFile(p, 'utf8');",  // read
    '  // await fs.unlink(p); cleanup later',       // commented → skip
    '  return cur;',
    '}',
  ].join('\n'));
  await write('disk/direct.js', [
    "import { readFile } from 'fs/promises';",
    'export const load = (p) => readFile(p);',      // read (named import)
  ].join('\n'));
  // a REAL call inside a template ${…} interpolation IS code — it must be detected,
  // while an op token in the literal part of the same template must NOT be.
  await write('disk/interp.js', [
    "import fs from 'fs/promises';",
    'export const render = (p) => `not-real: fs.readFile(x)  real: ${fs.writeFile(p, 1)}`;',
  ].join('\n'));
  await write('disk/notfs.js', [
    'const cache = makeCache();',
    'export const put = (k, v) => cache.writeFile(k, v);', // method, NOT fs
  ].join('\n'));
  // even WITH an fs import, `this.fs.writeFile` is an instance property, not the
  // module binding — must not be counted as disk I/O.
  await write('disk/instance.js', [
    "import fs from 'fs/promises';",
    'export class Store { save(p, d) { return this.fs.writeFile(p, d); } }',
  ].join('\n'));
  // op tokens that live only INSIDE string/template literals are not real calls —
  // neither disk I/O nor egress. A multi-line template also must not shift the
  // line number of the REAL write that follows it.
  await write('disk/instrings.js', [
    "import fs from 'fs/promises';",
    'export const doc = {',
    "  help: 'run fs.writeFile(p, d) to persist',", // string → not a write
    '  tmpl: `example:',
    '    const x = await fs.readFile(p);',           // template → not a read
    '  `,',
    '  api: "then fetch(url) to sync",',             // string → not egress
    '};',
    "export const pat = /can't-fs.readFile(x)/;",    // regex literal → not a read, and its
    'export async function real(p, d) { await fs.writeFile(p, d); }', // apostrophe must NOT hide this real write
  ].join('\n'));

  // Middleware: a router-level guard and a per-route guard; the mount in server.js
  // (app.use('/api/foo', fooRouter)) must NOT be read as middleware.
  await write('mw/api.js', [
    "import express from 'express';",
    'const router = express.Router();',
    'router.use(requireAuth);',                           // router-level middleware
    "router.get('/x', rateLimit, (req, res) => res.end());", // per-route middleware
    "router.post('/y', rateLimit, requireAuth, (req, res) => res.end());", // TWO per-route mws
    "app.use('/scoped', pathGuard, mountedRouter);",      // path-scoped mount-time mw (F5)
    'app.use(bareRouter);',                               // bare router mount — NOT middleware (F3)
    "const cfg = store.get('theme', fallbackValue, opts);", // non-router .get — NOT middleware (F1)
    'export default router;',
  ].join('\n'));

  // Duplication: two files with a byte-identical helper (confirmed exact copy) and
  // two files with a same-named function whose bodies DIFFER (candidate, not confirmed).
  await write('dup/a.js', "export const authHeaders = (t) => ({ Authorization: 'Bearer ' + t });");
  await write('dup/b.js', "export const authHeaders = (t) => ({ Authorization: 'Bearer ' + t });");
  await write('dup/c.js', 'export function variant(x) { return x + 1; }');
  await write('dup/d.js', 'export function variant(x) { return x * 2; }');
  // TWO distinct identical-body clusters under one name — both must surface, not
  // just the largest (and NOT be merged into one false 4-way copy).
  await write('dup/twin1.js', 'export function twin(a) { return a + 1; }');
  await write('dup/twin2.js', 'export function twin(a) { return a + 1; }');
  await write('dup/twin3.js', 'export function twin(a) { return a - 9; }');
  await write('dup/twin4.js', 'export function twin(a) { return a - 9; }');

  // Env deps: a named var (twice), a dynamic process.env[x] read, and a var name
  // that only appears inside a string (must NOT count).
  await write('cfg/env.js', [
    'export const cfg = {',
    '  key: process.env.DNA_KEY,',      // named
    '  again: process.env.DNA_KEY,',    // same var, second ref
    '  dyn: process.env[whichVar],',    // dynamic → (dynamic) bucket
    "  note: 'reads process.env.FAKE_KEY at boot',", // string → not a real dep
    '  chain: obj.process.env.NOT_GLOBAL,',          // member chain → not the global env
    "  lit: process.env['LITERAL_KEY'],",            // string-literal bracket → known name
    '};',
    'export const { DESTRUCTURED } = process.env;',  // destructure → real read, dynamic name
  ].join('\n'));

  // A hidden dir (scratch/tooling convention) — must be excluded so retired
  // excerpts never masquerade as live architecture.
  await write('.ai6/scratch/ghost-excerpt.js', 'export class GhostExcerpt {}');
  // A self-contained channel in the ROOT archive/ — must be excluded, so retired
  // code can never invent a channel on the live map.
  await write('archive/old-ui/ghost.js', "ws.send('ghost:signal', {}); function h(m){ switch(m.type){ case 'ghost:signal': return 1; } }");
  // A NESTED archive/ (routes/archive) is a live feature dir, not retired code —
  // it must still be mapped (the skip is root-scoped).
  await write('routes/archive/live.js', 'export const keptArchiveFn = () => 1;');

  return root;
};
