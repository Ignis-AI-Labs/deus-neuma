// License scan — what the house SHIPS, read against the licences it ships
// under. Every non-dev package in a watched repo's package-lock.json is
// classified by its SPDX expression; the ones that carry obligations or
// doubt become matters for the Praetor.
//
// The classes, least to most binding for a proprietary, distributed,
// network-served app:
//   permissive       MIT, BSD, Apache, ISC, OFL fonts … (attribution only —
//                    the posture probe checks the attributions ship)
//   weak-copyleft    LGPL, MPL, EPL, CDDL — file/library-level obligations
//   strong-copyleft  GPL — the whole-work question
//   unknown          missing, UNLICENSED, "SEE LICENSE IN", unrecognised
//   network-copyleft AGPL, SSPL — serving it is distributing it
//   non-commercial   NC / source-available terms — may bar selling at all
// An `OR` is the licensee's choice (the least binding branch counts); an
// `AND` binds all (the most binding part counts).
//
// Read-only by law: the scan reads the lockfile and, where the lockfile
// carries no licence, the installed package.json — never writes in a repo.

import fs from 'fs/promises';
import { join } from 'path';

const PERMISSIVE = [
  /^MIT(-0)?$/, /^ISC$/, /^0BSD$/, /^BSD-\d-Clause(-.+)?$/, /^Apache-2\.0$/, /^Apache-1\.1$/,
  /^BlueOak-1\.0\.0$/, /^Unlicense$/, /^CC0-1\.0$/, /^CC-BY-\d\.\d$/, /^Zlib$/, /^Python-2\.0(\.1)?$/,
  /^PSF-2\.0$/, /^WTFPL$/, /^OFL-1\.[01]$/, /^Artistic-2\.0$/, /^BSL-1\.0$/, /^X11$/, /^Unicode-.+$/,
  /^W3C(-.+)?$/, /^AFL-[\d.]+$/,
];
const WEAK = [/^LGPL-/, /^MPL-/, /^EPL-/, /^CDDL-/, /^EUPL-/, /^MS-RL$/, /^CECILL-C$/];
const STRONG = [/^GPL-/, /^OSL-/, /^CECILL-2/, /^CC-BY-SA-/];
const NETWORK = [/^AGPL-/, /^SSPL-/, /^RPL-/];
const NON_COMMERCIAL = [/NC/, /^BUSL-/, /^Elastic-/, /^PolyForm-(Noncommercial|Strict|Internal)/, /Commons-Clause/i];

const LINKING_EXCEPTIONS = /^(Classpath-exception|GCC-exception|LLVM-exception|Autoconf-exception|Bison-exception|Font-exception|linking-exception)/i;

export const LICENSE_CLASSES = Object.freeze(['permissive', 'weak-copyleft', 'strong-copyleft', 'unknown', 'network-copyleft', 'non-commercial']);
const RANK = Object.fromEntries(LICENSE_CLASSES.map((c, i) => [c, i]));

// pure — one SPDX id (a WITH exception leaves the base licence's class).
const classOfId = (id) => {
  const base = id.replace(/\+$/, '');
  if (NON_COMMERCIAL.some((re) => re.test(base))) return 'non-commercial';
  if (NETWORK.some((re) => re.test(base))) return 'network-copyleft';
  if (STRONG.some((re) => re.test(base))) return 'strong-copyleft';
  if (WEAK.some((re) => re.test(base))) return 'weak-copyleft';
  if (PERMISSIVE.some((re) => re.test(base))) return 'permissive';
  return 'unknown';
};

// pure — tokens of an SPDX expression.
const tokensOf = (expr) => expr.replace(/[()]/g, (p) => ` ${p} `).split(/\s+/).filter(Boolean);

/**
 * pure — the binding class of an SPDX expression (or a raw lockfile value).
 * @param {unknown} license
 * @returns {string} one of LICENSE_CLASSES
 */
export const classifyLicense = (license) => {
  if (typeof license !== 'string' || !license.trim()) return 'unknown';
  const text = license.trim();
  if (/^UNLICENSED$/i.test(text) || /^SEE LICEN[CS]E IN/i.test(text)) return 'unknown';
  const tokens = tokensOf(text);
  let i = 0;
  // recursive descent: or := and (OR and)* ; and := atom (AND atom)* ;
  // atom := '(' or ')' | ID [WITH ID]
  const atom = () => {
    const t = tokens[i++];
    if (t === '(') { const c = or(); i += 1; return c; }
    if (!t) return 'unknown';
    const cls = classOfId(t);
    if (tokens[i] !== 'WITH') return cls;
    const exception = tokens[i + 1] || '';
    i += 2;
    // a linking exception lifts a GPL to a library-level obligation
    return cls === 'strong-copyleft' && LINKING_EXCEPTIONS.test(exception) ? 'weak-copyleft' : cls;
  };
  const and = () => {
    let c = atom();
    while (tokens[i] === 'AND') { i += 1; const n = atom(); if (RANK[n] > RANK[c]) c = n; }
    return c;
  };
  const or = () => {
    let c = and();
    while (tokens[i] === 'OR') { i += 1; const n = and(); if (RANK[n] < RANK[c]) c = n; }
    return c;
  };
  const cls = or();
  return i === tokens.length ? cls : 'unknown';
};

const SEVERITY = Object.freeze({
  'network-copyleft': 'critical',
  'non-commercial': 'high',
  'strong-copyleft': 'high',
  unknown: 'medium',
  'weak-copyleft': 'low',
});

