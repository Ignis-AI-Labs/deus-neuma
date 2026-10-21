/**
 * The platform write walls, fuzzed (security seat G6). The sandbox judges a
 * being's write with laneStateWriteReason, which now consults the walls on
 * the install's settings, the realm and the operator's login persistence.
 * Every spelling that resolves to a wall — case flips, `./`, `//`, `..` hops,
 * a trailing slash, a child below it — is refused; the same spellings of a
 * near-miss sibling (`.bashrc.bak`, `settings2`) are not. Seeded, so a red
 * run replays exactly. Real function, real paths; HOME, the data root and the
 * realm root are pointed at a scratch prefix for the run and restored.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { laneStateWriteReason } from '../../backend/services/sandbox-path-policy.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

const SEED = 0x0b5c;
const PER_PATH = 40;
const ROOT = path.join('/tmp', 'neuma-wall-fuzz-scratch');
const HOME = path.join(ROOT, 'home', 'op');
const DATA = path.join(ROOT, 'install', 'data');
const REALM = path.join(ROOT, 'realm');

// mulberry32 — a tiny seeded PRNG, so the fuzz needs no dependency.
const prng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const WALLS = Object.freeze([
  path.join(HOME, '.bashrc'), path.join(HOME, '.bash_profile'), path.join(HOME, '.profile'), path.join(HOME, '.zshrc'),
  path.join(HOME, '.config', 'autostart'), path.join(HOME, '.config', 'systemd'), path.join(HOME, '.config', 'environment.d'),
  path.join(HOME, '.local', 'share', 'applications'), path.join(HOME, 'Library', 'LaunchAgents'),
  '/var/spool/cron', path.join(DATA, 'settings'), path.join(DATA, 'settings-store'), REALM,
  // recheck 2026-10-20: the desktop login, PATH under home, trusted tool config.
  ...['.config/plasma-workspace/env', '.config/plasma-workspace/shutdown', '.local/share/systemd/user', '.local/bin',
    '.config/fish', '.xprofile', '.xinitrc', '.xsession', '.Xresources', '.config/autostart-scripts', '.pam_environment',
    '.config/git/config', '.gitconfig', '.claude', '.claude/settings.json', '.claude/hooks', '.config/opencode', '.codex',
    '.ssh', '.gnupg', '.npmrc', '.netrc', '.docker/config.json', '.config/gh'].map((rel) => path.join(HOME, rel)),
  path.join(HOME, '.cargo', 'bin'),
]);

// A repository's own gate, by shape, in a checkout anywhere: lexical only, so
// no disk is consulted for these.
const REPO = path.join(ROOT, 'work', 'checkout');
const REPO_GATES = Object.freeze([
  path.join(REPO, '.git', 'hooks'), path.join(REPO, '.git', 'config'), path.join(REPO, 'scripts', 'git-hooks'),
  path.join(REPO, '.claude'), path.join(ROOT, 'elsewhere', 'deep', 'nested', '.claude', 'settings.json'),
]);

const NEAR_MISSES = Object.freeze([
  path.join(HOME, '.bashrc.bak'), path.join(HOME, '.profile-notes'), path.join(HOME, '.config', 'autostart2'),
  path.join(HOME, '.config', 'nvim', 'init.lua'), path.join(HOME, '.local', 'share', 'fonts'),
  path.join(DATA, 'settings2'), path.join(DATA, 'team-arenas', 'x.md'), `${REALM}-old`, path.join(HOME, 'work', '.zshrc'),
  path.join(HOME, '.claude-notes.md'), path.join(HOME, '.config', 'fish-notes'), path.join(HOME, '.local', 'bin2'),
  path.join(HOME, '.cargo', 'registry', 'x'), path.join(HOME, '.gitconfig.example'),
  path.join(REPO, '.gitignore'), path.join(REPO, '.github', 'x.yml'), path.join(REPO, 'scripts', 'build.mjs'),
  path.join(REPO, 'scripts', 'git-hooks-notes.md'), path.join(REPO, 'src', 'claude', 'x.js'), path.join(REPO, 'git', 'hooks'),
]);

// One random spelling of an absolute path that resolves to the same place.
const respell = (r, target, { flipCase }) => {
  const parts = target.split('/').filter(Boolean);
  const out = [];
  for (const part of parts) {
    if (r() < 0.2) out.push('.');
    if (r() < 0.2) out.push(`hop${Math.floor(r() * 9)}`, '..');
    out.push(flipCase ? [...part].map((ch) => (r() < 0.4 ? ch.toUpperCase() : ch)).join('') : part);
  }
  const joined = out.map((seg) => (r() < 0.2 ? `${seg}/` : seg)).join('/');
  return `/${joined}${r() < 0.3 ? '/' : ''}`;
};

describe('the platform write walls hold under every spelling (seeded fuzz)', () => {
  const prior = {};

  beforeAll(() => {
    prior.home = process.env.HOME;
    prior.data = process.env.NEUMA_DATA_ROOT;
    prior.realm = getRealmRoot();
    prior.path = process.env.PATH;
    process.env.PATH = `${path.join(HOME, '.cargo', 'bin')}${path.delimiter}${prior.path}`;
    process.env.HOME = HOME;
    process.env.NEUMA_DATA_ROOT = DATA;
    setRealmRoot(REALM);
  });

  afterAll(() => {
    process.env.HOME = prior.home;
    process.env.PATH = prior.path;
    if (prior.data === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = prior.data;
    setRealmRoot(prior.realm);
  });

  test.each(WALLS)('%s — the wall, a child below it, and their respellings are refused', (wall) => {
    const r = prng(SEED ^ wall.length);
    for (const target of [wall, path.join(wall, 'child', 'leaf.txt')]) {
      expect(laneStateWriteReason(target), target).not.toBeNull();
      for (let i = 0; i < PER_PATH; i += 1) {
        const spelling = respell(r, target, { flipCase: r() < 0.5 });
        expect(laneStateWriteReason(spelling), spelling).not.toBeNull();
      }
    }
  });

  test.each(REPO_GATES)('%s — a repository gate, a child below it, and their respellings are refused', (gate) => {
    const r = prng(SEED ^ gate.length ^ 0x5a5a);
    for (const target of [gate, path.join(gate, 'child', 'leaf.txt')]) {
      expect(laneStateWriteReason(target), target).not.toBeNull();
      for (let i = 0; i < PER_PATH; i += 1) {
        const spelling = respell(r, target, { flipCase: r() < 0.5 });
        expect(laneStateWriteReason(spelling), spelling).not.toBeNull();
      }
    }
  });

  test.each(NEAR_MISSES)('%s — a near-miss sibling and its respellings stay writable', (miss) => {
    const r = prng(SEED ^ miss.length ^ 0xffff);
    expect(laneStateWriteReason(miss), miss).toBeNull();
    for (let i = 0; i < PER_PATH; i += 1) {
      const spelling = respell(r, miss, { flipCase: r() < 0.5 });
      expect(laneStateWriteReason(spelling), spelling).toBeNull();
    }
  });

  test('the directories holding a wall count too — moving them aside moves the wall', () => {
    for (const holder of [HOME, path.join(HOME, '.config'), path.join(HOME, '.local', 'share'), DATA, path.dirname(REALM)]) {
      expect(laneStateWriteReason(holder), holder).not.toBeNull();
      expect(laneStateWriteReason(`${holder}/`), holder).not.toBeNull();
    }
  });
});
