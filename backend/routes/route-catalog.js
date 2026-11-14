/**
 * THE ROUTE CATALOG — every HTTP endpoint the backend serves, read off the
 * real routers rather than written by hand. The hand-written API.md says of
 * itself that it is a legacy reference; this one cannot fall behind, because
 * it is made from the same `mountApiRoutes` the server calls, and a test fails
 * when the committed catalog and the code disagree.
 *
 * How: `mountApiRoutes` is run against a RECORDING app that notes every mount
 * path as it is mounted (Express 4 keeps a mounted router's path only as a
 * regular expression), and each router is then walked for its routes, its
 * nested routers, and the guards that stand in front of each route.
 *
 * impure only through the routers it is handed; the walk itself is pure.
 */

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all'];

// Express 4 compiles `router.use('/x/:id', …)` to a regular expression; the
// readable path comes back from its source and the parameter names it kept.
const pathFromLayer = (layer) => {
  if (layer.path !== undefined && typeof layer.path === 'string') return layer.path;
  const source = layer.regexp?.source ?? '';
  if (layer.regexp?.fast_slash || source === '^\\/?(?=\\/|$)') return '';
  let i = 0;
  const keys = layer.keys || [];
  return source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\(\?:(\\\/)?\(\[\^\\?\/]\+\?\)\)/g, (_m, slash) => `${slash ? '/' : ''}:${keys[i++]?.name ?? 'param'}`)
    .replace(/\\\//g, '/')
    .replace(/\\\./g, '.')
    .replace(/\\-/g, '-');
};

const joinPath = (...parts) => {
  const joined = parts.filter((p) => p && p !== '/').join('/').replace(/\/{2,}/g, '/');
  return joined.startsWith('/') ? joined : `/${joined}`;
};

const routePaths = (route) => (Array.isArray(route.path) ? route.path : [route.path]).map(String);

/**
 * Name a guard function. A function the caller names (by reference) wins;
 * otherwise its own name; an anonymous one is said to be anonymous. Pure.
 */
const guardName = (fn, known) => known.get(fn) || fn.name || '(inline check)';

/**
 * Walk one router: every route under it, with the guards in front of it.
 * Router-level middleware (`router.use(fn)`) stands in front of every route
 * declared AFTER it in that router — Express runs the stack in order. Pure.
 * @param {object} router - an Express router (has `.stack`)
 * @param {string} base - the path it is mounted at
 * @param {string[]} guards - guards already in front of it
 * @param {Map<Function, string>} known - functions to name by reference
 * @returns {Array<{ method: string, path: string, guards: string[] }>}
 */
export const walkRouter = (router, base, guards, known) => {
  const out = [];
  const inFront = [...guards];
  for (const layer of router?.stack || []) {
    if (layer.route) {
      const handlers = layer.route.stack.map((l) => l.handle);
      // Every handler but the last is a guard; the last answers.
      const own = handlers.slice(0, -1).map((fn) => guardName(fn, known));
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
      for (const p of routePaths(layer.route)) {
        for (const method of methods) out.push({ method: method.toUpperCase(), path: joinPath(base, p), guards: [...inFront, ...own] });
      }
      continue;
    }
    if (layer.handle?.stack) {
      out.push(...walkRouter(layer.handle, joinPath(base, pathFromLayer(layer)), inFront, known));
      continue;
    }
    // Middleware that applies to everything below it in this router.
    if (pathFromLayer(layer) === '') inFront.push(guardName(layer.handle, known));
  }
  return out;
};

/**
 * The guards a router runs for EVERY request that enters it: its path-less
 * middleware. A request that no route in the router answers falls through to
 * the routers mounted after it — having passed these — so they stand in front
 * of every later route under the same prefix too. Pure.
 */
const blanketGuards = (router, known) => (router?.stack || [])
  .filter((layer) => !layer.route && !layer.handle?.stack && pathFromLayer(layer) === '')
  .map((layer) => guardName(layer.handle, known));

