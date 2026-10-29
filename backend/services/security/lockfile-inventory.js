// Lockfile inventory — every installed package@version a package-lock.json
// pins, each marked shipped or dev-only.
//
// EVERY VERSION (2026-10-19 audit): one name can sit in a tree several times
// at different versions (tar 6.2.1 for the build, 7.5.9 shipped). Keeping one
// version per name dropped 151 of 1118 pairs, and because lockfile keys sort,
// a nested dev copy could hide the shipped top-level one. The pair is the
// unit, never the name.
//
// SHIPPED vs DEV: npm marks a lock entry `dev: true` only when it lives
// strictly in the devDependencies tree, so everything else ships with
// `npm install --omit=dev` — `devOptional` included, because npm keeps an
// optional dependency of a production package even when dev is omitted (an
// under-rated shipped hole costs more than an over-rated dev one). Electron
// is a devDependency by electron-builder's convention, yet it IS the
// installed app's runtime, so it ships whatever its flag says.

const SHIPPED_DEV_RUNTIME = Object.freeze(['electron']);

// pure — npm package name from a package-lock `packages` key: everything
// after the LAST node_modules/ (nested deps name themselves; scoped names
// keep both segments).
export const packageNameFromKey = (key) => {
  const at = key.lastIndexOf('node_modules/');
  if (at === -1) return null;
  return key.slice(at + 'node_modules/'.length) || null;
};

// pure — whether one lock entry reaches an installed app.
export const entryShips = (name, meta) =>
  SHIPPED_DEV_RUNTIME.includes(name) || meta?.dev !== true;

/**
 * pure — the (name, version, shipped) set a lockfile pins, one row per
 * distinct name@version. A pair that appears in several tree positions ships
 * when ANY position ships. Entries without a version (workspace links) carry
 * nothing to query.
 * @param {Object} lockJson parsed package-lock.json (lockfileVersion 2/3)
 * @returns {Array<{name: string, version: string, shipped: boolean}>}
 */
export const lockfilePackages = (lockJson) => {
  const packages = lockJson?.packages;
  if (!packages || typeof packages !== 'object') return [];
  const pairs = new Map();
  for (const [key, meta] of Object.entries(packages)) {
    const name = packageNameFromKey(key);
    if (!name || typeof meta?.version !== 'string' || !meta.version) continue;
    const id = `${name}@${meta.version}`;
    const shipped = entryShips(name, meta) || pairs.get(id)?.shipped === true;
    pairs.set(id, { name, version: meta.version, shipped });
  }
  return [...pairs.values()];
};
