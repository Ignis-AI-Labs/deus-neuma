/**
 * platform-db-security-boundary.test.js — Wave-2 security proving suite for
 * the local-first SQLite platform driver (run-id platform-db-local-f234):
 * the BOUNDARY threats — injection (T1), path traversal (T2), secret
 * handling (T3), audit append-only (T5). Integrity/concurrency/fuzz live in
 * platform-db-security-integrity.test.js over the same kit.
 *
 * RULE 0: every assertion runs against a REAL better-sqlite3 file (or the raw
 * connection the driver exposes as `driver.db`). No mocks, no stubs. One
 * `describe` per threat from Wave-0 DELIVERABLE §6.
 */

import { describe, test, expect } from 'vitest';
import path from 'node:path';
import { runFacade } from '../helpers/platform-facade-process.js';

import { createTempDir } from '../helpers/temp-fs.js';
import { makeDriver, tableCount, tableExists } from '../helpers/platform-db-kit.js';
import { resolveDbPath } from '../../backend/services/drivers/sqlite-platform.js';
import { SEVERITY_MAX } from '../../backend/services/drivers/platform-store.js';

// =============================================================================
describe('Threat 1 — SQL injection via witness/neuma name + audit event', () => {
  test('witness name "Robert\'); DROP TABLE witnesses;--" round-trips verbatim; table intact', async () => {
    const { d } = await makeDriver('t1-witness');
    const evil = "Robert'); DROP TABLE witnesses;--";
    const before = tableCount(d.db, 'witnesses');

    const row = await d.findOrCreateWitness(evil);

    expect(tableExists(d.db, 'witnesses')).toBe(true);
    expect(row.name).toBe(evil);
    expect((await d.getWitness(row.id)).name).toBe(evil); // read back from disk
    expect(tableCount(d.db, 'witnesses')).toBe(before + 1); // no mass insert/drop
  });

  test('neuma name \'" OR 1=1 --\' round-trips verbatim; count +1 exactly', async () => {
    const { d } = await makeDriver('t1-neuma');
    const evil = '" OR 1=1 --';
    const before = tableCount(d.db, 'neuma_registry');

    const row = await d.registerNeuma({ name: evil });

    expect(tableExists(d.db, 'neuma_registry')).toBe(true);
    expect((await d.getNeuma(row.id)).name).toBe(evil);
    expect((await d.getNeumaByName(evil)).name).toBe(evil);
    expect(tableCount(d.db, 'neuma_registry')).toBe(before + 1);
  });

  test('audit event "evt\'); DELETE FROM platform_audit_log; --" stored verbatim; no mass delete', async () => {
    const { d } = await makeDriver('t1-audit');
    // seed a couple benign rows so a successful injection would be observable
    await d.audit('seed-a');
    await d.audit('seed-b');
    const before = tableCount(d.db, 'platform_audit_log');
    const evil = "evt'); DELETE FROM platform_audit_log; --";

    await d.audit(evil);

    expect(tableExists(d.db, 'platform_audit_log')).toBe(true);
    expect(tableCount(d.db, 'platform_audit_log')).toBe(before + 1); // seeds survive
    const events = (await d.getAuditLog({ limit: 10 })).map((r) => r.event);
    expect(events).toContain(evil);
  });

  test('String.fromCharCode payload (quotes, semicolons, null byte) round-trips byte-identical', async () => {
    const { d } = await makeDriver('t1-charcode');
    // ' " ; NUL ) -- built without literal control chars in source
    const evil =
      'x' + String.fromCharCode(39, 34, 59, 0, 41) + '--DROP' + String.fromCharCode(0);
    const before = tableCount(d.db, 'witnesses');

    const row = await d.findOrCreateWitness(evil);
    const readBack = (await d.getWitness(row.id)).name;

    expect(readBack).toBe(evil); // null byte + quotes preserved through SQLite TEXT
    expect(readBack.length).toBe(evil.length);
    expect(tableCount(d.db, 'witnesses')).toBe(before + 1);
    expect(tableExists(d.db, 'witnesses')).toBe(true);
  });
});

