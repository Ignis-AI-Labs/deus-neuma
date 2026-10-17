/**
 * platform-db-security-integrity.test.js — Wave-2 security + property/fuzz
 * proving suite for the local-first SQLite platform driver (run-id
 * platform-db-local-f234): the INTEGRITY threats — concurrency/crash (T4),
 * JSON-column injection / prototype pollution (T6), DoS clamps (T7), and the
 * bounded random property/fuzz block. Boundary threats (T1/T2/T3/T5) live in
 * platform-db-security-boundary.test.js over the same kit.
 *
 * RULE 0: every assertion runs against a REAL better-sqlite3 file (or the raw
 * connection the driver exposes as `driver.db`). No mocks, no stubs. One
 * `describe` per threat from Wave-0 DELIVERABLE §6.
 */

import crypto from 'node:crypto';

import { makeDriver, rawConn, tableCount, tableExists } from '../helpers/platform-db-kit.js';
import {
  AUDIT_LOG_LIMIT_MAX,
  AUDIT_LOG_LIMIT_DEFAULT,
  JSON_COLUMN_MAX_BYTES,
  STAGE_DATA_MAX_BYTES
} from '../../backend/services/drivers/platform-store.js';

// =============================================================================
describe('Threat 4 — integrity / concurrency / crash', () => {
  test('pragmas: journal_mode=wal, foreign_keys=1', async () => {
    const { d } = await makeDriver('t4-pragma');
    expect(String(d.db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
    expect(Number(d.db.pragma('foreign_keys', { simple: true }))).toBe(1);
  });

  test('orphan FK insert throws SQLITE_CONSTRAINT', async () => {
    const { d } = await makeDriver('t4-fk');
    let err;
    try {
      await d.addBirthStageHistory('no-such-ceremony', 1, 'hi', 'there');
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect(String(err.code || err.message)).toMatch(/SQLITE_CONSTRAINT/);
  });

  test('competing write surfaces SQLITE_BUSY (not a hang, not a silent drop)', async () => {
    const { d, dbFile } = await makeDriver('t4-busy');
    d.db.pragma('busy_timeout = 80'); // keep the wait short & deterministic

    const c2 = rawConn(dbFile);
    c2.pragma('busy_timeout = 80');
    c2.exec('BEGIN IMMEDIATE'); // take the WAL write lock

    let err;
    try {
      await d.findOrCreateWitness('busy-loser'); // throwing mutator (audit() would swallow)
    } catch (e) {
      err = e;
    } finally {
      c2.exec('ROLLBACK');
    }

    expect(err).toBeTruthy();
    expect(String(err.code || err.message)).toMatch(/SQLITE_BUSY/);
    // sanity: reasoning holds — busy_timeout pragma is really set on the driver conn
    expect(Number(d.db.pragma('busy_timeout', { simple: true }))).toBe(80);
  });
});

// =============================================================================
describe('Threat 6 — JSON-column injection / prototype pollution', () => {
  test('SQL/JS payload strings inside settings/details/stage_data round-trip exactly', async () => {
    const { d } = await makeDriver('t6-roundtrip');
    const payload = {
      sql: "'); DROP TABLE witnesses; --",
      js: 'function(){ while(true){} }',
      nul: 'a' + String.fromCharCode(0) + 'b',
      unicode: '日本語🔥'
    };

    const w = await d.findOrCreateWitness('json-witness');
    await d.updateWitnessSettings(w.id, payload);
    expect((await d.getWitness(w.id)).settings).toEqual(payload);

    await d.audit('json-audit', { details: payload });
    const a = (await d.getAuditLog()).find((r) => r.event === 'json-audit');
    expect(a.details).toEqual(payload);

    const c = await d.createBirthCeremony(w.id);
    await d.updateBirthCeremony(c.id, { stage_data: payload });
    expect((await d.getActiveCeremony(w.id)).stage_data).toEqual(payload);
  });

  test('own __proto__ key is rejected on write; Object.prototype stays clean', async () => {
    const { d } = await makeDriver('t6-proto');
    const polluter = JSON.parse('{"__proto__":{"polluted":true}}'); // real OWN key

    const w = await d.findOrCreateWitness('proto-witness');
    await expect(d.updateWitnessSettings(w.id, polluter)).rejects.toThrow(/__proto__/);

    // audit swallows the same rejection (never throws) and inserts nothing.
    const before = tableCount(d.db, 'platform_audit_log');
    await expect(d.audit('proto-audit', { details: polluter })).resolves.toBeUndefined();
    expect(tableCount(d.db, 'platform_audit_log')).toBe(before);

    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  test('constructor.prototype payload is neutralized as inert data (no pollution on read)', async () => {
    const { d } = await makeDriver('t6-ctor');
    const payload = JSON.parse('{"constructor":{"prototype":{"polluted2":true}}}');

    await d.audit('ctor-audit', { details: payload });
    const a = (await d.getAuditLog()).find((r) => r.event === 'ctor-audit');
    expect(a.details).toEqual(payload); // stored/returned as plain data
    expect({}.polluted2).toBeUndefined();
    expect(Object.prototype.polluted2).toBeUndefined();
  });

  test('oversize JSON blobs are rejected with a clear Error', async () => {
    const { d } = await makeDriver('t6-oversize');
    const w = await d.findOrCreateWitness('big-witness');
    const bigSettings = { blob: 'x'.repeat(JSON_COLUMN_MAX_BYTES + 1000) };
    await expect(d.updateWitnessSettings(w.id, bigSettings)).rejects.toThrow(/exceeds .* byte cap/);

    const c = await d.createBirthCeremony(w.id);
    const bigStage = { blob: 'y'.repeat(STAGE_DATA_MAX_BYTES + 1000) };
    await expect(d.updateBirthCeremony(c.id, { stage_data: bigStage })).rejects.toThrow(/exceeds .* byte cap/);
  });

  test('pathologically deep + circular objects throw a clean Error (not a stack overflow)', async () => {
    const { d } = await makeDriver('t6-depth');
    const w = await d.findOrCreateWitness('deep-witness');
    // Build a 5000-level nested object — deeper than the MAX_JSON_DEPTH guard.
    let deep = {};
    for (let i = 0; i < 5000; i++) deep = { nested: deep };
    await expect(d.updateWitnessSettings(w.id, deep)).rejects.toThrow(/nested deeper than/);
    // A circular reference must also be rejected cleanly (the depth guard catches it
    // before JSON.stringify, which would otherwise throw its own circular error).
    const circular = {};
    circular.self = circular;
    await expect(d.updateWitnessSettings(w.id, circular)).rejects.toThrow(/nested deeper than/);
    // audit() swallows-and-logs, so it must not crash the process on a circular input.
    await expect(d.audit('circular-evt', { witnessId: w.id, details: circular })).resolves.toBeUndefined();
  });

  test('a corrupt JSON cell is surfaced + returns a safe fallback; the getter never throws', async () => {
    const { d } = await makeDriver('t6-corrupt');
    const w = await d.findOrCreateWitness('corrupt-witness');
    // Corrupt the cell directly (UPDATE on witnesses is allowed — no trigger there).
    d.db.prepare('UPDATE witnesses SET settings = ? WHERE id = ?').run('not-json{', w.id);
    let out;
    await expect((async () => { out = await d.getWitness(w.id); })()).resolves.toBeUndefined();
    expect(out.settings).toBeNull(); // safe fallback, not a crash

    // Corrupt an audit details cell via raw INSERT (INSERT bypasses append-only triggers).
    d.db.prepare(
      `INSERT INTO platform_audit_log (id, neuma_id, witness_id, event, details, severity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), null, null, 'corrupt-audit', 'oops{', 1, new Date().toISOString());
    let auditOut;
    await expect((async () => { auditOut = await d.getAuditLog(); })()).resolves.toBeUndefined();
    const bad = auditOut.find((r) => r.event === 'corrupt-audit');
    expect(bad.details).toEqual({}); // fallback
  });
});

// =============================================================================
describe('Threat 7 — DoS / unbounded growth (limit clamps + indexes)', () => {
  test('getAuditLog limit is clamped/normalized; default is newest-first 100', async () => {
    const { d } = await makeDriver('t7-limit');
    // Raw-insert with monotonic created_at so newest-first ordering is deterministic.
    const insert = d.db.prepare(
      `INSERT INTO platform_audit_log (id, neuma_id, witness_id, event, details, severity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const base = Date.parse('2020-01-01T00:00:00.000Z');
    const N = AUDIT_LOG_LIMIT_MAX + 1; // 1001
    const tx = d.db.transaction(() => {
      for (let i = 0; i < N; i++) {
        insert.run(crypto.randomUUID(), null, null, `evt-${i}`, '{}', 1,
          new Date(base + i * 1000).toISOString());
      }
    });
    tx();

    const def = await d.getAuditLog();
    expect(def.length).toBe(AUDIT_LOG_LIMIT_DEFAULT); // 100
    expect(def[0].event).toBe(`evt-${N - 1}`); // newest first
    expect(def[AUDIT_LOG_LIMIT_DEFAULT - 1].event).toBe(`evt-${N - AUDIT_LOG_LIMIT_DEFAULT}`);

    expect((await d.getAuditLog({ limit: 1e9 })).length).toBe(AUDIT_LOG_LIMIT_MAX); // 1000, clamped
    expect((await d.getAuditLog({ limit: 'DROP' })).length).toBe(AUDIT_LOG_LIMIT_DEFAULT); // NaN → default
    expect((await d.getAuditLog({ limit: NaN })).length).toBe(AUDIT_LOG_LIMIT_DEFAULT);
    expect((await d.getAuditLog({ limit: -5 })).length).toBe(1); // floored to 1
  });

  test('getAuditLog minSeverity: non-numeric drops the clause instead of a NaN-bind RangeError', async () => {
    const { d } = await makeDriver('t7-minsev');
    const w = await d.findOrCreateWitness('sev-witness');
    await d.audit('low', { witnessId: w.id, severity: 1 });
    await d.audit('high', { witnessId: w.id, severity: 8 });
    // Non-numeric minSeverity must NOT throw — the clause is dropped, all rows return.
    const all = await d.getAuditLog({ witnessId: w.id, minSeverity: 'abc' });
    expect(all.length).toBe(2);
    // A real numeric threshold still filters.
    const high = await d.getAuditLog({ witnessId: w.id, minSeverity: 5 });
    expect(high.map((r) => r.event)).toEqual(['high']);
  });

  test('expected indexes exist on platform_audit_log', async () => {
    const { d } = await makeDriver('t7-index');
    const names = d.db.pragma("index_list('platform_audit_log')").map((r) => r.name);
    for (const idx of ['idx_audit_neuma', 'idx_audit_witness', 'idx_audit_created', 'idx_audit_severity']) {
      expect(names).toContain(idx);
    }
  });
});

// =============================================================================
describe('property/fuzz — bounded random ops against invariants', () => {
  // Deterministic LCG (reproducible; no Math.random).
  const makeRng = (seed) => () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const HOSTILE = [
    "Robert'); DROP TABLE witnesses;--",
    '" OR 1=1 --',
    "'; DELETE FROM platform_audit_log; --",
    '/* comment */ SELECT 1',
    '--',
    'plain-name',
    '日本語テスト🔥',
    'x'.repeat(4096),
    '__proto__',
    'constructor',
    'prototype',
    String.fromCharCode(39, 34, 59, 0, 10, 9), // ' " ; NUL LF TAB
    'a' + String.fromCharCode(0) + 'b'
  ];

  test('400 mixed ops preserve every invariant (tables, byte-identity, no deletes, counts, no pollution)', async () => {
    const { d } = await makeDriver('fuzz');
    const rand = makeRng(0x1234567);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const hostile = () => pick(HOSTILE) + (rand() < 0.5 ? '' : `-${Math.floor(rand() * 1e6)}`);

    const uniqueWitnessNames = new Set();
    const witnessIds = [];
    const witnessById = new Map();
    const neumas = [];
    const ceremonyIds = [];
    let stageHistoryCount = 0;
    const writtenEvents = [];
    let pollutionAttempts = 0;
    let opFailures = 0;

    const OPS = 400;
    for (let i = 0; i < OPS; i++) {
      const r = rand();
      try {
        if (r < 0.3) {
          // witness (name UNIQUE → dupes return existing, no new row)
          const name = hostile();
          const w = await d.findOrCreateWitness(name);
          expect(w.name).toBe(name); // verbatim on the returned row
          if (!uniqueWitnessNames.has(name)) {
            uniqueWitnessNames.add(name);
            witnessIds.push(w.id);
            witnessById.set(w.id, name);
          }
        } else if (r < 0.55) {
          // neuma (name not unique → always inserts); witness_id must be real or null (FK)
          const name = hostile();
          const wid = witnessIds.length && rand() < 0.7 ? pick(witnessIds) : null;
          const n = await d.registerNeuma({ name, witnessId: wid });
          neumas.push({ id: n.id, name });
        } else if (r < 0.72) {
          // ceremony; witness_id real or null (FK)
          const wid = witnessIds.length && rand() < 0.7 ? pick(witnessIds) : null;
          const c = await d.createBirthCeremony(wid);
          ceremonyIds.push(c.id);
        } else if (r < 0.82 && ceremonyIds.length) {
          // stage history — ceremony_id must be real (FK NOT NULL)
          await d.addBirthStageHistory(pick(ceremonyIds), Math.floor(rand() * 8), hostile(), hostile());
          stageHistoryCount++;
        } else {
          // audit — sometimes attempt prototype pollution (must be rejected, not counted)
          const event = hostile();
          if (rand() < 0.15) {
            pollutionAttempts++;
            const bad = JSON.parse('{"__proto__":{"polluted":true}}');
            await d.audit(event, { details: bad }); // swallowed → NOT inserted
          } else {
            await d.audit(event, { details: { k: hostile() }, severity: Math.floor(rand() * 12) });
            writtenEvents.push(event);
          }
        }
      } catch {
        opFailures++;
      }
    }

    // Invariant 1: no op crashed the loop.
    expect(opFailures).toBe(0);

    // Invariant 2: all five tables still exist.
    for (const t of ['witnesses', 'neuma_registry', 'birth_ceremonies', 'birth_stage_history', 'platform_audit_log']) {
      expect(tableExists(d.db, t)).toBe(true);
    }

    // Invariant 3: row counts equal successful inserts (no phantom/mass delete).
    expect(tableCount(d.db, 'witnesses')).toBe(uniqueWitnessNames.size);
    expect(tableCount(d.db, 'neuma_registry')).toBe(neumas.length);
    expect(tableCount(d.db, 'birth_ceremonies')).toBe(ceremonyIds.length);
    expect(tableCount(d.db, 'birth_stage_history')).toBe(stageHistoryCount);
    expect(tableCount(d.db, 'platform_audit_log')).toBe(writtenEvents.length);

    // Invariant 4: every stored witness/neuma name reads back byte-identical.
    for (const [id, name] of witnessById) expect((await d.getWitness(id)).name).toBe(name);
    for (const { id, name } of neumas) expect((await d.getNeuma(id)).name).toBe(name);

    // Invariant 5: every audit event reads back byte-identical (multiset compare).
    expect(writtenEvents.length).toBeLessThan(AUDIT_LOG_LIMIT_MAX); // all fetchable in one page
    const readEvents = (await d.getAuditLog({ limit: AUDIT_LOG_LIMIT_MAX })).map((r) => r.event);
    expect(readEvents.slice().sort()).toEqual(writtenEvents.slice().sort());

    // Invariant 6: no audit row was deleted despite hostile DELETE-shaped payloads.
    expect(tableCount(d.db, 'platform_audit_log')).toBe(writtenEvents.length);

    // Invariant 7: Object.prototype un-polluted after all pollution attempts.
    expect(pollutionAttempts).toBeGreaterThan(0); // the corpus actually exercised it
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });
});
