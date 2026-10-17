/**
 * mapview scanner — proven against a REAL tiny repo on disk (RULE 0, no mocks).
 * We write real source files with a mounted Express router, a paired WS channel,
 * an exported function, and an import that calls it, then assert the graph the
 * scanner extracts from the real filesystem.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { buildMapviewFixtureRepo } from '../helpers/mapview-fixture-repo.js';
import { scanArchitecture, scanFindings } from '../../backend/services/mapview/scan.js';

let root;
let graph;

beforeAll(async () => {
  // The miniature-repo builder (write() + every fixture file body) lives in
  // test/helpers/mapview-fixture-repo.js (size-law extraction).
  root = await buildMapviewFixtureRepo();
  graph = await scanArchitecture(root);
});

afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('scanArchitecture', () => {
  it('resolves mounted routes to full paths', () => {
    const paths = graph.routes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('GET /api/foo/list');
    expect(paths).toContain('POST /api/foo');
  });

  it('pairs a channel across its producer and consumer files', () => {
    const hello = graph.channels.find((c) => c.name === 'portal:hello');
    expect(hello).toBeTruthy();
    expect(hello.producers).toContain('server.js');
    expect(hello.consumers).toContain('routes/foo-routes.js');
  });

  it('extracts exported functions but not private ones as exported', () => {
    const doThing = graph.functions.find((f) => f.name === 'doThing' && f.file === 'lib/util.js');
    expect(doThing?.exported).toBe(true);
    const priv = graph.functions.find((f) => f.name === 'privateHelper');
    expect(priv?.exported).toBe(false);
  });

  it('records an import-anchored call edge with the invoked binding and count', () => {
    const edge = graph.callEdges.find((e) => e.from === 'server.js' && e.to === 'lib/util.js');
    expect(edge).toBeTruthy();
    expect(edge.via).toContain('doThing');
    expect(edge.count).toBe(2); // doThing() called twice in boot()
  });

  it('resolves import-anchored edges to .cjs targets', () => {
    const edge = graph.callEdges.find((e) => e.from === 'bridge.js' && e.to === 'lib/native.cjs');
    expect(edge).toBeTruthy();
    expect(edge.via).toContain('ping');
  });

  it('excludes test files by default', () => {
    expect(graph.functions.some((f) => f.file.includes('.test.'))).toBe(false);
  });

  it('flags no anomaly for the paired channel', () => {
    const flagged = graph.anomalies.filter((a) => a.label === 'portal:hello');
    expect(flagged).toHaveLength(0);
  });

  it('pairs a DOM CustomEvent producer with its addEventListener consumer', () => {
    const flash = graph.channels.find((c) => c.name === 'desk:flash');
    expect(flash).toBeTruthy();
    expect(flash.producers).toEqual(['ui/emit.js']);   // dispatchEvent(new CustomEvent(...)), exactly one
    expect(flash.consumers).toEqual(['ui/listen.js']); // addEventListener(...), exactly one
    // and therefore it is NOT flagged severed
    expect(graph.anomalies.some((a) => a.label === 'desk:flash')).toBe(false);
  });

  it('clusters files into subsystems by directory with system→system edges', () => {
    const ids = graph.subsystems.map((s) => s.id);
    expect(ids).toContain('lib');   // lib/util.js, lib/native.cjs
    expect(ids).toContain('ui');    // ui/emit.js, ui/listen.js
    const lib = graph.subsystems.find((s) => s.id === 'lib');
    expect(lib.files).toBeGreaterThanOrEqual(2);
    // server.js (root) calls doThing from lib/util.js → a root→lib subsystem edge
    const edge = graph.subsystemEdges.find((e) => e.from === '(root)' && e.to === 'lib');
    expect(edge).toBeTruthy();
    expect(edge.count).toBeGreaterThan(0);
    expect(graph.meta.subsystemCount).toBe(graph.subsystems.length);
  });

  it('surfaces a class declaration and its methods without inventing control-flow functions', () => {
    const defs = graph.functions.filter((f) => f.file === 'engine/vector.js');
    const byName = (n) => defs.find((f) => f.name === n);
    // the class itself, with its superclass and export flag
    const cls = byName('VectorEngine');
    expect(cls).toBeTruthy();
    expect(cls.kind).toBe('class');
    expect(cls.exported).toBe(true);
    expect(cls.extends).toBe('BaseEngine');
    // its real methods are present and tagged
    for (const method of ['constructor', 'index', 'ready', 'store']) {
      const d = byName(method);
      expect(d, `method ${method}`).toBeTruthy();
      expect(d.kind).toBe('method');
    }
    // the free function is still a function, not a method
    expect(byName('topLevel')?.kind).toBe('function');
    // line numbers are the definition's OWN line, not the newline before it
    // (fixture: class@1, constructor@2, index@3, store@9, topLevel@11)
    expect(cls.line).toBe(1);
    expect(byName('constructor').line).toBe(2);
    expect(byName('index').line).toBe(3);
    expect(byName('store').line).toBe(9);
    expect(byName('topLevel').line).toBe(11);
    // control-flow keywords inside method bodies are NOT mistaken for definitions
    for (const kw of ['for', 'while', 'if', 'return']) {
      expect(defs.some((f) => f.name === kw), `keyword ${kw} must not be a def`).toBe(false);
    }
    // meta counts split honestly
    expect(graph.meta.classCount).toBeGreaterThanOrEqual(1);
    expect(graph.meta.methodCount).toBeGreaterThanOrEqual(4);
    expect(graph.meta.definitionCount).toBe(graph.functions.length);
  });

  it('maps filesystem read/write (import-anchored), skipping comments and non-fs methods', () => {
    const sto = (file, kind) => graph.storage.find((s) => s.file === file && s.kind === kind);
    // namespace-import fs: mkdir + writeFile are writes; readFile is a read; unlink is commented out
    expect(sto('disk/store.js', 'write')?.count).toBe(2);
    expect(sto('disk/store.js', 'read')?.count).toBe(1);
    // named-imported op resolves too
    expect(sto('disk/direct.js', 'read')?.count).toBe(1);
    // a call inside a template ${…} interpolation is real code (write), the token in
    // the template's literal part is not (no read)
    expect(sto('disk/interp.js', 'write')?.count).toBe(1);
    expect(graph.storage.some((s) => s.file === 'disk/interp.js' && s.kind === 'read')).toBe(false);
    // a `.writeFile` method on a non-fs object is NOT disk I/O (no fs import)
    expect(graph.storage.some((s) => s.file === 'disk/notfs.js')).toBe(false);
    // `this.fs.writeFile` is an instance property even when fs IS imported — not counted
    expect(graph.storage.some((s) => s.file === 'disk/instance.js')).toBe(false);
    // op tokens inside string/template literals are never real calls — only the one
    // real fs.writeFile counts, and none of the string-embedded fetch/reads leak in
    const inStr = graph.storage.filter((s) => s.file === 'disk/instrings.js');
    expect(inStr.map((s) => `${s.kind}:${s.count}`)).toEqual(['write:1']);
    expect(graph.external.some((e) => e.file === 'disk/instrings.js')).toBe(false);
    expect(graph.meta.storageCount).toBeGreaterThanOrEqual(4);
    expect(graph.meta.storageFileCount).toBeGreaterThanOrEqual(2);
  });

  it('maps the middleware pipeline (router + per-route), never mistaking a mount for middleware', () => {
    const reqAuth = graph.middleware.find((mw) => mw.name === 'requireAuth');
    expect(reqAuth).toBeTruthy();
    expect(reqAuth.files).toContain('mw/api.js');
    expect(reqAuth.scopes).toContain('router'); // router.use(requireAuth)
    const rate = graph.middleware.find((mw) => mw.name === 'rateLimit');
    expect(rate?.scopes).toEqual(['route']);    // per-route only
    // BOTH middlewares of a two-middleware route are captured (rateLimit + requireAuth)
    expect(rate.count).toBe(2); // /x and /y both list rateLimit
    expect(reqAuth.scopes).toContain('route'); // requireAuth also appears per-route on /y
    // a mount (app.use('/api/foo', fooRouter)) is a route, NOT middleware
    expect(graph.middleware.some((mw) => mw.name === 'fooRouter' || mw.name.startsWith('/'))).toBe(false);
    expect(graph.meta.middlewareCount).toBe(graph.middleware.length);
    // F5: path-scoped mount-time middleware IS surfaced (app.use('/scoped', pathGuard, router))
    expect(graph.middleware.find((mw) => mw.name === 'pathGuard')?.scopes).toEqual(['router']);
    // F3: a bare router mount (app.use(bareRouter)) is NOT middleware
    expect(graph.middleware.some((mw) => mw.name === 'bareRouter' || mw.name === 'mountedRouter')).toBe(false);
    // F1: a non-router .get('key', ident, …) does NOT invent middleware
    expect(graph.middleware.some((mw) => mw.name === 'fallbackValue')).toBe(false);
  });

  it('confirms exact-copy duplicate functions by body fingerprint, not just by name', () => {
    // identical bodies across two files → CONFIRMED exact copy
    const dup = graph.duplicates.find((d) => d.name === 'authHeaders');
    expect(dup).toBeTruthy();
    expect(dup.confirmed).toBe(true);
    expect(dup.exactCopies).toBe(2);
    expect(dup.clusters).toEqual([['dup/a.js', 'dup/b.js']]);
    // a name with TWO distinct identical-body clusters surfaces BOTH (not merged)
    const twin = graph.duplicates.find((d) => d.name === 'twin');
    expect(twin.confirmed).toBe(true);
    expect(twin.clusters).toHaveLength(2);
    expect(twin.clusters).toContainEqual(['dup/twin1.js', 'dup/twin2.js']);
    expect(twin.clusters).toContainEqual(['dup/twin3.js', 'dup/twin4.js']);
    // same NAME but DIFFERENT bodies → listed, but NOT confirmed (a candidate)
    const variant = graph.duplicates.find((d) => d.name === 'variant');
    expect(variant).toBeTruthy();
    expect(variant.confirmed).toBe(false);
    expect(variant.exactCopies).toBe(0);
    expect(variant.files).toEqual(['dup/c.js', 'dup/d.js']);
    // meta counts confirmed separately from all same-name names
    expect(graph.meta.duplicateExactCount).toBeGreaterThanOrEqual(1);
    expect(graph.meta.duplicateNameCount).toBeGreaterThanOrEqual(2);
    // the internal sig is never exposed on public function records
    expect(graph.functions.every((f) => f.sig === undefined)).toBe(true);
  });

  it('maps env-var dependencies by name with files, bucketing dynamic reads, skipping strings', () => {
    const named = graph.env.find((e) => e.name === 'DNA_KEY');
    expect(named).toBeTruthy();
    expect(named.count).toBe(2); // two real reads in cfg/env.js
    expect(named.files).toContain('cfg/env.js');
    // dynamic process.env[x] is bucketed, never invented as a name
    expect(graph.env.some((e) => e.name === '(dynamic)' && e.files.includes('cfg/env.js'))).toBe(true);
    // a var name that only appears inside a string is NOT a dependency
    expect(graph.env.some((e) => e.name === 'FAKE_KEY')).toBe(false);
    // obj.process.env.X is a property chain, not the global env — excluded
    expect(graph.env.some((e) => e.name === 'NOT_GLOBAL')).toBe(false);
    // a string-literal bracket key is a KNOWN name (read from original text)
    expect(graph.env.find((e) => e.name === 'LITERAL_KEY')?.files).toContain('cfg/env.js');
    // a destructure is a real env read surfaced as dynamic (never hidden)
    expect(graph.env.some((e) => e.name === '(dynamic)' && e.files.includes('cfg/env.js'))).toBe(true);
    expect(graph.meta.envVarCount).toBe(graph.env.filter((e) => e.name !== '(dynamic)').length);
  });

  it('maps outbound egress (http/ws-client) with literal hosts, skipping comments and .fetch methods', () => {
    const ext = graph.external.filter((e) => e.file === 'net/egress.js');
    const http = ext.find((e) => e.kind === 'http');
    const wsc = ext.find((e) => e.kind === 'ws-client');
    // four real fetch() sites (literal + dynamic + string-with-// line + window.fetch);
    // `db.fetch(` and `this.fetch(` methods are NOT counted
    expect(http?.count).toBe(4);
    expect(http.hosts).toEqual(['api.example.com', 'ping.example.org', 'win.example.com']);
    // the WebSocket client with its literal host
    expect(wsc?.count).toBe(1);
    expect(wsc.hosts).toEqual(['relay.example.net']);
    // the commented-out JsonRpcProvider must NOT invent an rpc connection
    expect(ext.some((e) => e.kind === 'rpc')).toBe(false);
    // meta counts the sites
    expect(graph.meta.externalCount).toBeGreaterThanOrEqual(3);
  });

  it('follows a barrel re-export to the real defining module for call edges', () => {
    // consumer calls doThing (imported from barrel.js) → edge must land on lib/util.js
    const real = graph.callEdges.find((e) => e.from === 'barrel-consumer.js' && e.to === 'lib/util.js');
    expect(real).toBeTruthy();
    expect(real.via).toContain('doThing');
    // and NOT on the pass-through barrel
    expect(graph.callEdges.some((e) => e.from === 'barrel-consumer.js' && e.to === 'barrel.js')).toBe(false);
    // module edges re-point too (guards subsystemEdges + modules against a future
    // refactor that decouples them from the same re-pointed target)
    expect(graph.modules.some((mo) => mo.from === 'barrel-consumer.js' && mo.to === 'lib/util.js')).toBe(true);
    expect(graph.modules.some((mo) => mo.from === 'barrel-consumer.js' && mo.to === 'barrel.js')).toBe(false);
  });

  it('excludes the ROOT archive/ but keeps a nested live archive/ dir', () => {
    // root archive/ is retired code — its channel and functions are dropped
    expect(graph.channels.some((c) => c.name === 'ghost:signal')).toBe(false);
    expect(graph.functions.some((f) => f.file.startsWith('archive/'))).toBe(false);
    // nested routes/archive/ is a live feature — its function IS mapped
    expect(graph.functions.some((f) => f.name === 'keptArchiveFn' && f.file === 'routes/archive/live.js')).toBe(true);
    // hidden scratch dir is dropped — no phantom class from retired excerpts
    expect(graph.functions.some((f) => f.name === 'GhostExcerpt')).toBe(false);
  });
});

describe('scanFindings', () => {
  it('returns a plan-ready findings report shape', async () => {
    const report = await scanFindings(root);
    expect(report).toHaveProperty('repo');
    expect(report).toHaveProperty('summary');
    expect(Array.isArray(report.findings)).toBe(true);
    for (const f of report.findings) {
      expect(f.id).toMatch(/^MV-\d{3}$/);
      expect(typeof f.suggestedFix).toBe('string');
    }
  });
});

describe('the dispatch-helper emit form', () => {
  /**
   * `send(connection, 'ns:verb', payload)` — a bare function wrapping the real
   * socket write, with the channel as a LATER argument. The method patterns only
   * see `.send('ns:verb')`, so this idiom was invisible and council-session.js's
   * eight channels reported as dead listeners while the feature demonstrably
   * worked. A false "disconnected" on live code is worse than a miss: it is what
   * teaches an operator to stop believing the map.
   */
  let helperGraph;

  beforeAll(async () => {
    const dir = await createTempDir('mapview-dispatch');
    const put = async (rel, text) => {
      await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await fs.writeFile(path.join(dir, rel), text);
    };
    await put('server.js', [
      "const send = (connection, type, payload) => connection.ws.send(JSON.stringify({ type, ...payload }));",
      "export const open = (c) => send(c, 'room:opened', { id: 1 });",
      "export const speak = (c) => send(c, 'room:spoke', { id: 2 });",
      "export const notAChannel = (c) => send(c, 'plain string with no colon');",
    ].join('\n'));
    await put('client.js', [
      "export const handle = (msg) => { switch (msg.type) { case 'room:opened': return 1; case 'room:spoke': return 2; } };",
    ].join('\n'));
    helperGraph = await scanArchitecture(dir);
  });

  const chan = (name) => helperGraph.channels.find((c) => c.name === name);

  it('sees a channel emitted through a dispatch helper', () => {
    expect(chan('room:opened')?.producers).toContain('server.js');
  });

  it('pairs it with the consumer, so the feature is not reported disconnected', () => {
    expect(chan('room:opened')?.consumers).toContain('client.js');
    expect(chan('room:spoke')?.consumers).toContain('client.js');
  });

  it('raises no unpaired-channel anomaly for a genuinely paired feature', () => {
    const severed = helperGraph.anomalies.filter(
      (a) => a.kind.startsWith('channel-') && a.label.startsWith('room:'),
    );
    expect(severed).toEqual([]);
  });

  it('invents no channel from an ordinary string argument', () => {
    expect(helperGraph.channels.map((c) => c.name))
      .not.toContain('plain string with no colon');
  });
});
