/**
 * THE READ WALL, FUZZED (security seat pen + fuzz plan, item 1). A being's
 * filesystem read is judged twice by the tool sandbox (tool-sandbox.js): once
 * on the path it named, once on that path's symlink-resolved real form —
 * checkPathAccess both times, which consults matchesDeniedPattern, the denied
 * extensions and isSecretFile. This suite plants real secrets in a real temp
 * lane and throws ~5k spellings at that same two-step judgement:
 *
 *   1. Any spelling that resolves, case folded, to a secret is refused by the
 *      words alone — case flips, `./`, `//`, `name/..` hops (a case-insensitive
 *      volume opens `.ENV` as `.env`, so case never buys a read).
 *   2. Any spelling the wall lets through does not open a planted secret on
 *      this disk — the property for the spellings that alias only on another
 *      OS (a trailing dot or space, a backslash, a trailing slash on a file)
 *      and for NUL, which Node's fs refuses outright.
 *   3. A symlink to a secret (file or directory) is refused at the real form.
 *   4. Ordinary neighbours stay readable, and root containment keeps
 *      /x/data apart from /x/database.
 *
 * Seeded, so a red run replays exactly. Real functions, real files.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkPathAccess, realpathOfNearestExisting } from '../../backend/services/sandbox-path-policy.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { prng, pick, flipCase, respellPath } from '../helpers/seeded-fuzz.js';

const SEED = 0x5ea7;
const PER_TARGET = 320;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// lane-relative secrets, each where the platform or the operator's tools keep them
const SECRETS = Object.freeze([
  '.env', '.env.local', 'keys/keypair.json', 'owner.json', 'data/dna/genesis.json', 'data/dna-cache/c.json',
  'data/memory-store/m.json', 'vault/dna.enc', '.ssh/id_ed25519', 'certs/server.pem', 'certs/tls.key',
  '.git/config', 'node_modules/pkg/index.js', 'credentials.json', 'secrets.yaml', '.npmrc', 'sub/.netrc',
  'auth.json', 'id_rsa', 'service-account-prod.json', 'wallet.keystore', 'infra/terraform.tfstate',
]);
// directories whose every child is denied
const SECRET_DIRS = Object.freeze(['keys', 'vault', '.ssh', '.git', 'data/dna']);
// ordinary neighbours a being must still read
const ORDINARY = Object.freeze([
  'database/rows.json', 'envelope.txt', 'keystone/notes.md', 'src/config.ts', 'notes/owner-notes.md',
  'dna/genesis.md', 'docs/credential-guide.md', 'art/images/portrait.png', 'git-notes.md',
]);

// mirrors tool-sandbox.js: the named path, then its symlink-resolved form
const sandboxAllows = async (p, roots) => {
  if (!checkPathAccess(p, roots).allowed) return false;
  const real = await realpathOfNearestExisting(p);
  return checkPathAccess(real, roots).allowed;
};

// impure — does this spelling open a planted secret on this disk?
const opensSecret = async (p, secretReals) => {
  const real = await fs.realpath(p).catch(() => null);
  if (!real) return false;
  return secretReals.some((secret) => real === secret || real.startsWith(`${secret}/`));
};

// a spelling that aliases the target only on another OS, or never
const foreignAlias = (r, target) => pick(r, [
  `${target}.`, `${target} `, `${target}/`, `${target}\0`, `${target}\0.txt`,
  target.replace(/\/([^/]+)$/, '\\$1'), target.replace(/\//g, '\\'), `${target}::$DATA`,
]);

describe('the read wall holds under every spelling (seeded fuzz, real files)', () => {
  // The deny list is judged UNCONFINED (no roots — a read before a lane binds):
  // with roots in force, containment would refuse a case-flipped spelling on
  // its own and hide a hole in the list itself.
  const UNCONFINED = [];
  let lane, secretReals;

  beforeAll(async () => {
    lane = path.join(await createTempDir('read-wall-fuzz'), 'lane');
    for (const rel of [...SECRETS, ...ORDINARY]) {
      await fs.mkdir(path.dirname(path.join(lane, rel)), { recursive: true });
      await fs.writeFile(path.join(lane, rel), `planted ${rel}\n`);
    }
    await fs.symlink(path.join(lane, '.env'), path.join(lane, 'notes-link.md'));
    await fs.symlink(path.join(lane, 'keys'), path.join(lane, 'innocent'));
    await fs.symlink(path.join(lane, 'certs', 'server.pem'), path.join(lane, 'cert-copy.txt'));
    secretReals = await Promise.all([...SECRETS.map((rel) => path.join(lane, rel)), ...SECRET_DIRS.map((d) => path.join(lane, d))]
      .map((p) => fs.realpath(p)));
  });

  test.each(SECRETS)('%s — every same-place spelling, case folded, is refused by the words alone', (rel) => {
    const r = prng(SEED ^ rel.length * 7919);
    const target = path.join(lane, rel);
    expect(checkPathAccess(target, UNCONFINED).allowed, target).toBe(false);
    for (let i = 0; i < PER_TARGET; i += 1) {
      const spelling = flipCase(r, respellPath(r, target), r() < 0.5 ? 0.4 : 0);
      // a trailing slash on a FILE names nothing the disk opens; property 2 covers it
      const sameFile = path.resolve(spelling).toLowerCase() === target.toLowerCase() && !spelling.endsWith('/');
      if (sameFile) expect(checkPathAccess(spelling, UNCONFINED).allowed, JSON.stringify(spelling)).toBe(false);
    }
  });

  test.each(SECRET_DIRS)('%s/ — the directory itself and anything below it, respelled, is refused', (dir) => {
    const r = prng(SEED ^ dir.length * 104729);
    for (let i = 0; i < PER_TARGET / 2; i += 1) {
      const target = path.join(lane, dir, ...(r() < 0.5 ? [] : [`child${i}`, 'leaf.txt']));
      const spelling = flipCase(r, respellPath(r, target), r() < 0.5 ? 0.4 : 0);
      expect(checkPathAccess(spelling, UNCONFINED).allowed, JSON.stringify(spelling)).toBe(false);
    }
  });

  test('a spelling the wall lets through never opens a planted secret on this disk', async () => {
    const r = prng(SEED ^ 0xa11a5);
    const leaks = [];
    let passed = 0;
    for (const rel of SECRETS) {
      for (let i = 0; i < 60; i += 1) {
        const spelling = foreignAlias(r, r() < 0.5 ? path.join(lane, rel) : respellPath(r, path.join(lane, rel)));
        if (!(await sandboxAllows(spelling, UNCONFINED))) continue;
        passed += 1;
        if (await opensSecret(spelling, secretReals)) leaks.push(JSON.stringify(spelling));
      }
    }
    expect(leaks).toEqual([]);
    // the property was exercised, not vacuous: the wall lets some foreign aliases through
    expect(passed).toBeGreaterThan(0);
  });

  test('a symlink to a secret file or directory is refused at its real form', async () => {
    // A child named so the words cannot flag it: keypair.json is a secret by its
    // name anywhere now (recheck 2026-10-20), so only the real form can refuse this.
    for (const link of ['notes-link.md', 'innocent/notes.md', 'cert-copy.txt', './innocent//notes.md']) {
      const p = path.join(lane, link);
      expect(checkPathAccess(p, UNCONFINED).allowed, `${link} reads as ordinary by its words`).toBe(true);
      expect(await sandboxAllows(p, UNCONFINED), link).toBe(false);
    }
  });

  test('ordinary neighbours stay readable, respelled, and /x/data never contains /x/database', async () => {
    const r = prng(SEED ^ 0x0d1);
    for (const rel of ORDINARY) {
      const target = path.join(lane, rel);
      expect(await sandboxAllows(target, [lane]), rel).toBe(true);
      for (let i = 0; i < 20; i += 1) {
        const spelling = respellPath(r, target);
        expect(checkPathAccess(spelling, [lane]).allowed, JSON.stringify(spelling)).toBe(true);
      }
    }
    const data = path.join(lane, 'data');
    expect(checkPathAccess(path.join(lane, 'database', 'rows.json'), [data]).allowed).toBe(false);
    expect(checkPathAccess(path.join(lane, 'data', 'notes.md'), [data]).allowed).toBe(true);
  });

  test('inside the install, its own config/ is walled under every spelling', () => {
    const r = prng(SEED ^ 0xc0f);
    const target = path.join(REPO, 'config', 'tool-policy.json');
    for (let i = 0; i < PER_TARGET; i += 1) {
      const spelling = flipCase(r, respellPath(r, target), r() < 0.5 ? 0.4 : 0);
      if (path.resolve(spelling) !== target) continue; // a case flip of the repo path names another place on this disk
      expect(checkPathAccess(spelling, []).allowed, JSON.stringify(spelling)).toBe(false);
    }
  });
});
