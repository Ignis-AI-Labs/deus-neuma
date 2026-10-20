/**
 * Route inventory — every route an Express app or router really mounts, read
 * from its live handler stacks rather than from source text. The pen matrix
 * (test/integration/pen-cross-house-*.test.js) enumerates its targets here,
 * so a route added tomorrow is driven tomorrow; the self-check reads which
 * guards stand on the machine routes. The static source scan
 * (attack-surface.js) stays the CSO's map of a watched repo — it cannot see
 * a guard added at mount time, and it stops at 300 entries.
 *
 * Express 4 keeps no mount path string on a `use` layer, only its regexp;
 * mountPathOf turns the plain-segment shapes our mounts use back into text and
 * names anything else as a pattern so it is never silently dropped.
 */

const MUTATING = Object.freeze(new Set(['post', 'put', 'patch', 'delete']));

// pure — the literal mount path of one `use` layer, '' for the root.
const mountPathOf = (layer) => {
  if (layer.regexp?.fast_slash) return '';
  const source = String(layer.regexp?.source ?? '');
  const plain = /^\^((?:\\\/[^\\/()?*+[\]{}|^$]+)+)\\\/\?\(\?=\\\/\|\$\)$/.exec(source);
  if (plain) return plain[1].replace(/\\\//g, '/');
  return `<pattern ${source}>`;
};

// pure — a handler's name, so guards (requireAuth, requireInstallOwner) are legible.
const handlerName = (fn) => (typeof fn === 'function' && fn.name) || '<anonymous>';

/**
 * Every route under an app or router, depth first, with the full mounted
 * path and every handler that runs for it — the `use` middleware on its way
 * down and its own route stack — as the functions themselves (`handlers`, so
 * a guard is found by identity even when it is an anonymous closure) and by
 * name (`chain`). Pure over the stack.
 * @param {import('express').Express | import('express').Router} appOrRouter
 * @returns {Array<{ method: string, path: string, handlers: Function[], chain: string[] }>}
 */
export const listRoutes = (appOrRouter) => {
  const out = [];
  const walk = (stack, prefix, inherited) => {
    const before = [...inherited];
    for (const layer of stack || []) {
      if (layer.route) {
        const full = `${prefix}${layer.route.path}`;
        // path-scoped middleware runs only for the routes beneath its mount
        const upstream = before.filter((entry) => full === entry.at || full.startsWith(`${entry.at}/`) || entry.at === '');
        const own = layer.route.stack.map((entry) => entry.handle);
        const handlers = Object.freeze([...upstream.map((entry) => entry.handle), ...own]);
        for (const method of Object.keys(layer.route.methods).filter((m) => layer.route.methods[m])) {
          out.push(Object.freeze({ method, path: full, handlers, chain: Object.freeze(handlers.map(handlerName)) }));
        }
      } else if (Array.isArray(layer.handle?.stack)) {
        walk(layer.handle.stack, `${prefix}${mountPathOf(layer)}`, before);
      } else {
        const at = mountPathOf(layer);
        before.push({ handle: layer.handle, at: at === '' ? prefix : `${prefix}${at}` });
      }
    }
  };
  const root = appOrRouter?._router?.stack ?? appOrRouter?.stack ?? [];
  walk(root, '', []);
  return out;
};

/**
 * The routes that can change state. Pure.
 * @param {ReturnType<typeof listRoutes>} routes
 */
export const mutatingRoutes = (routes) => routes.filter((route) => MUTATING.has(route.method));

/** `METHOD /path` — the one key a route is named by in allowlists and findings. Pure. */
export const routeKey = (route) => `${route.method.toUpperCase()} ${route.path}`;
