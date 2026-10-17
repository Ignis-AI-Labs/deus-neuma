// map-view.js — PURE shaping of the architecture graph for the Map window.
// Grouping and indexing only; no React, no IO — so the view logic is unit-tested
// without a browser and the component stays a thin renderer over these.

/** Group full routes by mount prefix, prefixes sorted. Pure. */
export const groupRoutesByPrefix = (routes = []) => {
  const by = new Map();
  for (const r of routes) {
    if (!by.has(r.prefix)) by.set(r.prefix, []);
    by.get(r.prefix).push(r);
  }
  return [...by.keys()].sort().map((prefix) => ({
    prefix,
    routes: by.get(prefix).slice().sort((a, b) => a.path.localeCompare(b.path)),
  }));
};

/** Group channels by namespace, namespaces sorted. Pure. */
export const groupChannelsByNamespace = (channels = []) => {
  const by = new Map();
  for (const c of channels) {
    if (!by.has(c.namespace)) by.set(c.namespace, []);
    by.get(c.namespace).push(c);
  }
  return [...by.keys()].sort().map((namespace) => ({
    namespace,
    channels: by.get(namespace).slice().sort((a, b) => a.name.localeCompare(b.name)),
  }));
};

/** A channel is unpaired when it has producers XOR consumers. Pure. */
export const isUnpaired = (channel) =>
  (channel.producers.length > 0) !== (channel.consumers.length > 0);

/** Tally a file's definitions by kind (function / method / class). Pure. */
export const defnKindCounts = (fns = []) => {
  const counts = { function: 0, method: 0, class: 0 };
  for (const f of fns) counts[f.kind || 'function'] = (counts[f.kind || 'function'] || 0) + 1;
  return counts;
};

/**
 * Per-file index of defined units (functions, methods, classes) and call edges.
 * Each entry carries a `kinds` tally so the view can label what a file actually
 * declares instead of lumping everything as "functions". Pure.
 * @returns {Array<{ file, fns, kinds, out, in }>} sorted by connectedness then name
 */
export const fileFunctionIndex = (functions = [], callEdges = []) => {
  const idx = new Map();
  const at = (file) => {
    if (!idx.has(file)) idx.set(file, { file, fns: [], out: [], in: [] });
    return idx.get(file);
  };
  for (const f of functions) at(f.file).fns.push(f);
  for (const e of callEdges) { at(e.from).out.push(e); at(e.to).in.push(e); }
  return [...idx.values()]
    .map((e) => ({ ...e, kinds: defnKindCounts(e.fns) }))
    .sort((a, b) => (b.out.length + b.in.length) - (a.out.length + a.in.length) || a.file.localeCompare(b.file));
};

/**
 * Group outbound egress by kind (http / rpc / ws-client / mcp), each kind sorted
 * heaviest-first with its files and the distinct literal hosts it dials. Pure.
 * @returns {Array<{ kind, sites, files, hosts, entries }>}
 */
export const groupExternalByKind = (external = []) => {
  const by = new Map();
  for (const e of external) {
    if (!by.has(e.kind)) by.set(e.kind, []);
    by.get(e.kind).push(e);
  }
  return [...by.keys()].sort().map((kind) => {
    const entries = by.get(kind).slice().sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
    return {
      kind,
      sites: entries.reduce((n, e) => n + e.count, 0),
      files: entries.length,
      hosts: [...new Set(entries.flatMap((e) => e.hosts))].sort(),
      entries,
    };
  });
};

/**
 * Group filesystem access by kind (read / write), each sorted heaviest-first with
 * its files. Pure.
 * @returns {Array<{ kind, sites, files, entries }>}
 */
export const groupStorageByKind = (storage = []) => {
  const by = new Map();
  for (const s of storage) {
    if (!by.has(s.kind)) by.set(s.kind, []);
    by.get(s.kind).push(s);
  }
  return [...by.keys()].sort().map((kind) => {
    const entries = by.get(kind).slice().sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
    return { kind, sites: entries.reduce((n, e) => n + e.count, 0), files: entries.length, entries };
  });
};

/**
 * Order env-var dependencies for display: real named vars first (most-used first),
 * the '(dynamic)' bucket always last. Pure.
 */