// =============================================================================
describe('Threat 2 — DB path traversal / operator co-mingling', () => {
  test('resolveDbPath rejects relative paths', () => {
    expect(() => resolveDbPath('../../../../tmp/escape.db')).toThrow(/absolute/);
    expect(() => resolveDbPath('platform.db')).toThrow(/absolute/);
  });

  test('resolveDbPath rejects ".."-bearing absolute paths', () => {
    expect(() => resolveDbPath(`${path.sep}tmp${path.sep}..${path.sep}etc${path.sep}x.db`))
      .toThrow(/\.\./);
  });

  test('resolveDbPath accepts :memory: and clean absolute paths (trusted env class, §5)', () => {
    expect(resolveDbPath(':memory:')).toBe(':memory:');
    // NOTE: a clean absolute path IS trusted by design (§5 — same class as
    // WORKSPACES_ROOT). This is NOT a hole; the guard rejects relative/".." only.
    const abs = `${path.sep}var${path.sep}data${path.sep}x.db`;
    expect(resolveDbPath(abs)).toBe(abs);
  });

  test('facade init throws on a relative PLATFORM_DB_PATH; nothing created', async () => {
    const { stdout } = await runFacade(`
      await assert.rejects(platform.init(), /absolute/);
      assert.equal(platform.available, false);
      process.stdout.write('PATH REFUSED\\n');
    `, { PLATFORM_DB_PATH: '../../../../tmp/escape.db' });
    expect(stdout).toContain('PATH REFUSED');
  });

  test('per-root isolation: witness written under root A is absent under root B', async () => {
    const { d: dA } = await makeDriver('t2-rootA');
    await dA.findOrCreateWitness('iso-witness');
    expect(dA.db.prepare('SELECT * FROM witnesses WHERE name = ?').get('iso-witness'))
      .toBeTruthy();

    const { d: dB } = await makeDriver('t2-rootB'); // different temp dir → different file
    const leaked = dB.db.prepare('SELECT * FROM witnesses WHERE name = ?').get('iso-witness');
    expect(leaked).toBeUndefined();
  });
});

// =============================================================================
describe('Threat 3 — secret handling at the driver boundary', () => {
  test('SUPABASE_SERVICE_KEY never reaches any log line; downgrades to sqlite; rows carry no key', async () => {
    const dir = await createTempDir('t3-secret');
    const dbFile = path.join(dir, 'platform.db');

    const { stdout, stderr } = await runFacade(`
      await platform.init();
      assert.equal(platform.available, true);
      assert.equal(platform.driver.constructor.name, 'SqlitePlatform');
      const row = await platform.findOrCreateWitness('secret-check');
      assert.equal('key' in row, false);
      assert.equal('service_key' in row, false);
      const persisted = await platform.getWitness(row.id);
      assert.deepEqual(persisted, row);
      process.stdout.write('SQLITE ROW VERIFIED\\n');
    `, {
      SUPABASE_URL: 'http://127.0.0.1:1', // Fetch refuses this port; no remote service.
      SUPABASE_SERVICE_KEY: 'SECRET123', // Deliberate non-secret leakage marker.
      PLATFORM_DB_PATH: dbFile,
    });

    expect(stdout + stderr).not.toContain('SECRET123');
    expect(stdout + stderr).toMatch(/downgrading to local/i);
    expect(stdout).toContain('SQLITE ROW VERIFIED');
  });
});

// =============================================================================
describe('Threat 5 — audit log append-only (anti-gaslighting)', () => {
  test('raw UPDATE + DELETE on a present row both throw append-only; row survives', async () => {
    const { d } = await makeDriver('t5-appendonly');
    await d.audit('present-event');
    expect(tableCount(d.db, 'platform_audit_log')).toBe(1);

    expect(() => d.db.prepare("UPDATE platform_audit_log SET event = 'tampered'").run())
      .toThrow(/append-only/);
    expect(() => d.db.prepare('DELETE FROM platform_audit_log').run())
      .toThrow(/append-only/);

    expect(tableCount(d.db, 'platform_audit_log')).toBe(1); // untouched
    expect((await d.getAuditLog())[0].event).toBe('present-event');
  });

  test('driver exposes no updateAudit / deleteAudit surface', async () => {
    const { d } = await makeDriver('t5-nosurface');
    expect(d.updateAudit).toBeUndefined();
    expect(d.deleteAudit).toBeUndefined();
    expect(typeof d.audit).toBe('function');
    expect(typeof d.getAuditLog).toBe('function');
  });

  test('severity 9999 clamps to SEVERITY_MAX; empty/whitespace event is skipped without throwing', async () => {
    const { d } = await makeDriver('t5-clamp');
    await d.audit('sev-test', { severity: 9999 });
    const row = (await d.getAuditLog()).find((r) => r.event === 'sev-test');
    expect(row.severity).toBe(SEVERITY_MAX);

    const before = tableCount(d.db, 'platform_audit_log');
    await expect(d.audit('')).resolves.toBeUndefined();
    await expect(d.audit('   ')).resolves.toBeUndefined();
    await expect(d.audit(null)).resolves.toBeUndefined();
    expect(tableCount(d.db, 'platform_audit_log')).toBe(before); // none inserted
  });
});
