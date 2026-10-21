/**
 * THE ID VALIDATORS, FUZZED (security seat pen + fuzz plan, item 6). Ids a
 * client or a being sends become file names: a lane id (NeumaWorkspace._path,
 * behind every engine read and write), a chat session id (_sessionPath,
 * client-sent on portal:resume), a birth session id (birthSessionPath,
 * client-sent on birth:resume — e8789babf), and a plan step id (isStepId /
 * the part log — af55f92c2). Each is thrown ~3k generated ids built from
 * traversal and unicode pieces; whatever is accepted must name exactly one
 * entry directly inside the folder it belongs to, under its own name — never
 * a path. Liveness rows prove ordinary ids still pass. Seeded; real functions,
 * real temp grounds.
 */
import fs from 'fs/promises';
import path from 'path';
import workspace, { setWorkspacesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { birthSessionPath } from '../../core/birth/birth-session-store.js';
import { resolveCeremonyScratchDir } from '../../core/birth/ceremony-write.js';
import { isStepId } from '../../backend/services/team-coordinator.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { prng, pick } from '../helpers/seeded-fuzz.js';

const SEED = 0x1d5;
const ROUNDS = 3000;
const PIECES = Object.freeze([
  '..', '.', '/', '\\', '%2e', '%2f', '%2e%2e', '\0', '／', '．', '․', '‥', '‮', '​', 'é', 'ß',
  '😀', ' ', '\n', '\t', ':', '*', '?', '~', 'a', 'Z', '0', '9', '-', '_', 'witness-', 'lane', 'CON', 'x'.repeat(40),
  '../', '/..', '..\\', 'C:', '//', '$(id)', '`', "'", '"', ';', '|', '&', '<', '>',
]);

const generate = (r) => {
  const n = 1 + Math.floor(r() * 7);
  let id = '';
  for (let i = 0; i < n; i += 1) id += pick(r, PIECES);
  return id;
};

// the accepted id names one entry directly inside `dir`, under exactly its name
const namesOneChild = (result, dir, fileName) =>
  path.dirname(result) === dir && path.basename(result) === fileName && !fileName.includes('/') && !fileName.includes('\0');

// impure — run the builder; the thrown refusal is the safe answer
const tryBuild = (build) => {
  try {
    return { ok: true, value: build() };
  } catch {
    return { ok: false };
  }
};

describe('no generated id ever validates as a path (seeded fuzz)', () => {
  let ground, witnesses;

  beforeAll(async () => {
    const base = await createTempDir('ids-fuzz');
    ground = path.join(base, 'workspaces');
    witnesses = path.join(base, 'witnesses');
    await fs.mkdir(ground, { recursive: true });
    await fs.mkdir(witnesses, { recursive: true });
    setWorkspacesRoot(ground);
    setWitnessesRoot(witnesses);
  });

  test('liveness — ordinary ids of each kind still pass', () => {
    expect(workspace.pathFor('keir')).toBe(path.join(ground, 'keir'));
    expect(workspace.pathFor('witness-claude-code-keir')).toBe(path.join(witnesses, 'witness-claude-code-keir'));
    expect(workspace._sessionPath('keir', 'ses_2026-10-19_a1')).toBe(path.join(ground, 'keir', 'sessions', 'ses_2026-10-19_a1.jsonl'));
    expect(path.basename(birthSessionPath('0123456789abcdef0123456789abcdef'))).toBe('birth-0123456789abcdef0123456789abcdef.json');
    for (const id of ['build', 'build-2', 'v1.2', 'market_research']) expect(isStepId(id), id).toBe(true);
  });

  test('a lane id resolves to one lane directly in its ground, or is refused', () => {
    const r = prng(SEED);
    const wrong = [];
    for (let i = 0; i < ROUNDS; i += 1) {
      const id = generate(r);
      const built = tryBuild(() => workspace.pathFor(id));
      if (!built.ok) continue;
      const home = id.startsWith('witness-') ? witnesses : ground;
      if (!namesOneChild(built.value, home, id)) wrong.push(JSON.stringify(id));
    }
    expect(wrong).toEqual([]);
  });

  test('a chat session id names one file in the lane\'s sessions folder, or is refused', () => {
    const r = prng(SEED ^ 0x5e5);
    const wrong = [];
    for (let i = 0; i < ROUNDS; i += 1) {
      const id = generate(r);
      const built = tryBuild(() => workspace._sessionPath('keir', id));
      if (built.ok && !namesOneChild(built.value, path.join(ground, 'keir', 'sessions'), `${id}.jsonl`)) wrong.push(JSON.stringify(id));
    }
    expect(wrong).toEqual([]);
  });

  test('a birth session id is the minted shape (32 hex) or refused — never a walk out of the scratch folder', () => {
    const r = prng(SEED ^ 0xb17);
    const scratch = resolveCeremonyScratchDir(path.resolve('.'));
    const wrong = [];
    for (let i = 0; i < ROUNDS; i += 1) {
      const id = r() < 0.1 ? `${'a'.repeat(31)}${pick(r, PIECES)}` : generate(r);
      const built = tryBuild(() => birthSessionPath(id));
      if (built.ok && !(/^[0-9a-f]{32}$/.test(id) && namesOneChild(built.value, scratch, `birth-${id}.json`))) wrong.push(JSON.stringify(id));
    }
    expect(wrong).toEqual([]);
  });

  test('a plan step id that validates is one safe word, and the part log keeps it in its run folder', () => {
    const r = prng(SEED ^ 0x57e9);
    const wrong = [];
    const runDir = path.join(ground, 'keir', 'team', 'runs', 'run-1');
    for (let i = 0; i < ROUNDS; i += 1) {
      const id = generate(r);
      if (!isStepId(id)) continue;
      const safe = !/[/\\\0]/.test(id) && id !== '.' && !id.includes('..') && path.basename(path.join(runDir, id)) === id;
      const log = tryBuild(() => workspace._teamLogPath('keir', 'run-1', id));
      if (!safe || !log.ok || !namesOneChild(log.value, runDir, `${id}.jsonl`)) wrong.push(JSON.stringify(id));
    }
    expect(wrong).toEqual([]);
  });

  // FOUND (security seat, builder G, 2026-10-19), fixed the same day: _path's
  // symlink check compared the lane's real path to the ground with a bare
  // startsWith, no separator — so a lane entry that is a symlink to a SIBLING
  // folder whose name extends the ground's (`<ground>-evil/x`) passed as
  // inside it. Defense in depth: the write walls refuse new entries in a ground.
  test('a lane that is a symlink to a sibling of the ground is refused', async () => {
    const sibling = `${ground}-evil`;
    await fs.mkdir(path.join(sibling, 'x'), { recursive: true });
    await fs.symlink(path.join(sibling, 'x'), path.join(ground, 'linked'));
    expect(() => workspace.pathFor('linked')).toThrow(/traversal/i);
  });
});
