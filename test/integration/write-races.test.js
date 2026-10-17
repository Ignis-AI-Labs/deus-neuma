/**
 * MEM-008 (#195) — read-modify-write writers run under the per-file lock, and
 * temp names are unique per call. Before the fix, a registration storm lost
 * most adapters to last-writer-wins, and a same-ms whole-file burst threw
 * spurious ENOENT from collided tmp renames.
 *
 * The adapter registry has since left that writer entirely. It is now the v2
 * append-only journal written by `test/helpers/refinement-registry-store.js`
 * (test lane; production writes ride the ceremony publication path), whose
 * concurrency answer is a held-inode CAS plus a durability read-back rather
 * than a lock: a writer holding a stale authority is REFUSED with a coded
 * registry refusal, and the caller retries. That is a different guarantee from
 * MEM-008's lock, and it is asserted here as what it is — no silent
 * last-writer-wins, and nothing lost when the caller honours the refusal.
 *
 * CQ-905 (#311) adds the FIRST revision, which has no prior inode to pin and
 * so was guarded by lstat-then-rename — a TOCTOU, because rename(2) clobbers
 * by contract. It is now link(2), an atomic create-if-absent. The two tests
 * below measure the difference by REFUSAL CODE, the only place it shows:
 * DURABILITY means the loser had already renamed onto the target and the
 * read-back noticed afterwards, CHANGED means the create refused it before it
 * ever touched the file. Detection after the fact versus prevention.
 *
 * Proven against the REAL writers on a real temp workspace (Rule 0): the real
 * store, the real AES-GCM envelope, real fsync, real renames.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  readFixtureAdapters,
  registerFixtureAdapter,
  setFixtureAdapterScale,
} from '../helpers/refinement-registry-fixture.js';

const KEY = 'gnosis-write-races-key-long-enough-ok';
const DNA = Object.freeze({ version: '1.0.0', identity: { name: 'Storm' } });
const APPROVED = [0, 1];
const REGISTRY_CONFLICT = ['REFINEMENT_REGISTRY_CHANGED', 'REFINEMENT_REGISTRY_DURABILITY'];

afterEach(() => {
  vi.restoreAllMocks();
});

const tmpFilesUnder = async (dir) => {
  const out = [];
  const walk = async (d) => {
    for (const entry of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.name.includes('.tmp')) out.push(p);
    }
  };
  await walk(dir);
  return out;
};

// A registry refusal can arrive wrapped in an AggregateError when a cleanup
// failure rides along with it, so a caller deciding whether to retry has to
// read every code inside rather than just the outer one.
const registryCodes = (error) => (error instanceof AggregateError
  ? error.errors.flatMap(registryCodes)
  : [error?.code ?? error?.message]);

describe('write races (MEM-008)', () => {
  let root, workspace, prevKey;

  beforeEach(async () => {
    vi.resetModules();
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    root = await createTempDir('write-races');
    workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
    workspace.root = root;
    await workspace.create('being');
    await workspace.writeDNA('being', DNA);
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  test('a sequential registration run loses NOT ONE adapter and leaves no temp file', async () => {
    for (let index = 0; index < 12; index += 1) {
      await registerFixtureAdapter(workspace, 'being', `adapter-${index}`, {
        approvedScales: APPROVED,
      });
    }
    const adapters = await readFixtureAdapters(workspace, 'being');
    expect(adapters.map((a) => a.id).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `adapter-${i}`).sort(),
    );
    // Every revision is an append on the one before it, so the journal's
    // generation counts the writes rather than the survivors.
    expect(adapters.at(-1).registryGeneration).toBe(12);
    expect(await tmpFilesUnder(path.join(root, 'being'))).toEqual([]);
  });

  test('a concurrent registration is refused, never silently overwritten', async () => {
    await registerFixtureAdapter(workspace, 'being', 'seed-refinement');
    const settled = await Promise.allSettled([
      registerFixtureAdapter(workspace, 'being', 'race-a'),
      registerFixtureAdapter(workspace, 'being', 'race-b'),
    ]);
    const landed = settled.filter(({ status }) => status === 'fulfilled');
    const refused = settled.filter(({ status }) => status === 'rejected');
    expect(landed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(REGISTRY_CONFLICT).toContain(refused[0].reason.code);

    // The loser's entry is absent because it was refused — not because a
    // committed entry was overwritten. The winner's journal is intact.
    const winner = landed[0].value.id;
    const loser = winner === 'race-a' ? 'race-b' : 'race-a';
    expect((await readFixtureAdapters(workspace, 'being')).map((a) => a.id))
      .toEqual(['seed-refinement', winner]);

    // Honouring the refusal loses nothing: the retry reads the winner's
    // revision and appends onto it.
    await registerFixtureAdapter(workspace, 'being', loser);
    expect((await readFixtureAdapters(workspace, 'being')).map((a) => a.id))
      .toEqual(['seed-refinement', winner, loser]);
  });

  // No seed: both writers open on an ABSENT registry, so both take the
  // first-revision path — the one the fix changes. Seeding instead exercises
  // the untouched held-inode CAS, whose loser is caught by the read-back
  // (measured DURABILITY 34 / CHANGED 6 over 40 rounds), so a seeded race
  // cannot assert a code. The test above is that one. Do not add a seed here.
  test('two first-revision writers: the create refuses one before it touches the file', async () => {
    const settled = await Promise.allSettled([
      registerFixtureAdapter(workspace, 'being', 'first-a'),
      registerFixtureAdapter(workspace, 'being', 'first-b'),
    ]);
    const landed = settled.filter(({ status }) => status === 'fulfilled');
    const refused = settled.filter(({ status }) => status === 'rejected');
    expect(landed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    // Measured 40 rounds each: CHANGED 40/40 through link(2), DURABILITY 40/40
    // through the lstat guard it replaced. EEXIST is mapped onto the store's
    // existing refusal, so no caller sees a new code or a raw errno.
    expect(registryCodes(refused[0].reason)).toEqual(['REFINEMENT_REGISTRY_CHANGED']);

    const adapters = await readFixtureAdapters(workspace, 'being');
    expect(adapters.map((a) => a.id)).toEqual([landed[0].value.id]);
    expect(adapters[0].registryGeneration).toBe(1);
    expect(await tmpFilesUnder(path.join(root, 'being'))).toEqual([]);
  });

  test('a 50-way first-revision storm: one create wins, and no writer is told a lie', async () => {
    const ATTEMPTS = 8;
    const opening = new Map();
    const write = async (id) => {
      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        try {
          await registerFixtureAdapter(workspace, 'being', id);
          if (!attempt) opening.set(id, 'fulfilled');
          return id;
        } catch (error) {
          const codes = registryCodes(error);
          if (!attempt) opening.set(id, codes.join('+'));
          if (!codes.every((code) => REGISTRY_CONFLICT.includes(code))) throw error;
        }
      }
      return null;
    };
    const claimed = (await Promise.all(
      Array.from({ length: 50 }, (_, index) => write(`adapter-${index}`)),
    )).filter(Boolean);

    // All 50 open on an absent registry, so the opening wave is 50 concurrent
    // first-revision writers. link(2) admits exactly one; the other 49 are
    // refused by the create itself. Measured 3 rounds each: 1 + 49 CHANGED
    // after the fix, 1 + 49 DURABILITY before it — and every one of those 49
    // had already rename(2)'d its own bytes onto the same target.
    const wave = [...opening.values()];
    expect(wave.filter((outcome) => outcome === 'fulfilled')).toHaveLength(1);
    expect(wave.filter((outcome) => outcome === 'REFINEMENT_REGISTRY_CHANGED'))
      .toHaveLength(49);

    // The property the TOCTOU actually violated. Not "most writers land" —
    // every writer TOLD it succeeded is carried by the committed registry, and
    // the registry carries nothing that no writer was told about.
    const present = (await readFixtureAdapters(workspace, 'being')).map((a) => a.id);
    expect(claimed.length).toBeGreaterThan(1);
    expect([...present].sort()).toEqual([...claimed].sort());
    expect(await tmpFilesUnder(path.join(root, 'being'))).toEqual([]);
  }, 60_000);

  test('a 50-way same-file whole-write storm: every write resolves, the file stays whole', async () => {
    const outcomes = await Promise.all(Array.from({ length: 50 }, (_, i) =>
      workspace.writeSoul('being', { voice: `voice-${i}`, seq: i }).then(() => true).catch(() => false),
    ));
    expect(outcomes.every(Boolean)).toBe(true);
    const soul = await workspace.readSoul('being');
    expect(soul.voice).toMatch(/^voice-\d+$/);
    expect(await tmpFilesUnder(path.join(root, 'being'))).toEqual([]);
  });

  test('a selection run lands every approved write without mutating the default', async () => {
    await registerFixtureAdapter(workspace, 'being', 'the-one', { approvedScales: APPROVED });
    for (let index = 0; index < 6; index += 1) {
      const selected = await setFixtureAdapterScale(
        workspace, 'being', 'the-one', index % 2 === 0 ? 0 : 1,
      );
      expect(selected.scale).toBe(1);
      expect(selected.selectedScale).toBe(index % 2 === 0 ? 0 : 1);
    }
    const [adapter] = await readFixtureAdapters(workspace, 'being');
    expect(adapter.id).toBe('the-one');
    expect(adapter.scale).toBe(1);
    expect(adapter.selectedScale).toBe(1);
    expect(await tmpFilesUnder(path.join(root, 'being'))).toEqual([]);
  });
});