const WHY = Object.freeze({
  'network-copyleft': 'Network copyleft: serving the app to users may oblige releasing the whole work\'s source. Incompatible with a proprietary licence unless isolated.',
  'non-commercial': 'Non-commercial or source-available terms: may bar selling or commercial use outright.',
  'strong-copyleft': 'Strong copyleft: distributing it inside the app may oblige releasing the combined work\'s source.',
  unknown: 'No licence the scan can read: until one is found, the house has no stated right to ship it.',
  'weak-copyleft': 'Weak copyleft: shippable in a proprietary app, with obligations — notice, the library\'s source on request, and the user\'s right to replace/relink it.',
});

// pure — a lockfile key to its package name.
const nameOf = (key) => key.replace(/^.*node_modules\//, '');

// impure — the installed package.json's licence when the lockfile has none.
const installedLicense = async (repoPath, key) => {
  try {
    const pkg = JSON.parse(await fs.readFile(join(repoPath, key, 'package.json'), 'utf8'));
    if (typeof pkg.license === 'string') return pkg.license;
    if (pkg.license?.type) return pkg.license.type;
    if (Array.isArray(pkg.licenses) && pkg.licenses.length) {
      return pkg.licenses.map((l) => (typeof l === 'string' ? l : l?.type)).filter(Boolean).join(' OR ') || null;
    }
  } catch { /* not installed here — the lockfile's word is all there is */ }
  return null;
};

// impure — the first line of the package's own licence file, if it has one:
// a package that declares nothing may still carry its terms in a file.
const licenceFileHint = async (repoPath, key) => {
  try {
    const dir = join(repoPath, key);
    const file = (await fs.readdir(dir)).find((f) => /^(LICEN[CS]E|COPYING)/i.test(f));
    if (!file) return null;
    const line = (await fs.readFile(join(dir, file), 'utf8')).split('\n').map((l) => l.trim()).find(Boolean);
    return line ? line.slice(0, 160) : null;
  } catch {
    return null;
  }
};

/**
 * pure — shipped packages → matters. Weak-copyleft groups by expression (one
 * reading settles a family: sharp's libvips builds are one question); every
 * other binding class is its own matter per package (each is its own call).
 * @param {{id: string}} repo
 * @param {Array<{name: string, version: string, license: string|null, cls: string, hint?: string|null}>} shipped
 */
export const licenseMatters = (repo, shipped) => {
  const binding = shipped.filter((p) => p.cls !== 'permissive');
  const weak = new Map();
  const matters = [];
  for (const p of binding) {
    if (p.cls === 'weak-copyleft') {
      const key = tokensOf(p.license).filter((t) => WEAK.some((re) => re.test(t))).sort().join(' + ') || p.license;
      weak.set(key, [...(weak.get(key) || []), p]);
      continue;
    }
    matters.push({
      area: 'license', source: 'license-scan', repo: repo.id,
      externalId: `license:${p.name}`,
      title: `${p.name}@${p.version} ships under ${p.license || 'no stated licence'} (${p.cls})`,
      severity: SEVERITY[p.cls],
      summary: p.hint ? `${WHY[p.cls]} Its own licence file opens: "${p.hint}"` : WHY[p.cls],
      regimes: ['copyright'],
      affected: [`${p.name}@${p.version}`],
    });
  }
  for (const [license, pkgs] of weak) {
    matters.push({
      area: 'license', source: 'license-scan', repo: repo.id,
      externalId: `license-family:${license}`,
      title: `${pkgs.length} shipped package(s) under ${license} (weak-copyleft)`,
      severity: SEVERITY['weak-copyleft'],
      summary: `${WHY['weak-copyleft']} Declared as: ${[...new Set(pkgs.map((p) => p.license))].join(' · ')}.`,
      regimes: ['copyright'],
      affected: pkgs.map((p) => `${p.name}@${p.version}`),
    });
  }
  return matters;
};

/**
 * impure — read a watched repo's lockfile and classify what ships.
 * @param {{id: string, path: string}} repo
 * @returns {Promise<{repo: string, shipped: number, shippedNames?: string[], byClass: Object, matters: Array<Object>, error: string|null}>}
 */
export const runLicenseScan = async (repo) => {
  let lock;
  try {
    lock = JSON.parse(await fs.readFile(join(repo.path, 'package-lock.json'), 'utf8'));
  } catch (err) {
    return { repo: repo.id, shipped: 0, byClass: {}, matters: [], error: err.code === 'ENOENT' ? null : `lockfile unreadable: ${err.message}` };
  }
  if (!lock.packages || typeof lock.packages !== 'object') {
    return { repo: repo.id, shipped: 0, byClass: {}, matters: [], error: `lockfile v${lock.lockfileVersion ?? '?'} carries no packages map — regenerate with npm ≥7` };
  }
  const shipped = [];
  for (const [key, meta] of Object.entries(lock.packages)) {
    if (!key || meta.dev || meta.link) continue;
    const license = meta.license ?? await installedLicense(repo.path, key);
    const cls = classifyLicense(license);
    const hint = cls === 'unknown' ? await licenceFileHint(repo.path, key) : null;
    shipped.push({ name: nameOf(key), version: meta.version || '?', license: license || null, cls, hint });
  }
  const byClass = {};
  for (const p of shipped) byClass[p.cls] = (byClass[p.cls] || 0) + 1;
  // the top-level installs — the packages an attributions file would name
  const shippedNames = Object.keys(lock.packages)
    .filter((key) => /^node_modules\/(@[^/]+\/)?[^/]+$/.test(key) && !lock.packages[key].dev)
    .map(nameOf);
  return { repo: repo.id, shipped: shipped.length, shippedNames, byClass, matters: licenseMatters(repo, shipped), error: null };
};
