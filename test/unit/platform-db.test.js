/**
 * PlatformDB facade — driver selection, path guard, delegation, shim identity.
 * Real SQLite and fresh Node processes isolate singleton state and capture
 * actual output without changing production streams or the parent environment.
 */
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { createTempDir } from '../helpers/temp-fs.js';
import { runFacade } from '../helpers/platform-facade-process.js';

describe('driver selection matrix', () => {
  test('(a) neither Supabase var set → sqlite driver, no throw', async () => {
    await runFacade(`
      assert.equal(await platform.init(), undefined);
      assert.equal(platform.available, true);
      assert.equal(platform.driver.constructor.name, 'SqlitePlatform');
    `);
  });

  test('(b) both vars set but probe fails → downgrade to sqlite, LOGGED, no throw', async () => {
    const { stdout, stderr } = await runFacade(`
      assert.equal(await platform.init(), undefined);
      assert.equal(platform.available, true);
      assert.equal(platform.driver.constructor.name, 'SqlitePlatform');
    `, {
      SUPABASE_URL: 'http://127.0.0.1:1', // Fetch refuses the port; no remote service.
      SUPABASE_SERVICE_KEY: 'test-service-marker',
    });
    expect(stdout + stderr).toMatch(/downgrad/i);
  });
});

describe('PLATFORM_DB_PATH guard', () => {
  test(':memory: is accepted', async () => {
    await runFacade(`
      assert.equal(await platform.init(), undefined);
      assert.equal(platform.available, true);
    `, { PLATFORM_DB_PATH: ':memory:' });
  });

  test('a relative path throws', async () => {
    await runFacade(`await assert.rejects(platform.init(), /absolute/i);`, {
      PLATFORM_DB_PATH: 'foo/bar.db',
    });
  });

  test('a path with a ".." segment throws', async () => {
    // path.join would normalize the forbidden segment before the guard sees it.
    await runFacade(`await assert.rejects(platform.init(), /\\.\\./);`, {
      PLATFORM_DB_PATH: `${path.sep}tmp${path.sep}foo${path.sep}..${path.sep}bar.db`,
    });
  });

  test('an absolute temp path creates the containing dir (mkdir -p) and the DB file', async () => {
    const base = await createTempDir('platform-db-guard');
    const nested = path.join(base, 'deep', 'nested');
    const dbFile = path.join(nested, 'platform.db');
    expect(fs.existsSync(nested)).toBe(false);
    await runFacade(`
      await platform.init();
      assert.equal(platform.available, true);
    `, { PLATFORM_DB_PATH: dbFile });
    expect(fs.existsSync(nested)).toBe(true);
    expect(fs.existsSync(dbFile)).toBe(true);
  });
});

describe('graceful degradation on a driver load/open failure', () => {
  test('a real init failure (parent path is a file) degrades to a no-op driver, never crashes', async () => {
    const base = await createTempDir('platform-db-degrade');
    const asFile = path.join(base, 'iam-a-file');
    fs.writeFileSync(asFile, 'not a directory');
    const { stderr } = await runFacade(`
      assert.equal(await platform.init(), undefined);
      assert.equal(platform.available, false);
      assert.equal(await platform.findOrCreateWitness('x'), null);
      assert.equal(await platform.getWitness('x'), undefined);
      assert.deepEqual(await platform.listNeuma('x'), []);
      assert.deepEqual(await platform.getAuditLog({}), []);
      assert.equal(await platform.audit('e', {}), undefined);
    `, { PLATFORM_DB_PATH: path.join(asFile, 'sub', 'platform.db') });
    expect(stderr).toMatch(/platform persistence DISABLED/);
  });
});

describe('1:1 delegation through the facade', () => {
  test('findOrCreateWitness → createBirthCeremony → audit → getAuditLog end-to-end', async () => {
    // These are temporary platform registry rows, not a birth ceremony execution.
    await runFacade(`
      await platform.init();
      const witness = await platform.findOrCreateWitness('Delegator');
      assert.ok(witness.id);
      const ceremony = await platform.createBirthCeremony(witness.id);
      assert.ok(ceremony.id);
      assert.equal(ceremony.status, 'in_progress');
      await platform.audit('DELEGATED_EVENT', { witnessId: witness.id, severity: 4 });
      const log = await platform.getAuditLog({ witnessId: witness.id });
      assert.equal(log.length, 1);
      assert.equal(log[0].event, 'DELEGATED_EVENT');
      assert.equal(log[0].witness_id, witness.id);
    `);
  });
});

describe('back-compat shim identity', () => {
  test('supabase.js default === platform-db.js default (same singleton)', async () => {
    const shimUrl = new URL('../../backend/services/supabase.js', import.meta.url).href;
    await runFacade(`
      const { default: shim } = await import(${JSON.stringify(shimUrl)});
      assert.equal(shim, platform);
    `);
  });
});
