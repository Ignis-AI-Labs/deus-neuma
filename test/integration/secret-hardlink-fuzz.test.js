/**
 * Seeded fuzz over hard-link NAMES (secret-inodes.js): the identity law must
 * not care what a twin is called, how deep it sits, or how it is reached.
 * Every case plants a hard link to one of the house's secrets under a
 * generated innocent name (respellings, unicode, dots, spaces, nested
 * folders) and reaches it plainly, through a symlink chain, or through a
 * dotted relative spelling. Each case carries an ordinary control built the
 * same way, which must still read. Every generated path is first checked to
 * be one the NAME law allows — so a refusal here is the inode law's alone.
 *
 * REAL organ, REAL sandbox, REAL links on one temp filesystem. No mock.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { standHouse, plant, hardlink, marker, textOf } from '../helpers/secret-hardlink-kit.js';
import { checkPathAccess } from '../../backend/services/sandbox-path-policy.js';

const SEED = 0x51c7e7;
const CASES = 48;
const ALPHABET = [...'abcXYZ019_-.~@+=, ', 'ñ', 'é', '漢', 'Ω'];
const STEMS = ['notes', 'NOTES', 'Notes', 'readme', 'todo', 'backup', 'copy', 'cfg', 'log', 'data'];
const EXTS = ['', '.txt', '.TXT', '.md', '.json', '.yml', '.bak', '.old', '.log', '.'];

// pure — mulberry32: a seeded generator, so every failure replays.
const seeded = (seed) => {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const noise = (rand, n) => Array.from({ length: n }, () => pick(rand, ALPHABET)).join('');
const name = (rand) => {
  const raw = `${rand() < 0.3 ? noise(rand, 1) : ''}${pick(rand, STEMS)}${noise(rand, Math.floor(rand() * 4))}${pick(rand, EXTS)}`;
  return raw.trim() === '' || raw === '.' || raw === '..' ? 'plain' : raw;
};
const WAYS = ['plain', 'symlink', 'symlink-chain', 'dotted'];

describe(`hard-link twins under fuzzed names are refused (seed ${SEED})`, () => {
  let house;
  let cases;

  beforeAll(async () => {
    house = await standHouse('secret-hardlink-fuzz', 'hardlinkfuzz');
    const rand = seeded(SEED);
    const kinds = Object.keys(house.secrets);
    const root = path.join(house.lane, 'fuzz');
    cases = [];
    for (let i = 0; i < CASES; i += 1) {
      const dirs = Array.from({ length: Math.floor(rand() * 4) }, () => name(rand));
      const at = path.join(root, `c${i}`, ...dirs);
      const kind = pick(rand, kinds);
      const way = pick(rand, WAYS);
      const twin = path.join(at, name(rand));
      const control = path.join(at, `ctl-${name(rand)}`);
      // The name law must pass every generated path: a refusal is the inode law's.
      for (const p of [twin, control]) expect(checkPathAccess(p).allowed, p).toBe(true);
      await hardlink(house.secrets[kind].file, twin);
      const mark = marker('control');
      const original = await plant(path.join(root, `c${i}`, 'control-source.txt'), `${mark}\n`);
      await hardlink(original, control);
      const reach = async (target, tag) => {
        if (way === 'plain') return target;
        // Spelled as a being might send it — path.join would fold the dots away.
        if (way === 'dotted') return `${path.dirname(target)}/./../${path.basename(path.dirname(target))}/${path.basename(target)}`;
        const first = path.join(root, `c${i}`, `${tag}-link-1`);
        await fs.symlink(target, first);
        if (way === 'symlink') return first;
        const second = path.join(root, `c${i}`, `${tag}-link-2`);
        await fs.symlink(first, second);
        return second;
      };
      cases.push({ i, kind, way, twin, control, reachTwin: await reach(twin, 't'), reachControl: await reach(control, 'k'), mark });
    }
  });

  afterAll(async () => { await house.restore(); });

  test('every twin is refused by fs/read, every control reads', async () => {
    for (const c of cases) {
      await expect(house.call('fs', 'read', { path: c.reachTwin }), `case ${c.i} ${c.kind} ${c.way} ${c.twin}`)
        .rejects.toThrow(/hard link/i);
      expect(textOf(await house.call('fs', 'read', { path: c.reachControl })), `control ${c.i}`).toContain(c.mark);
    }
  });

  test('a content search over every case returns no secret and every control', async () => {
    const text = textOf(await house.call('fs', 'search', {
      path: path.join(house.lane, 'fuzz'), pattern: 'HARDLINK_', content: true, excludePatterns: [], maxResults: 500,
    }));
    for (const s of Object.values(house.secrets)) expect(text).not.toContain(s.mark);
    for (const c of cases) expect(text, `control ${c.i}`).toContain(c.mark);
  });

  test('a name search lists no twin and no link to one, and lists every control', async () => {
    const listed = (p) => JSON.stringify(p).slice(1, -1);
    for (const c of cases) {
      // One search per case: a single walk over all of them would stop at the result cap.
      const text = textOf(await house.call('fs', 'search', { path: path.join(house.lane, 'fuzz', `c${c.i}`), pattern: '*', excludePatterns: [] }));
      expect(text, `case ${c.i}`).not.toContain(listed(c.twin));
      if (c.way.startsWith('symlink')) expect(text, `link ${c.i}`).not.toContain(listed(c.reachTwin));
      expect(text, `control ${c.i}`).toContain(listed(c.way.startsWith('symlink') ? c.reachControl : c.control));
    }
  });
});
