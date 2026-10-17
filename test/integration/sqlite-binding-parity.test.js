// SQLite binding selection (RULE 0: real files, real drivers, no mocks).
//
// Why this exists (2026-07-21): better-sqlite3 is ABI-bound, and this repo
// serves two runtimes from one node_modules. Launching the Electron app
// rebuilt the addon for Electron's ABI, and the systemd daemon — plain Node —
// then could not load its own database. It did not crash; it logged one line
// and ran for fifteen minutes with platform persistence DISABLED.
//
// The obvious fix was to prefer node:sqlite, which has no compiled artifact
// and therefore no ABI to mismatch. These tests were written to prove the two
// bindings interchangeable — and instead proved they are NOT: node:sqlite
// truncates stored values at a null byte, breaking the byte-identity
// guarantee the security suite pins (Threat 1), and did not surface
// SQLITE_BUSY on a competing write.
//
// So the conclusion reversed. The engine stays; the BINARY gets isolated —
// one build cached per ABI, chosen at load time via better-sqlite3's
// nativeBinding option. Nothing is rebuilt, nothing is flipped under a
// running process, and both runtimes can hold their own ABI at once. What
// follows pins both halves: the mechanism, and the gap that decided it.
import { describe, it, expect, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { withEnv } from '../helpers/with-env.js';
import { createRequire } from 'node:module';
import { openDatabase, builtinAvailable, BINDING, nativeBindingFor } from '../../backend/services/drivers/sqlite-binding.js';
import { SqlitePlatform } from '../../backend/services/drivers/sqlite-platform.js';

const require = createRequire(import.meta.url);

describe('SQLite binding parity — the local path survives whichever runtime it lands in', () => {
  afterAll(() => vi.restoreAllMocks());

  it('this runtime offers the built-in binding, so the daemon needs no native addon', () => {
    // Node >= 22.5. If this ever fails on a supported runtime, the daemon has
    // silently gone back to depending on an ABI-bound artifact.
    expect(builtinAvailable()).toBe(true);
  });

  // The same real round trip through each binding. Both must agree.
  for (const binding of [BINDING.BUILTIN, BINDING.NATIVE]) {
    it(`${binding}: a full witness → neuma → update round trip on real disk`, async () => {
      const dir = await createTempDir(`binding-${binding.replace(/[^a-z]/gi, '')}`);
      const dbPath = path.join(dir, 'platform.db');

      await withEnv('NEUMA_SQLITE_BINDING', binding, async () => {
        const driver = new SqlitePlatform(dbPath);
        await driver.init();
        expect(driver.available).toBe(true);
        expect(driver.binding).toBe(binding);

        // create + read back by name and by id
        const witness = await driver.findOrCreateWitness('0xabc');
        expect(witness.id).toBeTruthy();
        const byId = await driver.getWitness(witness.id);
        expect(byId.id).toBe(witness.id);

        // a miss must be undefined in BOTH bindings — the driver leans on it
        expect(await driver.getWitness('nope-not-here')).toBeUndefined();

        // an UPDATE must report changes truthfully (the run() shape differs
        // between libraries if you are unlucky — here it must not)
        const updated = await driver.updateWitnessSettings(witness.id, { theme: 'dark' });
        expect(updated).toBeTruthy();

        // idempotent create returns the SAME row, not a duplicate
        const again = await driver.findOrCreateWitness('0xabc');
        expect(again.id).toBe(witness.id);

        driver.db.close();
      });
    }, 30000);
  }

  it('the two bindings write a file the OTHER can read — one on-disk format, no migration', async () => {
    const dir = await createTempDir('binding-crossread');
    const dbPath = path.join(dir, 'shared.db');
    let witnessId;

    // written by the built-in
    await withEnv('NEUMA_SQLITE_BINDING', BINDING.BUILTIN, async () => {
      const d = new SqlitePlatform(dbPath);
      await d.init();
      witnessId = (await d.findOrCreateWitness('0xcrossread')).id;
      d.db.close();
    });

    // read by the native addon — this is the real-world case: the daemon
    // writes, then the Electron app opens the same file.
    await withEnv('NEUMA_SQLITE_BINDING', BINDING.NATIVE, async () => {
      const d = new SqlitePlatform(dbPath);
      await d.init();
      const row = await d.getWitness(witnessId);
      expect(row?.id).toBe(witnessId);
      d.db.close();
    });
  }, 30000);

  it('the NATIVE binding is the default — the built-in is opt-in only', () => {
    const h = openDatabase(':memory:');
    expect(h.binding).toBe(BINDING.NATIVE);
    h.close();
  });

  it('WHY the built-in is not the default: it truncates values at a null byte', async () => {
    // Measured 2026-07-21, and the reason this whole approach was reversed.
    // The platform's Threat-1 guarantee is that stored values round-trip
    // BYTE-IDENTICALLY, including hostile payloads. better-sqlite3 keeps that
    // promise; node:sqlite silently drops everything past a NUL. This test
    // pins the difference so nobody re-adopts the built-in by default without
    // discovering it has been fixed.
    const evil = `x${String.fromCharCode(39, 34, 59, 0)})--DROP${String.fromCharCode(0)}`;

    await withEnv('NEUMA_SQLITE_BINDING', BINDING.NATIVE, async () => {
      const h = openDatabase(':memory:');
      h.exec('CREATE TABLE t (v TEXT)');
      h.prepare('INSERT INTO t VALUES (?)').run(evil);
      expect(h.prepare('SELECT v FROM t').get().v).toBe(evil); // byte-identical
      h.close();
    });

    await withEnv('NEUMA_SQLITE_BINDING', BINDING.BUILTIN, async () => {
      const h = openDatabase(':memory:');
      h.exec('CREATE TABLE t (v TEXT)');
      h.prepare('INSERT INTO t VALUES (?)').run(evil);
      const back = h.prepare('SELECT v FROM t').get().v;
      expect(back).not.toBe(evil);          // the documented gap
      expect(back).toBe('x\'";');           // truncated at the NUL
      h.close();
    });
  }, 30000);

  it('a per-ABI cached build is selected when present, else the default build', async () => {
    const dir = await createTempDir('abi-cache');
    // Nothing cached for a fabricated ABI → null means […]
    expect(nativeBindingFor('9999', dir)).toBeNull();

    // A cached build for this runtime's ABI is chosen by path
    const abiDir = path.join(dir, process.versions.modules);
    const fs = await import('fs/promises');
    await fs.mkdir(abiDir, { recursive: true });
    const cached = path.join(abiDir, 'better_sqlite3.node');
    await fs.writeFile(cached, 'not-a-real-addon');
    expect(nativeBindingFor(process.versions.modules, dir)).toBe(cached);
  }, 30000);

  it('a REAL per-ABI cached build opens a database — the isolation actually works', async () => {
    // Copy this runtime's genuine addon into the cache layout and open through
    // it. This is the mechanism that lets the daemon and the Electron app hold
    // different ABIs at once instead of rebuilding over each other.
    const dir = await createTempDir('abi-cache-real');
    const abiDir = path.join(dir, process.versions.modules);
    const fs = await import('fs/promises');
    await fs.mkdir(abiDir, { recursive: true });
    // Source the addon from a build known to match THIS runtime — the repo
    // cache if it has one, else node_modules. Reaching straight into
    // node_modules is precisely the assumption this work invalidates: it may
    // hold the other runtime's ABI right now.
    const cached = nativeBindingFor();
    const real = cached || require.resolve('better-sqlite3/build/Release/better_sqlite3.node');
    await fs.copyFile(real, path.join(abiDir, 'better_sqlite3.node'));

    await withEnv('NEUMA_NATIVE_ABI_DIR', dir, async () => {
      const h = openDatabase(':memory:');
      expect(h.binding).toBe(BINDING.NATIVE);
      h.exec('CREATE TABLE t (v TEXT)');
      h.prepare('INSERT INTO t VALUES (?)').run('through the cached build');
      expect(h.prepare('SELECT v FROM t').get().v).toBe('through the cached build');
      h.close();
    });
  }, 30000);

  it('the handle exposes one uniform surface regardless of binding', async () => {
    for (const binding of [BINDING.BUILTIN, BINDING.NATIVE]) {
      await withEnv('NEUMA_SQLITE_BINDING', binding, async () => {
        const h = openDatabase(':memory:');
        expect(typeof h.exec).toBe('function');
        expect(typeof h.pragma).toBe('function');
        expect(typeof h.prepare).toBe('function');
        expect(typeof h.close).toBe('function');
        // pragma is the one dialect gap — it must work through both
        h.pragma('foreign_keys = ON');
        h.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
        const info = h.prepare('INSERT INTO t (v) VALUES (?)').run('x');
        expect(info.changes).toBe(1);
        expect(h.prepare('SELECT v FROM t WHERE id = ?').get(info.lastInsertRowid).v).toBe('x');
        expect(h.prepare('SELECT * FROM t WHERE v = ?').get('absent')).toBeUndefined();
        h.close();
      });
    }
  }, 30000);
});