/**
 * Run a mount function against a recording app and return every endpoint. Pure
 * apart from what the mount function itself does.
 * @param {(app: object) => void} mount - e.g. mountApiRoutes
 * @param {Map<Function, string>} [known] - functions to name by reference (guards built by a factory have no name)
 * @returns {Array<{ method: string, path: string, guards: string[] }>} sorted by path, then method
 */
export const catalogRoutes = (mount, known = new Map()) => {
  const mounts = [];
  const record = (method) => (first, ...rest) => {
    const hasPath = typeof first === 'string' || first instanceof RegExp || Array.isArray(first);
    mounts.push({ method, path: hasPath ? first : '', handlers: hasPath ? rest : [first, ...rest] });
    return app; // eslint-disable-line no-use-before-define
  };
  const app = Object.fromEntries([...METHODS, 'use'].map((m) => [m, record(m)]));
  app.set = () => app;
  app.locals = {};
  mount(app);

  const out = [];
  const guardsBySite = []; // app-level middleware: { prefix, name }
  for (const { method, path: at, handlers } of mounts) {
    const paths = (Array.isArray(at) ? at : [at]).map(String);
    if (method !== 'use') {
      const guards = handlers.slice(0, -1).map((fn) => guardName(fn, known));
      for (const p of paths) out.push({ method: method.toUpperCase(), path: joinPath(p), guards, prefixGuards: guardsBySite.slice() });
      continue;
    }
    for (const handler of handlers) {
      if (handler?.stack) {
        for (const p of paths) {
          out.push(...walkRouter(handler, p, [], known).map((r) => ({ ...r, prefixGuards: guardsBySite.slice() })));
          for (const name of blanketGuards(handler, known)) guardsBySite.push({ prefix: joinPath(p), name });
        }
      } else if (typeof handler === 'function') {
        for (const p of paths) guardsBySite.push({ prefix: joinPath(p), name: guardName(handler, known) });
      }
    }
  }
  // App-level middleware mounted at a prefix BEFORE a route stands in front of it.
  const withPrefix = out.map(({ prefixGuards, ...r }) => ({
    ...r,
    // Each guard once, in the order a request meets it.
    guards: [...new Set([...prefixGuards.filter((g) => r.path === g.prefix || r.path.startsWith(`${g.prefix === '/' ? '' : g.prefix}/`)).map((g) => g.name), ...r.guards])],
  }));
  const seen = new Set();
  return withPrefix
    .filter((r) => { const k = `${r.method} ${r.path}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
};

/**
 * The catalog as a markdown page. Pure.
 * @param {Array<{ method: string, path: string, guards: string[] }>} routes
 * @returns {string}
 */
export const catalogMarkdown = (routes) => {
  const groups = new Map();
  for (const r of routes) {
    const key = r.path.split('/').slice(0, 4).join('/') || '/';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const lines = [
    '# HTTP route catalog',
    '',
    '> Generated from the real routers by `node scripts/api-catalog.mjs`. Do not edit by hand:',
    '> `test/integration/api-route-catalog.test.js` fails when this page and the code disagree.',
    '> Request and response shapes live with each router in `backend/routes/`; the',
    '> WebSocket portal and the CLI protocols (`neuma agent`, `neuma acp`) are described in `cli/README.md`.',
    '',
    `${routes.length} endpoints. **Guards** are the checks a request passes before the handler, in order`
      + ' (`requireAuth`: a signed-in operator; `requireInstallOwner`: the owner of this install).',
    '',
  ];
  for (const [group, list] of groups) {
    lines.push(`## ${group}`, '', '| Method | Path | Guards |', '| --- | --- | --- |');
    for (const r of list) lines.push(`| ${r.method} | \`${r.path}\` | ${r.guards.length ? r.guards.map((g) => `\`${g}\``).join(', ') : '—'} |`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
};
