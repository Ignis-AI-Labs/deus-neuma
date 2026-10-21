// OSV remedy — the fix an advisory finding owes, read from the advisory's own
// record: the version that closes it, per installed package@version, and the
// dependency it rides in through.
//
// OSV states the fix as range EVENTS on each affected package: `introduced`
// opens a vulnerable range, `fixed` closes it (the first safe version),
// `last_affected` / `limit` close it without naming a fix. An installed
// version is in a range when introduced <= version < fixed; the `fixed` of
// that range is the floor the upgrade must reach. A range with no `fixed`
// means no fix is published — the remedy says so rather than inventing one.
//
// Pure throughout.

const RANGE_TYPES = Object.freeze(['SEMVER', 'ECOSYSTEM']);
const ROOTS_NAMED = 3;

// pure — "1.2.3-beta.1" → { core: [1,2,3], pre: ['beta', 1] }; build metadata
// is ignored (it never orders versions).
const parseVersion = (v) => {
  const [main, ...rest] = String(v).replace(/^v/, '').split('+')[0].split('-');
  const pre = rest.join('-');
  return {
    core: main.split('.').map((n) => Number.parseInt(n, 10) || 0),
    pre: pre ? pre.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  };
};

// pure — one prerelease identifier against another (semver §11.4).
const comparePre = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    if (a[i] === b[i]) continue;
    if (typeof a[i] === 'number' && typeof b[i] === 'number') return a[i] - b[i];
    if (typeof a[i] === 'number') return -1;
    if (typeof b[i] === 'number') return 1;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
};

/**
 * pure — npm semver order: negative when a < b, 0 equal, positive a > b. A
 * prerelease sorts below its release. OSV's "0" introduced reads as the start.
 */
export const compareVersions = (a, b) => {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    const d = (x.core[i] || 0) - (y.core[i] || 0);
    if (d) return d;
  }
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  return comparePre(x.pre, y.pre);
};

/**
 * pure — the version that fixes `version` of npm package `name` in one OSV
 * record: a version string, or null when no published fix covers it.
 * @param {Object} vuln an OSV vulnerability record
 * @param {string} name
 * @param {string} version the installed version
 * @returns {string|null}
 */
export const fixedVersionFor = (vuln, name, version) => {
  for (const affected of Array.isArray(vuln?.affected) ? vuln.affected : []) {
    if (affected?.package?.name !== name) continue;
    if (affected.package.ecosystem && affected.package.ecosystem !== 'npm') continue;
    for (const range of Array.isArray(affected.ranges) ? affected.ranges : []) {
      if (!RANGE_TYPES.includes(range?.type)) continue;
      let introduced = null;
      for (const event of Array.isArray(range.events) ? range.events : []) {
        if (event.introduced !== undefined) introduced = event.introduced;
        else if (event.fixed !== undefined && introduced !== null) {
          if (compareVersions(introduced, version) <= 0 && compareVersions(version, event.fixed) < 0) return event.fixed;
          introduced = null;
        } else introduced = null;
      }
    }
  }
  return null;
};

// pure — […] / " (dev-only, direct dependency)".
const contextOf = (pair, roots) => {
  const via = roots.filter((r) => r !== pair.package);
  const route = roots.includes(pair.package) && !via.length
    ? 'direct dependency — bump it in package.json'
    : via.length ? `via ${via.slice(0, ROOTS_NAMED).join(', ')}${via.length > ROOTS_NAMED ? ` +${via.length - ROOTS_NAMED}` : ''}` : null;
  return ` (${[pair.shipped ? 'shipped' : 'dev-only', route].filter(Boolean).join(', ')})`;
};

/**
 * pure — the remedy for one advisory group: one clause per installed pair.
 * @param {{id: string, affected: Array<{package: string, version: string, shipped: boolean}>}} group
 * @param {Object|undefined} vuln the OSV record (undefined when the detail fetch failed)
 * @param {(pair: Object) => string[]} rootsOf the direct dependencies that pull a pair in
 * @returns {string}
 */
export const advisoryRemedy = (group, vuln, rootsOf) => {
  if (!vuln) {
    const pairs = group.affected.map((a) => `${a.package}@${a.version}`).join(', ');
    return `the advisory record could not be read this scan — find the fixed version of ${pairs} at https://osv.dev/vulnerability/${group.id}`;
  }
  // A malicious release has no fix to upgrade to: it must leave the tree.
  if (group.id.startsWith('MAL-')) {
    return group.affected.map((pair) => `remove ${pair.package}@${pair.version} from the tree now${contextOf(pair, rootsOf(pair))} — a malicious release could read this machine, so rotate every credential it could reach`).join('; ');
  }
  return group.affected.map((pair) => {
    const fixed = fixedVersionFor(vuln, pair.package, pair.version);
    return fixed
      ? `upgrade ${pair.package} ${pair.version} → ≥${fixed}${contextOf(pair, rootsOf(pair))}`
      : `no published fix covers ${pair.package} ${pair.version}${contextOf(pair, rootsOf(pair))} — replace or remove it, or show it unreachable (security_attack_surface) and judge it not_affected`;
  }).join('; ');
};
