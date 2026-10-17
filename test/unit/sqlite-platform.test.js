/**
 * SqlitePlatform driver — functional + Supabase-parity tests.
 *
 * RULE 0: exercises the REAL better-sqlite3 driver against a real :memory:
 * (and a real temp-file) DB. No mocks of the system under test. Every
 * assertion checks observable results — returned rows and on-disk DB state.
 */

import fs from 'node:fs';
import path from 'node:path';

import { SqlitePlatform } from '../../backend/services/drivers/sqlite-platform.js';
import { createTempDir } from '../helpers/temp-fs.js';

// Busy-wait a couple ms so successive now() ISO timestamps are DISTINCT.
// created_at has ms resolution and better-sqlite3 is synchronous, so adjacent
// inserts would otherwise tie and make DESC/ASC ordering non-deterministic.
const tick = (ms = 2) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
};

describe('SqlitePlatform — in-memory functional + parity', () => {
  let driver;

  beforeEach(async () => {
    driver = new SqlitePlatform(':memory:');
    await driver.init();
  });

  afterEach(() => {
    driver.db.close();
  });

  // --- witnesses ---
  describe('witnesses', () => {
    test('findOrCreateWitness creates a row with .id and .name', async () => {
      const w = await driver.findOrCreateWitness('Alice');
      expect(w).toBeDefined();
      expect(typeof w.id).toBe('string');
      expect(w.id.length).toBeGreaterThan(0);
      expect(w.name).toBe('Alice');
      expect(w).toHaveProperty('created_at');
    });

    test('findOrCreateWitness is idempotent — same name returns same id', async () => {
      const first = await driver.findOrCreateWitness('Bob');
      const second = await driver.findOrCreateWitness('Bob');
      expect(second.id).toBe(first.id);
      // and only one row exists
      const count = driver.db.prepare('SELECT COUNT(*) c FROM witnesses WHERE name = ?').get('Bob').c;
      expect(count).toBe(1);
    });

    test('getWitness hit returns the row, miss returns undefined', async () => {
      const w = await driver.findOrCreateWitness('Carol');
      expect((await driver.getWitness(w.id)).id).toBe(w.id);
      expect(await driver.getWitness('no-such-id')).toBeUndefined();
    });

    test('updateWitnessSettings round-trips a JSON object', async () => {
      const w = await driver.findOrCreateWitness('Dana');
      const settings = { theme: 'dark', nested: { a: 1, list: [1, 2, 3] } };
      const updated = await driver.updateWitnessSettings(w.id, settings);
      expect(updated.settings).toEqual(settings);
      // persisted + parsed on a fresh read
      expect((await driver.getWitness(w.id)).settings).toEqual(settings);
    });

    test('updateWitnessSettings on a missing witness throws', async () => {
      await expect(driver.updateWitnessSettings('ghost', { x: 1 })).rejects.toThrow();
    });
  });

  // --- neuma registry ---
  describe('neuma registry', () => {
    test('registerNeuma returns a row with .id and snake_case columns', async () => {
      const w = await driver.findOrCreateWitness('WitnessN');
      const n = await driver.registerNeuma({
        name: 'Nyx',
        witnessId: w.id,
        workspacePath: '/ws/nyx',
        vessel: 'fenna.vrm',
        resonanceFrequency: 963
      });
      expect(typeof n.id).toBe('string');
      // parity: snake_case column names on the returned row
      expect(n.witness_id).toBe(w.id);
      expect(n.workspace_path).toBe('/ws/nyx');
      expect(n.resonance_frequency).toBe(963);
      expect(n.vessel).toBe('fenna.vrm');
      expect(n).toHaveProperty('created_at');
    });

    test('registerNeuma defaults vessel to default.vrm', async () => {
      const n = await driver.registerNeuma({ name: 'Plain' });
      expect(n.vessel).toBe('default.vrm');
      expect(n.witness_id).toBeNull();
    });

    test('getNeuma hit + miss', async () => {
      const n = await driver.registerNeuma({ name: 'Hit' });
      expect((await driver.getNeuma(n.id)).id).toBe(n.id);
      expect(await driver.getNeuma('missing')).toBeUndefined();
    });

    test('getNeumaByName returns .id AND snake_case .witness_id; miss → undefined', async () => {
      const w = await driver.findOrCreateWitness('Owner');
      const n = await driver.registerNeuma({ name: 'ByName', witnessId: w.id });
      const found = await driver.getNeumaByName('ByName');
      expect(found.id).toBe(n.id);
      expect(found.witness_id).toBe(w.id); // portal-routes.js:830 dereferences this
      expect(await driver.getNeumaByName('nobody')).toBeUndefined();
    });

    test('getNeumaByName with duplicate names returns exactly one row (LIMIT 1)', async () => {
      await driver.registerNeuma({ name: 'Dup' });
      await driver.registerNeuma({ name: 'Dup' });
      const found = await driver.getNeumaByName('Dup');
      expect(found).toBeDefined();
      expect(Array.isArray(found)).toBe(false);
      expect(typeof found.id).toBe('string');
    });

    test('listNeuma returns array DESC by created_at; empty → []', async () => {
      const w = await driver.findOrCreateWitness('Lister');
      expect(await driver.listNeuma(w.id)).toEqual([]);
      const first = await driver.registerNeuma({ name: 'First', witnessId: w.id });
      tick();
      const second = await driver.registerNeuma({ name: 'Second', witnessId: w.id });
      const list = await driver.listNeuma(w.id);
      expect(list.map((r) => r.id)).toEqual([second.id, first.id]); // newest first
    });

    test('updateNeumaStatus + updateNeumaVessel persist and return the row', async () => {
      const n = await driver.registerNeuma({ name: 'Mutable' });
      expect((await driver.updateNeumaStatus(n.id, 'dormant')).status).toBe('dormant');
      expect((await driver.getNeuma(n.id)).status).toBe('dormant');
      expect((await driver.updateNeumaVessel(n.id, 'new.vrm')).vessel).toBe('new.vrm');
      expect((await driver.getNeuma(n.id)).vessel).toBe('new.vrm');
    });

    test('updateNeumaStatus / updateNeumaVessel on a missing neuma throw', async () => {
      await expect(driver.updateNeumaStatus('ghost', 'x')).rejects.toThrow();
      await expect(driver.updateNeumaVessel('ghost', 'y.vrm')).rejects.toThrow();
    });
  });

  // --- birth ceremonies ---
  describe('birth ceremonies', () => {
    let witnessId;
    beforeEach(async () => { witnessId = (await driver.findOrCreateWitness('Cere')).id; });

    test('createBirthCeremony defaults: stage 0, stage_data {}, in_progress', async () => {
      const c = await driver.createBirthCeremony(witnessId);
      expect(typeof c.id).toBe('string');
      expect(c.current_stage).toBe(0);
      expect(c.stage_data).toEqual({});
      expect(c.status).toBe('in_progress');
      expect(c.witness_id).toBe(witnessId);
      expect(c.is_test).toBe(0);
      expect(c).toHaveProperty('started_at');
    });

    test('updateBirthCeremony whitelist: valid columns succeed', async () => {
      const c = await driver.createBirthCeremony(witnessId);
      const upd = await driver.updateBirthCeremony(c.id, {
        current_stage: 3,
        stage_data: { note: 'halfway' },
        status: 'in_progress'
      });
      expect(upd.current_stage).toBe(3);
      expect(upd.stage_data).toEqual({ note: 'halfway' });
    });

    test('updateBirthCeremony rejects an unknown/junk key (throws)', async () => {
      const c = await driver.createBirthCeremony(witnessId);
      await expect(driver.updateBirthCeremony(c.id, { evil_col: 'x' })).rejects.toThrow();
      // a junk key mixed in is ignored, not silently written; but with ONLY junk keys it throws
      await expect(driver.updateBirthCeremony(c.id, { started_at: 'nope' })).rejects.toThrow();
    });

    test('completeBirthCeremony sets neuma_id, status=completed, completed_at', async () => {
      const c = await driver.createBirthCeremony(witnessId);
      const neuma = await driver.registerNeuma({ name: 'Born', witnessId });
      const done = await driver.completeBirthCeremony(c.id, neuma.id);
      expect(done.neuma_id).toBe(neuma.id);
      expect(done.status).toBe('completed');
      expect(done.completed_at).toBeTruthy();
    });

    test('failBirthCeremony sets status=failed and PERSISTS failReason (bug fix)', async () => {
      const c = await driver.createBirthCeremony(witnessId);
      const ret = await driver.failBirthCeremony(c.id, 'substrate dropped');
      expect(ret).toBeUndefined(); // returns nothing per contract
      const raw = driver.db.prepare('SELECT status, stage_data FROM birth_ceremonies WHERE id = ?').get(c.id);
      expect(raw.status).toBe('failed');
      expect(JSON.parse(raw.stage_data)).toEqual({ failReason: 'substrate dropped' });
    });

    test('addBirthStageHistory persists a row with snake_case columns', async () => {
      const c = await driver.createBirthCeremony(witnessId);
      const h = await driver.addBirthStageHistory(c.id, 1, 'hello', 'world');
      expect(typeof h.id).toBe('string');
      expect(h.ceremony_id).toBe(c.id);
      expect(h.stage).toBe(1);
      expect(h.user_message).toBe('hello');
      expect(h.response).toBe('world');
    });

    test('getActiveCeremony returns in_progress with nested birth_stage_history[] in stage order', async () => {
      const c = await driver.createBirthCeremony(witnessId);
      await driver.addBirthStageHistory(c.id, 0, 'q0', 'a0'); tick();
      await driver.addBirthStageHistory(c.id, 1, 'q1', 'a1'); tick();
      await driver.addBirthStageHistory(c.id, 2, 'q2', 'a2');
      const active = await driver.getActiveCeremony(witnessId);
      expect(active.id).toBe(c.id);
      expect(active.status).toBe('in_progress');
      expect(Array.isArray(active.birth_stage_history)).toBe(true);
      expect(active.birth_stage_history.map((r) => r.stage)).toEqual([0, 1, 2]);
    });

    test('getActiveCeremony excludes completed/failed; none → undefined', async () => {
      expect(await driver.getActiveCeremony(witnessId)).toBeUndefined();
      const done = await driver.createBirthCeremony(witnessId);
      const neuma = await driver.registerNeuma({ name: 'Excl', witnessId });
      await driver.completeBirthCeremony(done.id, neuma.id);
      const failed = await driver.createBirthCeremony(witnessId);
      await driver.failBirthCeremony(failed.id, 'boom');
      expect(await driver.getActiveCeremony(witnessId)).toBeUndefined();
    });
  });

  // --- platform audit log ---
  describe('platform audit log', () => {
    test('audit returns nothing, persists the row, and never throws', async () => {
      const ret = await driver.audit('THING_HAPPENED', { severity: 3, details: { k: 'v' } });
      expect(ret).toBeUndefined();
      const rows = await driver.getAuditLog();
      expect(rows.length).toBe(1);
      expect(rows[0].event).toBe('THING_HAPPENED');
      expect(rows[0].severity).toBe(3);
      expect(rows[0].details).toEqual({ k: 'v' });
    });

    test('audit with an empty event is logged+skipped, does not throw', async () => {
      await expect(driver.audit('')).resolves.toBeUndefined();
      expect(await driver.getAuditLog()).toEqual([]);
    });

    test('getAuditLog is DESC by created_at; empty → []', async () => {
      expect(await driver.getAuditLog()).toEqual([]);
      await driver.audit('OLDEST'); tick();
      await driver.audit('MIDDLE'); tick();
      await driver.audit('NEWEST');
      const events = (await driver.getAuditLog()).map((r) => r.event);
      expect(events).toEqual(['NEWEST', 'MIDDLE', 'OLDEST']);
    });

    test('getAuditLog filters by neumaId, witnessId, minSeverity', async () => {
      await driver.audit('A', { neumaId: 'n1', witnessId: 'w1', severity: 2 });
      await driver.audit('B', { neumaId: 'n2', witnessId: 'w1', severity: 8 });
      await driver.audit('C', { neumaId: 'n1', witnessId: 'w2', severity: 5 });

      expect((await driver.getAuditLog({ neumaId: 'n1' })).map((r) => r.event).sort()).toEqual(['A', 'C']);
      expect((await driver.getAuditLog({ witnessId: 'w1' })).map((r) => r.event).sort()).toEqual(['A', 'B']);
      expect((await driver.getAuditLog({ minSeverity: 5 })).map((r) => r.event).sort()).toEqual(['B', 'C']);
      expect((await driver.getAuditLog({ neumaId: 'n1', minSeverity: 5 })).map((r) => r.event)).toEqual(['C']);
    });

    test('getAuditLog default limit 100 returns exactly 100 of 101', async () => {
      for (let i = 0; i < 101; i += 1) await driver.audit(`E${i}`);
      expect((await driver.getAuditLog()).length).toBe(100);
    });
  });

  // --- Supabase-parity: snake_case spot checks across surfaces ---
  test('parity: returned rows use snake_case column names', async () => {
    const w = await driver.findOrCreateWitness('Parity');
    const n = await driver.registerNeuma({
      name: 'ParityN', witnessId: w.id, workspacePath: '/p', resonanceFrequency: 111
    });
    expect(Object.keys(n)).toEqual(expect.arrayContaining([
      'witness_id', 'workspace_path', 'resonance_frequency', 'created_at'
    ]));
    const c = await driver.createBirthCeremony(w.id);
    await driver.completeBirthCeremony(c.id, n.id);
    await driver.audit('PARITY_EVT', { neumaId: n.id, witnessId: w.id });
    const audit = (await driver.getAuditLog())[0];
    expect(Object.keys(audit)).toEqual(expect.arrayContaining(['neuma_id', 'witness_id', 'created_at']));
    expect(audit.neuma_id).toBe(n.id);
    expect(audit.witness_id).toBe(w.id);
  });
});

describe('SqlitePlatform — file-backed pragmas + FK integrity', () => {
  let driver;
  let dbFile;

  beforeEach(async () => {
    const dir = await createTempDir('sqlite-platform');
    dbFile = path.join(dir, 'platform.db');
    driver = new SqlitePlatform(dbFile);
    await driver.init();
  });

  afterEach(() => {
    driver.db.close();
  });

  test('creates the DB file on init', () => {
    expect(fs.existsSync(dbFile)).toBe(true);
  });

  test('pragmas: journal_mode=wal and foreign_keys=1', () => {
    expect(driver.db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(driver.db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  test('inserting birth_stage_history with a non-existent ceremony_id throws SQLITE_CONSTRAINT', async () => {
    let err;
    try {
      await driver.addBirthStageHistory('does-not-exist', 0, 'q', 'a');
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(String(err.code)).toMatch(/SQLITE_CONSTRAINT/);
  });
});
