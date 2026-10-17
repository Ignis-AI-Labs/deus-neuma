/**
 * mapview/graph — PURE cross-file assembly. Given every file's extracted record
 * (from extract.js) plus its text, resolve the architecture graph: full routes
 * (mounts + inner paths), channels paired into producers/consumers, the
 * import-anchored call graph, and anomalies. No IO — scan.js supplies the inputs.
 */
import { buildHoistCandidates, hoistAdvice } from './hoist.js';
import { contaminationAdvice, findRootContamination, findRetiredToolSurface, findSizeViolations } from './hygiene.js';
import { findLayerViolations } from './layers.js';
import { findProtocolViolations } from './protocol.js';
import { buildUsage, computeReachability, detectEntryPoints, findCycles, findDeadExports } from './reach.js';

// Composite-key delimiter that no path or kind can contain. Built with
// fromCharCode so the SOURCE stays plain text — a raw NUL byte in this file
// made grep and every other text tool treat the module as binary.
const KEY_SEP = String.fromCharCode(0);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const directPackageName = (spec) => {
  const parts = String(spec || '').split('/');
  return parts[0]?.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

/**
 * Assemble the architecture graph. Pure.
 * @param {Array<{ relFile: string, text: string, record: object }>} files
 * @param {{ root: string, scannedFiles?: number }} opts
 * @returns {object} the graph
 */
export const buildGraph = (files, opts = {}) => {
  const fileSet = new Set(files.map((f) => f.relFile));
  const textOf = new Map(files.map((f) => [f.relFile, f.text]));
  const importsOf = new Map();
  const routers = new Map(); // file -> [{method, path, line, obj}]
  const mounts = [];
  const nextRoutes = [];
  const functions = [];
  const producers = new Map(); // channel -> Set(file)
  const consumers = new Map();
  const sites = new Map();     // channel -> [{file, line, role}]
  const packageKinds = new Map([
    ...Object.keys(opts.packageJson?.devDependencies || {}).map((name) => [name, 'development']),
    ...Object.keys(opts.packageJson?.optionalDependencies || {}).map((name) => [name, 'optional']),
    ...Object.keys(opts.packageJson?.dependencies || {}).map((name) => [name, 'runtime']),
  ]);
  const packageSites = new Map();

  const addCh = (map, ch, file) => { if (!map.has(ch)) map.set(ch, new Set()); map.get(ch).add(file); };

  for (const { relFile, record } of files) {
    if (record.imports.length) importsOf.set(relFile, record.imports);
    for (const imp of record.imports) {
      const name = directPackageName(imp.spec);
      const kind = packageKinds.get(name);
      if (!kind) continue;
      if (!packageSites.has(name)) packageSites.set(name, { name, kind, files: new Set() });
      packageSites.get(name).files.add(relFile);
    }
    if (record.routes.length) routers.set(relFile, record.routes);
    for (const r of record.nextRoutes) nextRoutes.push({ ...r, file: relFile, mountVar: 'app-router' });
    for (const mt of record.mounts) mounts.push({ ...mt, file: relFile });
    for (const fn of record.functions) functions.push({ file: relFile, ...fn });
    for (const s of record.channels) {
      addCh(s.role === 'producer' ? producers : consumers, s.name, relFile);
      if (!sites.has(s.name)) sites.set(s.name, []);
      sites.get(s.name).push({ file: relFile, line: s.line, role: s.role });
    }
  }
  const packageImports = [...packageSites.values()]
    .map((entry) => ({ ...entry, files: [...entry.files].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Resolve a mount's router var to an imported file that actually defines routes.
  const routerFileByVar = (mountFile, varName) => {
    const hit = (importsOf.get(mountFile) || []).find((i) => i.varName === varName);
    if (!hit) return null;
    for (const cand of hit.candidates) if (routers.has(cand)) return cand;
    return hit.candidates[0] || null;
  };
  const mountsResolved = mounts.map((mt) => ({ ...mt, routerFile: routerFileByVar(mt.file, mt.varName) }));

  const fullRoutes = [];
  const mountedFiles = new Set();
  for (const mt of mountsResolved) {
    if (!mt.routerFile || !routers.has(mt.routerFile)) continue;
    mountedFiles.add(mt.routerFile);
    for (const r of routers.get(mt.routerFile)) {
      if (r.obj === 'app') continue;
      // A router path of '/' contributes nothing beyond the mount prefix — Express
      // matches app.use('/api/foo', r) + r.get('/') as GET /api/foo, not /api/foo/.
      const inner = r.path === '/' ? '' : (r.path.startsWith('/') ? r.path : '/' + r.path);
      const full = (mt.prefix.replace(/\/$/, '') + inner) || '/';
      fullRoutes.push({ method: r.method, path: full, prefix: mt.prefix, file: mt.routerFile, line: r.line, mountVar: mt.varName });
    }
  }
  for (const [file, rs] of routers) {
    for (const r of rs) if (r.obj === 'app') fullRoutes.push({ method: r.method, path: r.path, prefix: '(inline)', file, line: r.line, mountVar: 'app' });
  }
  fullRoutes.push(...nextRoutes);

  // Channels summary.
  const allChannels = new Set([...producers.keys(), ...consumers.keys()]);
  const channels = [...allChannels].sort().map((ch) => ({
    name: ch,
    namespace: ch.split(':')[0],
    producers: [...(producers.get(ch) || [])].sort(),
    consumers: [...(consumers.get(ch) || [])].sort(),
    sites: (sites.get(ch) || []).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
  }));

  // Barrel re-export map: barrelFile → (exportedName → { real defining file,
  // sourceName it pulls from there }). Built from `export { X as Y } from './x.js'`
  // so a call routed through a barrel attributes to the module that owns the code,
  // not the transparent barrel itself — and so usage credits land on the SOURCE
  // name the real file actually exports, not the alias a hop invented.
  const reexportMap = new Map();
  for (const { relFile, record } of files) {
    if (!record.reexports || !record.reexports.length) continue;
    const named = new Map();
    for (const rx of record.reexports) {
      const real = rx.candidates.find((c) => fileSet.has(c));
      if (real && real !== relFile) named.set(rx.name, { real, sourceName: rx.sourceName || rx.name });
    }
    if (named.size) reexportMap.set(relFile, named);
  }
  // Follow a resolved import target through barrels to the file that defines the
  // given binding, tracking the name as each hop translates it. Bounded loop
  // (barrels don't cycle in practice; the visited set guards anyway) so it
  // terminates. Both callEdges AND moduleEdges re-point to the real module: this
  // is a code-OWNERSHIP map (where the code lives), not a build-dependency graph —
  // the barrel is a transparent pass-through, so showing it as a dependency hub
  // would mislead more than the lost literal import edge. Pure.
  const throughBarrel = (to, name) => {
    const visited = new Set();
    let cur = to;
    let curName = name;
    while (reexportMap.has(cur) && reexportMap.get(cur).has(curName) && !visited.has(cur)) {
      visited.add(cur);
      const hop = reexportMap.get(cur).get(curName);
      cur = hop.real;
      curName = hop.sourceName;
    }
    return { file: cur, name: curName };
  };

  // Import-anchored call edges: count `varName(` in the importing file's body.
  // moduleEdges is a from→Set(to) Map (not joined strings) so paths with spaces
  // can never corrupt the from/to split.
  const callEdges = [];
  const moduleEdges = new Map();
  // The runtime evaluates a barrel file BEFORE anything it re-exports, so when
  // the ownership edge is re-pointed past one, the literal hop is kept here for
  // the reachability walk alone. Without it every pure re-export shim — and
  // every file only the shim's own imports pull in — reads as unreachable
  // (frontend/utils/tool-stream-filter.js and the core/continuity barrel's
  // private leaves were reported dead this way).
  const literalHops = [];
  for (const [file, imps] of importsOf) {
    const text = textOf.get(file) || '';
    const perTarget = new Map();
    for (const imp of imps) {
      const resolved = imp.candidates.find((c) => fileSet.has(c));
      // Re-point through any barrel so the edge lands on the real defining module.
      // A nameless ref (side-effect / dynamic / star re-export) cannot be followed
      // through a barrel — there is no binding to follow — so it lands as-resolved.
      // The barrel is keyed by the name the importer ASKED FOR (the source side of
      // its clause), never the local alias the importer invented.
      const to = resolved ? (imp.varName ? throughBarrel(resolved, imp.sourceName || imp.varName).file : resolved) : resolved;
      if (resolved && to && to !== resolved && resolved !== file) literalHops.push({ from: file, to: resolved });
      if (!to || to === file) continue;
      if (!moduleEdges.has(file)) moduleEdges.set(file, new Set());
      moduleEdges.get(file).add(to);
      // Only a bound name can be invoked. `import './a'`, `await import('./a')` and
      // `export * from './a'` are real dependencies with no call site to attribute,
      // so they contribute the module edge above and nothing to the call graph.
      if (!imp.varName) continue;
      const count = (text.match(new RegExp('\\b' + escapeRe(imp.varName) + '\\s*\\(', 'g')) || []).length;
      if (count === 0) continue;
      if (!perTarget.has(to)) perTarget.set(to, { via: new Set(), count: 0 });
      const agg = perTarget.get(to);
      agg.via.add(imp.varName);
      agg.count += count;
    }
    for (const [to, agg] of perTarget) callEdges.push({ from: file, to, via: [...agg.via].sort(), count: agg.count });
  }
  const modules = [];
  for (const [from, tos] of moduleEdges) for (const to of tos) modules.push({ from, to });

  // Subsystems: cluster files by their directory — the repo's own domain layout
  // (core/memory, core/continuity, backend/services…) IS its functional systems.
  // subsystemEdges aggregate the call graph up to system→system dependencies.
  const dirOf = (f) => { const a = f.split('/'); a.pop(); return a.join('/') || '(root)'; };
  const sysFiles = new Map(); // dir -> Set(file)
  const sysFns = new Map();   // dir -> function count
  const touchSys = (file) => {
    const d = dirOf(file);
    if (!sysFiles.has(d)) sysFiles.set(d, new Set());
    sysFiles.get(d).add(file);
    return d;
  };
  for (const fn of functions) { const d = touchSys(fn.file); sysFns.set(d, (sysFns.get(d) || 0) + 1); }
  for (const r of fullRoutes) touchSys(r.file);
  for (const c of channels) { c.producers.forEach(touchSys); c.consumers.forEach(touchSys); }
  for (const e of callEdges) { touchSys(e.from); touchSys(e.to); }
  const sysEdge = new Map(); // from -> Map(to -> summed count) — nested Map avoids any path-delimiter hazard
  for (const e of callEdges) {
    const a = dirOf(e.from), b = dirOf(e.to);
    if (a === b) continue;
    if (!sysEdge.has(a)) sysEdge.set(a, new Map());
    sysEdge.get(a).set(b, (sysEdge.get(a).get(b) || 0) + e.count);
  }
  const subsystems = [...sysFiles.keys()].sort().map((id) => ({ id, files: sysFiles.get(id).size, functions: sysFns.get(id) || 0 }));
  const subsystemEdges = [];
  for (const [from, tos] of sysEdge) for (const [to, count] of tos) subsystemEdges.push({ from, to, count });

  // External egress: aggregate outbound sites per (file, kind). This is the app's
  // connection surface to the outside world — invisible to routes/channels/calls.
  const extAgg = new Map(); // `${file}${KEY_SEP}${kind}` -> { file, kind, count, hosts:Set }
  for (const { relFile, record } of files) {
    for (const e of (record.external || [])) {
      const k = `${relFile}${KEY_SEP}${e.kind}`;
      if (!extAgg.has(k)) extAgg.set(k, { file: relFile, kind: e.kind, count: 0, hosts: new Set() });
      const agg = extAgg.get(k);
      agg.count += 1;
      if (e.host) agg.hosts.add(e.host);
    }
  }
  const external = [...extAgg.values()]
    .map((a) => ({ file: a.file, kind: a.kind, count: a.count, hosts: [...a.hosts].sort() }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind));
  const externalSites = external.reduce((n, e) => n + e.count, 0);

  // Storage access: aggregate filesystem read/write sites per (file, kind) — which
  // modules touch DISK, and how. Another connection route the code graph hides.
  const stoAgg = new Map(); // `${file} ${kind}` -> { file, kind, count }
  for (const { relFile, record } of files) {
    for (const s of (record.storage || [])) {
      const k = `${relFile} ${s.kind}`;
      if (!stoAgg.has(k)) stoAgg.set(k, { file: relFile, kind: s.kind, count: 0 });
      stoAgg.get(k).count += 1;
    }
  }
  const storage = [...stoAgg.values()]
    .sort((a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind));
  const storageSites = storage.reduce((n, s) => n + s.count, 0);

  // Env-var dependencies: group by var NAME with the files that read it — the app's
  // config/secrets surface. A dynamic `process.env[expr]` read is grouped under a
  // single '(dynamic)' bucket (name unknown at scan time, never invented).
  const envAgg = new Map(); // name -> { name, files:Set, count }
  for (const { relFile, record } of files) {
    for (const e of (record.env || [])) {
      const name = e.name || '(dynamic)';
      if (!envAgg.has(name)) envAgg.set(name, { name, files: new Set(), count: 0 });
      const agg = envAgg.get(name);
      agg.files.add(relFile);
      agg.count += 1;
    }
  }
  const env = [...envAgg.values()]
    .map((a) => ({ name: a.name, files: [...a.files].sort(), count: a.count }))
    .sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name));
  const envRefCount = env.reduce((n, e) => n + e.count, 0);

  // Middleware pipeline: group each middleware by name with the files that apply it
  // (the auth/security surface). scope 'router' = X.use(mw); 'route' = per-route mw.
  const mwAgg = new Map(); // name -> { name, files:Set, count, scopes:Set, sites:Array }
  for (const { relFile, record } of files) {
    for (const mw of (record.middleware || [])) {
      if (!mwAgg.has(mw.name)) mwAgg.set(mw.name, {
        name: mw.name, files: new Set(), count: 0, scopes: new Set(), sites: [],
      });
      const agg = mwAgg.get(mw.name);
      agg.files.add(relFile); agg.count += 1; agg.scopes.add(mw.scope);
      agg.sites.push({ file: relFile, line: mw.line, scope: mw.scope });
    }
  }
  const middleware = [...mwAgg.values()]
    .map((a) => ({
      name: a.name, files: [...a.files].sort(), count: a.count,
      scopes: [...a.scopes].sort(), sites: a.sites.sort((l, r) => l.file.localeCompare(r.file) || l.line - r.line),
    }))
    .sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name));
  const middlewareSites = middleware.reduce((n, mw) => n + mw.count, 0);

  // Primitives / duplication: free functions defined in 2+ files. Grouping by name
  // alone over-reports (a per-module `main`/`run` is not duplication), so within each
  // name we group by BODY FINGERPRINT (sig) — a fingerprint shared by 2+ files is a
  // CONFIRMED exact-copy duplicate (real consolidation target); same name + different
  // bodies are candidates to verify. The sig is an internal signal, stripped below.
  const byFnName = new Map(); // name -> [{ file, sig }]
  for (const f of functions) {
    if ((f.kind || 'function') !== 'function') continue;
    if (!byFnName.has(f.name)) byFnName.set(f.name, []);
    byFnName.get(f.name).push({ file: f.file, sig: f.sig });
  }
  const duplicates = [];
  for (const [name, defs] of byFnName) {
    const files = new Set(defs.map((d) => d.file));
    if (files.size < 2) continue;
    const bySig = new Map();
    // A null sig means the body could not be located — such entries are NEVER
    // asserted identical (that would be a false exact-copy); they stay in `files`
    // as candidates but are excluded from the exact-copy clustering.
    for (const d of defs) { if (!d.sig) continue; if (!bySig.has(d.sig)) bySig.set(d.sig, new Set()); bySig.get(d.sig).add(d.file); }
    // ALL exact-copy clusters (a body shared by 2+ files), largest first — a name
    // can have more than one distinct duplicated body, and hiding the rest would
    // under-report the duplication.
    const clusters = [...bySig.values()].filter((s) => s.size >= 2).map((s) => [...s].sort()).sort((a, b) => b.length - a.length);
    duplicates.push({
      name,
      files: [...files].sort(),
      clusters,                        // each = files with a byte-identical body (>=2)
      exactCopies: clusters.length ? clusters[0].length : 0, // largest cluster (for the stat/sort)
      confirmed: clusters.length > 0,
    });
  }
  duplicates.sort((a, b) => (b.exactCopies - a.exactCopies) || (b.files.length - a.files.length) || a.name.localeCompare(b.name));

  // Connectivity: what can actually be reached from something that runs.
  const { namedBy, opaque } = buildUsage({
    importsOf, files, usageFiles: opts.usageFiles || [], fileSet, throughBarrel,
  });
  const allFiles = [...fileSet].sort();
  const entryPoints = detectEntryPoints({
    files: allFiles,
    packageJson: opts.packageJson || {},
    htmlScriptSrcs: opts.htmlScriptSrcs || [],
    configEntries: opts.configEntries || [],
  });
  const entryFiles = new Set(entryPoints.map((e) => e.file));
  // Reachability walks the LITERAL load graph (ownership edges + the barrel
  // hops they skipped); cycles stay on ownership edges — a transparent barrel
  // must not fabricate a cycle the real modules don't have.
  const { unreachable } = computeReachability(modules.concat(literalHops), [...entryFiles], allFiles);
  const cycles = findCycles(modules);
  const deadExports = findDeadExports(functions, { namedBy, opaque }, entryFiles);
  const connectivity = { entryPoints, unreachable, cycles, deadExports };
  const hoistCandidates = buildHoistCandidates(functions, { minBody: opts.minPrimitiveBody });
  // Layer law fires ONLY against rules the operator signed into the config.
  const layerViolations = findLayerViolations(modules, opts.layers);
  const rootContamination = findRootContamination(opts.rootEntries || [], opts.rootAllowlist);
  const retiredToolRefs = findRetiredToolSurface(files, opts.retiredToolNames || []);
  const sizeViolations = findSizeViolations(opts.fileSizes || {}, opts.sizeBaseline || {});

  // Anomalies.
  const anomalies = [];
  const seen = new Map();
  for (const r of fullRoutes) {
    const key = `${r.method} ${r.path}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(r);
  }
  // Every anomaly carries the files it implicates, so a warning can be scoped to
  // the file that was just edited — that is what makes this usable as a live
  // check rather than an audit report.
  for (const [key, list] of seen) {
    if (list.length > 1) anomalies.push({ kind: 'duplicate-route', severity: 'warn', label: key, files: list.map((r) => r.file), detail: `Registered ${list.length}× — ${list.map((r) => `${r.file}:${r.line}`).join(', ')}` });
  }
  for (const ch of channels) {
    if (ch.producers.length && !ch.consumers.length) anomalies.push({ kind: 'channel-no-consumer', severity: 'info', label: ch.name, files: ch.producers, detail: `Emitted (${ch.producers.join(', ')}) but no detected consumer — likely a client/dynamic listener, verify.` });
    if (ch.consumers.length && !ch.producers.length) anomalies.push({ kind: 'channel-no-producer', severity: 'info', label: ch.name, files: ch.consumers, detail: `Consumed (${ch.consumers.join(', ')}) but no detected emitter — likely a client/dynamic producer, verify.` });
  }
  for (const [file, rs] of routers) {
    if (rs.some((r) => r.obj !== 'app') && !mountedFiles.has(file)) anomalies.push({ kind: 'router-unmounted', severity: 'warn', label: file, files: [file], detail: 'Defines routes but no app.use mount resolved — dead surface or dynamic mount.' });
  }
  for (const file of connectivity.unreachable) {
    anomalies.push({ kind: 'module-unreachable', severity: 'warn', label: file, files: [file], detail: `No path from any of the ${entryPoints.length} entry points reaches this file — dead surface, or an entry point mapview does not know about.` });
  }
  for (const cycle of connectivity.cycles) {
    anomalies.push({ kind: 'import-cycle', severity: 'warn', label: cycle.join(' ↔ '), files: cycle, detail: `Circular imports: ${cycle.join(' → ')} → ${cycle[0]}. None of these can be extracted, tested, or reasoned about alone.` });
  }
  // Two findings with wildly different risk hide behind "dead export": a symbol
  // nobody references at all (DELETE the code) versus a live in-file function
  // whose export keyword is the only dead part (DROP the keyword, keep the code).
  // Splitting them by counting the name in the file body beyond its declaration
  // turned a 274-item wall into ~113 actionable deletions.
  for (const d of connectivity.deadExports) {
    const body = textOf.get(d.file) || '';
    const uses = (body.match(new RegExp(`\\b${escapeRe(d.name)}\\b`, 'g')) || []).length;
    if (uses > 1) {
      anomalies.push({ kind: 'over-export', severity: 'info', label: `${d.name} (${d.file}:${d.line})`, files: [d.file], detail: 'No module imports this by name, but the file uses it itself — the export keyword is the only dead part. Drop the keyword to make it private.' });
    } else {
      anomalies.push({ kind: 'dead-export', severity: 'info', label: `${d.name} (${d.file}:${d.line})`, files: [d.file], detail: 'Exported and never referenced again anywhere — not by an importer, not by this file. Delete the symbol.' });
    }
  }
  for (const h of hoistCandidates) {
    anomalies.push({ kind: 'hoist-candidate', severity: 'warn', label: h.names.join(' / '), files: h.sites.map((s) => s.file), detail: hoistAdvice(h) });
  }
  for (const name of rootContamination) {
    anomalies.push({ kind: 'root-contamination', severity: 'warn', label: name, files: [name], detail: contaminationAdvice(name) });
  }
  for (const v of layerViolations) {
    anomalies.push({ kind: 'layer-violation', severity: 'warn', label: `${v.from} → ${v.to}`, files: [v.from, v.to], detail: `Breaks the signed rule "${v.rule.from}/ must not import ${v.rule.to}/". ${v.rule.reason || ''}`.trim() });
  }
  // Protocol law fires ONLY against rules the operator signed (protocol.js).
  anomalies.push(...findProtocolViolations(files.concat(opts.usageFiles || []), opts.protocol));
  for (const r of retiredToolRefs) {
    anomalies.push({ kind: 'retired-tool-ref', severity: 'warn', label: r.retired, files: [r.file], detail: `Still references retired tool "${r.retired}". Remove dead code or migrate to fs primitives + intents + status files per S3b4/S3b5.` });
  }
  for (const s of sizeViolations) {
    const kind = s.kind === 'size-law-growth' ? 'size-law-growth' : 'bloat-monolith';
    anomalies.push({ kind, severity: 'warn', label: s.file, files: [s.file], detail: kind === 'size-law-growth' ? `Grew to ${s.size} lines (frozen ${s.frozen}). Decompose to obey size law.` : `Over 5k lines (${s.size}). Split per protocol — no more 8k-line monsters.` });
  }

  return {
    meta: {
      root: opts.root || '',
      scannedFiles: opts.scannedFiles ?? files.length,
      routeCount: fullRoutes.length,
      channelCount: channels.length,
      // functionCount keeps its original meaning (free functions only) for
      // back-compat; classes and methods are counted alongside so the totals are
      // honest — the graph.functions array carries every definition, each tagged.
      functionCount: functions.filter((f) => (f.kind || 'function') === 'function').length,
      classCount: functions.filter((f) => f.kind === 'class').length,
      methodCount: functions.filter((f) => f.kind === 'method').length,
      definitionCount: functions.length,
      subsystemCount: subsystems.length,
      externalCount: externalSites,
      externalFileCount: new Set(external.map((e) => e.file)).size,
      storageCount: storageSites,
      storageFileCount: new Set(storage.map((s) => s.file)).size,
      envVarCount: env.filter((e) => e.name !== '(dynamic)').length,
      envRefCount,
      directPackageCount: packageImports.length,
      duplicateExactCount: duplicates.filter((d) => d.confirmed).length,
      duplicateNameCount: duplicates.length,
      middlewareCount: middleware.length,
      middlewareSites,
      entryPointCount: entryPoints.length,
      unreachableCount: connectivity.unreachable.length,
      cycleCount: cycles.length,
      deadExportCount: deadExports.length,
      hoistCandidateCount: hoistCandidates.length,
      layerViolationCount: layerViolations.length,
      rootContaminationCount: rootContamination.length,
      duplicatedBytes: hoistCandidates.reduce((n, h) => n + h.duplicatedBytes, 0),
      anomalyCount: anomalies.length,
    },
    routes: fullRoutes.sort((a, b) => (a.prefix + a.path).localeCompare(b.prefix + b.path)),
    channels,
    // sig is an internal duplicate-detection signal — strip it from the public graph.
    functions: functions.map(({ sig, ...f }) => f).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    callEdges: callEdges.sort((a, b) => b.count - a.count),
    modules,
    subsystems: subsystems.sort((a, b) => b.files - a.files || a.id.localeCompare(b.id)),
    subsystemEdges: subsystemEdges.sort((a, b) => b.count - a.count),
    external,
    storage,
    env,
    packageImports,
    middleware,
    duplicates,
    connectivity,
    hoistCandidates,
    layerViolations,
    rootContamination,
    anomalies: anomalies.sort((a, b) => (a.severity === 'warn' ? -1 : 1)),
  };
};

// The plan-ready findings report lives in findings.js (size law); scan.js
// composes it over this graph.