export const orderEnvVars = (env = []) =>
  env.slice().sort((a, b) => {
    const ad = a.name === '(dynamic)', bd = b.name === '(dynamic)';
    if (ad !== bd) return ad ? 1 : -1;
    return (b.files?.length || 0) - (a.files?.length || 0) || a.name.localeCompare(b.name);
  });

/** A var name reads as a secret when it mentions a key/secret/token/password. Pure. */
export const looksSecret = (name = '') => /(?:^|_)(KEY|SECRET|TOKEN|PASSWORD|PASS|CREDENTIAL|PRIVATE)S?(?:_|$)/i.test(name);

/** A middleware name reads as auth/security when it mentions auth/guard/require. Pure. */
export const looksGuard = (name = '') => /auth|guard|require|permission|verify|csrf|helmet|cors|security/i.test(name);

/**
 * Split duplicate free-functions into CONFIRMED exact copies (same name AND
 * identical body — real consolidation targets) and same-name CANDIDATES (verify).
 * Each already carries files / exactFiles / exactCopies from the graph. Pure.
 * @returns {{ confirmed: Array, candidates: Array }}
 */
export const splitDuplicates = (duplicates = []) => ({
  confirmed: duplicates.filter((d) => d.confirmed),
  candidates: duplicates.filter((d) => !d.confirmed),
});

/** The basename of a repo-relative path. Pure. */
export { baseName, dirOf } from '../../utils/path.js';

/**
 * A subsystem's dependency neighborhood: which systems depend ON it (dependents,
 * incoming) and which it depends on (dependencies, outgoing), each with the
 * aggregated call count, sorted heaviest-first. Pure.
 */
export const systemFocus = (subsystemEdges = [], selectedId) => ({
  dependents: subsystemEdges.filter((e) => e.to === selectedId)
    .map((e) => ({ id: e.from, count: e.count })).sort((a, b) => b.count - a.count),
  dependencies: subsystemEdges.filter((e) => e.from === selectedId)
    .map((e) => ({ id: e.to, count: e.count })).sort((a, b) => b.count - a.count),
});

/**
 * Lay out a three-column wiring board: producers/dependents on the left, the
 * focus node(s) in the middle, consumers/dependencies on the right, with bezier
 * edge paths. PURE geometry — the component renders the returned nodes/paths as
 * SVG and drives hover highlighting from the shared ids.
 *
 * @param {Array<{id,label,sub?,cls?}>} left
 * @param {Array<{id,label,sub?,cls?}>} mid
 * @param {Array<{id,label,sub?,cls?}>} right
 * @param {Array<{side:'L'|'M', a:string, b:string, sev?:boolean}>} edges
 * @param {object} [dims]
 * @returns {{ width:number, height:number, nodes:Array, paths:Array }}
 */
export const wireLayout = (left, mid, right, edges, dims = {}) => {
  const { rowH = 34, padY = 22, colW = 232, midW = 220, gap = 60 } = dims;
  const width = colW * 2 + midW + gap * 2 + 24;
  const height = Math.max(left.length, mid.length, right.length, 1) * rowH + padY * 2;
  const xL = 12, xM = colW + gap + 12, xR = colW + gap + midW + gap + 12;
  const yAt = (i) => padY + i * rowH + rowH / 2;
  const place = (arr, x, w, side) => arr.map((n, i) => ({ ...n, x, y: yAt(i), w, side }));
  const nodes = [
    ...place(left, xL, colW, 'L'),
    ...place(mid, xM, midW, 'M'),
    ...place(right, xR, colW, 'R'),
  ];
  const pos = Object.fromEntries(nodes.map((n) => [`${n.side}:${n.id}`, n.y]));
  const paths = edges.map((e) => {
    const x1 = e.side === 'L' ? xL + colW : xM + midW;
    const y1 = pos[`${e.side === 'L' ? 'L' : 'M'}:${e.a}`];
    const x2 = e.side === 'L' ? xM : xR;
    const y2 = pos[`${e.side === 'L' ? 'M' : 'R'}:${e.b}`];
    const dx = (x2 - x1) / 2;
    return { a: e.a, b: e.b, sev: Boolean(e.sev), d: `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}` };
  });
  return { width, height, nodes, paths };
};
