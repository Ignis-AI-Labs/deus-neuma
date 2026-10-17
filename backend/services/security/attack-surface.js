import fs from 'fs/promises';
import path from 'path';
import { scanArchitecture } from '../mapview/scan.js';
import { getAppConfig } from '../../config.js';

const CACHE_MS = 30_000;
const MAX_DEPENDENCY_PATHS = 30;
const MAX_ROUTE_ENTRIES = 300;
const architectureCache = new Map();
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

/** npm package name represented by one package-lock `packages` key. Pure. */
const lockPackageName = (key) => {
  const marker = String(key).lastIndexOf('node_modules/');
  return marker === -1 ? null : String(key).slice(marker + 'node_modules/'.length) || null;
};

/** Physical parent package key for Node's upward dependency resolution. Pure. */
const parentPackageKey = (key) => {
  const marker = String(key).lastIndexOf('/node_modules/');
  return marker === -1 ? '' : String(key).slice(0, marker);
};

/** Resolve one declared dependency to the package-lock node Node would load. Pure. */
const resolveDependencyKey = (packages, parentKey, dependencyName) => {
  let cursor = parentKey;
  while (true) {
    const candidate = cursor
      ? `${cursor}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`;
    if (own(packages, candidate)) return candidate;
    if (!cursor) return null;
    cursor = parentPackageKey(cursor);
  }
};

const dependencyNames = (meta, root) => new Set([
  ...Object.keys(meta?.dependencies || {}),
  ...Object.keys(meta?.optionalDependencies || {}),
  ...Object.keys(meta?.peerDependencies || {}),
  ...(root ? Object.keys(meta?.devDependencies || {}) : []),
]);

const directDependencyKind = (root, name) => {
  if (own(root?.dependencies, name)) return 'runtime';
  if (own(root?.optionalDependencies, name)) return 'optional';
  if (own(root?.devDependencies, name)) return 'development';
  return 'transitive';
};

/** Build the installed package graph from package-lock v2/v3 data. Pure. */
const buildLockGraph = (lockJson) => {
  const packages = lockJson?.packages && typeof lockJson.packages === 'object'
    ? lockJson.packages
    : {};
  const edges = new Map();
  for (const [key, meta] of Object.entries(packages)) {
    const children = [];
    for (const name of dependencyNames(meta, key === '')) {
      const child = resolveDependencyKey(packages, key, name);
      if (child) children.push(child);
    }
    edges.set(key, [...new Set(children)].sort());
  }
  return Object.freeze({ packages, edges });
};

/** Every bounded root-to-package chain plus untraced installed instances. Pure. */
export const dependencyPathsFor = (lockJson, packageName, version = null) => {
  const graph = buildLockGraph(lockJson);
  const targets = new Set(Object.entries(graph.packages)
    .filter(([key, meta]) => lockPackageName(key) === packageName
      && (!version || meta?.version === version))
    .map(([key]) => key));
  const paths = [];
  const queue = [{ key: '', path: [] }];
  while (queue.length && paths.length < MAX_DEPENDENCY_PATHS) {
    const current = queue.shift();
    for (const child of graph.edges.get(current.key) || []) {
      if (current.path.some((node) => node.key === child)) continue;
      const meta = graph.packages[child] || {};
      const node = Object.freeze({ key: child, name: lockPackageName(child), version: meta.version || null });
      const nextPath = [...current.path, node];
      if (targets.has(child)) paths.push(Object.freeze(nextPath));
      if (nextPath.length < 20) queue.push({ key: child, path: nextPath });
    }
  }
  const reached = new Set(paths.map((entry) => entry.at(-1)?.key));
  const installed = [...targets].sort().map((key) => Object.freeze({
    key,
    version: graph.packages[key]?.version || null,
    reachableFromRoot: reached.has(key),
  }));
  const root = graph.packages[''] || {};
  const roots = [...new Map(paths
    .filter((entry) => entry.length)
    .map((entry) => [entry[0].name, Object.freeze({
      name: entry[0].name,
      version: entry[0].version,
      kind: directDependencyKind(root, entry[0].name),
    })])).values()];
  return Object.freeze({ package: packageName, version, installed, roots, paths });
};

/** All source modules that can call into any seed module. Pure. */
const moduleAncestors = (seeds, moduleEdges) => {
  const reverse = new Map();
  for (const edge of moduleEdges || []) {
    if (!reverse.has(edge.to)) reverse.set(edge.to, []);
    reverse.get(edge.to).push(edge.from);
  }
  const seen = new Set(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const file = queue.shift();
    for (const parent of reverse.get(file) || []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      queue.push(parent);
    }
  }
  return seen;
};

/** Auth evidence for one route; absence is explicitly not asserted public. Pure. */
export const routeProtection = (route, middleware) => {
  const authSites = (middleware || [])
    .filter((entry) => entry.name === 'requireAuth')
    .flatMap((entry) => entry.sites || []);
  const guarded = authSites.some((site) => {
    if (site.file !== route.file) return false;
    if (site.scope === 'route') return site.line === route.line;
    return site.scope === 'router'
      && Number.isFinite(site.line) && Number.isFinite(route.line)
      && site.line <= route.line;
  });
  return guarded ? 'authenticated' : 'public_or_unverified';
};

const deployment = () => {
  let config;
  try {
    config = getAppConfig();
  } catch {
    config = {
      host: process.env.HOST || '127.0.0.1',
      port: Number(process.env.PORT) || 3333,
    };
  }
  const host = String(config.host || '127.0.0.1').replace(/^\[|\]$/g, '');
  return Object.freeze({
    host,
    port: Number(config.port) || 3333,
    directNetworkExposure: !LOOPBACK_HOSTS.has(host),
    caveat: 'Direct bind only; a reverse proxy, tunnel, or host firewall is not inferred from source.',
  });
};

