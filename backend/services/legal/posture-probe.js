// Posture probe — the house's OWN papers, per watched repo: does it say what
// licence it ships under (and say it the same way twice), does it credit what
// it ships, and — for a repo that builds an app people install — does it carry
// the terms and the privacy notice a user is owed.
//
// Facts only: each finding names the file it looked for and what it found.
// Whether a gap matters is the Praetor's reading, never the probe's.
// Read-only by law.

import fs from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const run = promisify(execFile);

// Where a repo keeps its papers: the root, and the legal folders.
const PAPER_DIRS = ['', 'docs/legal', 'legal', 'docs'];

// impure — every file in the paper dirs whose name matches.
const findPapers = async (repoPath, pattern) => {
  const found = [];
  for (const dir of PAPER_DIRS) {
    const names = await fs.readdir(join(repoPath, dir)).catch(() => []);
    for (const name of names) if (pattern.test(name)) found.push(dir ? `${dir}/${name}` : name);
  }
  return found;
};

// pure — does the text name this package as a word (not inside another)?
const namesIn = (text, name) => new RegExp(`(^|[^\\w@/-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w/-])`).test(text);

const readText = (path) => fs.readFile(path, 'utf8').catch(() => null);

// impure — the ISO date of the last commit touching a path, or null.
const lastTouched = async (repoPath, rel) => {
  try {
    const { stdout } = await run('git', ['log', '-1', '--format=%cI', '--', rel], { cwd: repoPath, timeout: 15000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
};

// pure — what the licence file's own words claim.
const licenceKind = (text) => {
  if (!text) return null;
  if (/all rights reserved|proprietary|confidential/i.test(text)) return 'proprietary';
  if (/Business Source License/i.test(text)) return 'BUSL';
  if (/Apache License/i.test(text)) return 'Apache-2.0';
  if (/GNU AFFERO/i.test(text)) return 'AGPL';
  if (/GNU LESSER/i.test(text)) return 'LGPL';
  if (/GNU GENERAL PUBLIC/i.test(text)) return 'GPL';
  if (/Permission is hereby granted, free of charge/i.test(text)) return 'MIT';
  return 'other';
};

// pure — does package.json's licence field agree with the licence file?
const agrees = (field, kind) => {
  if (kind === 'proprietary') return /^(UNLICENSED|SEE LICEN[CS]E IN)/i.test(field);
  if (kind === 'other' || kind === null) return true; // nothing the probe can compare
  return field.toUpperCase().startsWith(kind.toUpperCase());
};

// impure — does this repo build an app a user installs?
const isInstalledApp = async (repoPath, pkg) => Boolean(
  pkg?.build
  || pkg?.dependencies?.electron || pkg?.devDependencies?.electron
  || await fs.access(join(repoPath, 'electron-builder.yml')).then(() => true, () => false),
);

const finding = (repo, externalId, severity, title, summary, regimes, affected = []) => ({
  area: 'posture', source: 'posture-probe', repo: repo.id, externalId, severity, title, summary, regimes, affected,
});

/**
 * impure — probe one repo's papers.
 * @param {{id: string, path: string}} repo
 * @param {{shippedNames?: string[]}} [opts] shipped package names (from the licence scan)
 * @returns {Promise<{repo: string, papers: Object, matters: Array<Object>, error: string|null}>}
 */
export const runPostureProbe = async (repo, { shippedNames = [] } = {}) => {
  const matters = [];
  try {
    const pkgText = await readText(join(repo.path, 'package.json'));
    const pkg = pkgText ? JSON.parse(pkgText) : null;
    const licences = await findPapers(repo.path, /^(LICEN[CS]E|COPYING)(\.(md|txt))?$/i);
    const attributions = await findPapers(repo.path, /^(THIRD[_-]?PARTY|NOTICE|ATTRIBUTION)/i);
    const terms = await findPapers(repo.path, /^(TERMS|EULA|TOS)/i);
    const privacy = await findPapers(repo.path, /^PRIVACY/i);
    const app = pkg ? await isInstalledApp(repo.path, pkg) : false;
    const papers = { licences, attributions, terms, privacy, app };

    const kind = licences[0] ? licenceKind(await readText(join(repo.path, licences[0]))) : null;
    if (!licences.length) {
      matters.push(finding(repo, 'posture:no-licence', 'high', `${repo.id} carries no licence file`,
        'Without a licence file the repo states no terms at all: by default no one else holds a right to use it, and nothing tells a reader what the house intends.', ['copyright']));
    }
    if (pkg && typeof pkg.license !== 'string') {
      matters.push(finding(repo, 'posture:package-licence-missing', 'medium', `${repo.id}/package.json declares no licence`,
        `package.json has no "license" field${kind === 'proprietary' ? ' while the licence file reserves all rights — npm and scanners read the package as unstated; a proprietary package says "UNLICENSED" or "SEE LICENSE IN <file>"' : ''}.`, ['copyright'], licences));
    } else if (pkg && !agrees(pkg.license, kind)) {
      matters.push(finding(repo, 'posture:licence-mismatch', 'high', `${repo.id} states two different licences`,
        `package.json says "${pkg.license}" but ${licences[0]} reads as ${kind}. A reader cannot tell which terms bind.`, ['copyright'], [licences[0], 'package.json']));
    }

    if (!attributions.length && shippedNames.length) {
      matters.push(finding(repo, 'posture:no-attributions', 'medium', `${repo.id} ships ${shippedNames.length} packages with no attributions file`,
        'Permissive licences (MIT, BSD, Apache) ask that their notice travel with every copy. No THIRD_PARTY / NOTICE file was found.', ['copyright']));
    } else if (attributions.length && shippedNames.length) {
      const text = (await Promise.all(attributions.map((f) => readText(join(repo.path, f))))).join('\n');
      const named = shippedNames.filter((n) => namesIn(text, n)).length;
      if (named / shippedNames.length < 0.1) {
        matters.push(finding(repo, 'posture:attributions-omit-packages', 'low', `${repo.id}'s attributions name ${named} of ${shippedNames.length} shipped packages`,
          `${attributions.join(', ')} credits what it credits (models, engines), but not the shipped npm packages. Whether each package's own licence file inside the packaged app discharges the notice duty is the reading owed.`, ['copyright'], attributions));
      }
      const [notedAt, lockAt] = await Promise.all([lastTouched(repo.path, attributions[0]), lastTouched(repo.path, 'package-lock.json')]);
      if (notedAt && lockAt && lockAt > notedAt) {
        matters.push(finding(repo, `posture:attributions-stale@${lockAt.slice(0, 10)}`, 'low', `${repo.id}'s dependencies changed after its attributions were last updated`,
          `${attributions[0]} last changed ${notedAt.slice(0, 10)}; package-lock.json last changed ${lockAt.slice(0, 10)}.`, ['copyright'], [attributions[0], 'package-lock.json']));
      }
    }

    if (app && !terms.length) {
      matters.push(finding(repo, 'posture:no-terms', 'high', `${repo.id} builds an installed app with no terms or EULA`,
        'An app handed to users without terms leaves warranty, liability and permitted use unstated.', ['contract', 'consumer']));
    }
    if (app && !privacy.length) {
      matters.push(finding(repo, 'posture:no-privacy-policy', 'high', `${repo.id} builds an installed app with no privacy notice`,
        'The app handles personal data (wallet addresses, a birth\'s time and place, conversations, voice). Most privacy laws owe the user a notice of what is collected, why, where it goes, and their rights — before collection.', ['privacy']));
    }
    return { repo: repo.id, papers, matters, error: null };
  } catch (err) {
    return { repo: repo.id, papers: null, matters, error: err.message };
  }
};