const cachedArchitecture = async (repoPath) => {
  const root = path.resolve(repoPath);
  const cached = architectureCache.get(root);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = scanArchitecture(root).catch((error) => {
    architectureCache.delete(root);
    throw error;
  });
  architectureCache.set(root, { value, expiresAt: Date.now() + CACHE_MS });
  return value;
};

const routeEntries = (graph) => (graph.routes || []).slice(0, MAX_ROUTE_ENTRIES).map((route) => Object.freeze({
  method: route.method,
  path: route.path,
  file: route.file,
  protection: routeProtection(route, graph.middleware),
}));

/** Current deployment-specific structural map for one watched repository. impure. */
export const readArchitectureSurface = async (repoPath) => {
  const graph = await cachedArchitecture(repoPath);
  const routes = routeEntries(graph);
  const authenticated = routes.filter((route) => route.protection === 'authenticated').length;
  return Object.freeze({
    measuredAt: new Date().toISOString(),
    repoPath: path.resolve(repoPath),
    deployment: deployment(),
    summary: Object.freeze({
      scannedFiles: graph.meta.scannedFiles,
      routes: graph.meta.routeCount,
      authenticatedRoutes: authenticated,
      publicOrUnverifiedRoutes: routes.length - authenticated,
      externalEgressSites: graph.meta.externalCount,
      storageSites: graph.meta.storageCount,
      directImportedPackages: graph.meta.directPackageCount,
    }),
    routes: Object.freeze(routes),
    external: Object.freeze((graph.external || []).slice(0, 100)),
    storage: Object.freeze((graph.storage || []).slice(0, 100)),
    packageImports: Object.freeze(graph.packageImports || []),
    middleware: Object.freeze((graph.middleware || []).map((entry) => ({
      name: entry.name, count: entry.count, sites: entry.sites,
    }))),
    graph,
  });
};

/** Pick only a repository already admitted to the security watch. Pure. */
export const selectWatchedRepo = (watch, repoId = null, cwd = process.cwd()) => {
  const repos = Array.isArray(watch?.repos) ? watch.repos : [];
  const repo = repoId
    ? repos.find((entry) => entry.id === repoId)
    : repos.find((entry) => path.resolve(entry.path) === path.resolve(cwd)) || repos[0];
  if (!repo) throw new Error(repoId ? `no watched repo ${repoId}` : 'no repositories are on the security watch');
  return repo;
};

const exposureClass = ({ roots, importers, routes, directNetworkExposure }) => {
  if (!roots.length) return 'installed_but_dependency_chain_untraced';
  if (roots.every((root) => root.kind === 'development') && !importers.length) return 'build_or_development_time';
  if (!importers.length) return 'installed_without_static_runtime_import';
  if (!routes.length) return 'local_runtime_or_build_path';
  if (routes.some((route) => route.protection === 'public_or_unverified')) {
    return directNetworkExposure ? 'network_reachable_candidate' : 'loopback_route_candidate';
  }
  return directNetworkExposure ? 'authenticated_network_candidate' : 'authenticated_loopback_candidate';
};

/** Map one software threat to installed dependency chains and reachable routes. impure. */
export const mapThreatAttackSurface = async (threat, repoPath) => {
  if (!threat || threat.layer !== 'software') {
    return Object.freeze({ measuredAt: new Date().toISOString(), threatId: threat?.id || null, error: 'attack-surface dependency mapping requires a software threat' });
  }
  const [lockRaw, surface] = await Promise.all([
    fs.readFile(path.join(repoPath, 'package-lock.json'), 'utf8'),
    readArchitectureSurface(repoPath),
  ]);
  const lockJson = JSON.parse(lockRaw);
  const contexts = [];
  for (const affected of threat.affected || []) {
    const dependency = dependencyPathsFor(lockJson, affected.package, affected.version);
    const rootNames = new Set(dependency.roots.map((root) => root.name));
    const importers = surface.packageImports
      .filter((entry) => rootNames.has(entry.name))
      .flatMap((entry) => entry.files.map((file) => Object.freeze({ package: entry.name, kind: entry.kind, file })));
    const ancestors = moduleAncestors(importers.map((entry) => entry.file), surface.graph.modules);
    const routes = surface.routes.filter((route) => ancestors.has(route.file));
    contexts.push(Object.freeze({
      affected: Object.freeze({ package: affected.package, version: affected.version }),
      dependency,
      importedBy: Object.freeze(importers),
      routes: Object.freeze(routes),
      exposure: exposureClass({
        roots: dependency.roots,
        importers,
        routes,
        directNetworkExposure: surface.deployment.directNetworkExposure,
      }),
      confidence: 'static_evidence',
    }));
  }
  return Object.freeze({
    measuredAt: new Date().toISOString(),
    threatId: threat.id,
    externalId: threat.externalId,
    repo: threat.repo,
    deployment: surface.deployment,
    contexts: Object.freeze(contexts),
    caveats: Object.freeze([
      'Static imports and package-lock resolution are evidence, not exploitability proof.',
      'Dynamic execution, native addons, reverse proxies, tunnels, and host-firewall policy require live verification.',
      'public_or_unverified means no static requireAuth evidence was found; it does not assert anonymous reachability.',
    ]),
  });
};

/** Drop cached source maps after a watched repository changes. */
export const clearAttackSurfaceCache = () => architectureCache.clear();
