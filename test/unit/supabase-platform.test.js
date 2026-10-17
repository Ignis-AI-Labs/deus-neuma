/**
 * Platform default-persistence contract (formerly "SupabasePlatform").
 *
 * HISTORY: this file used to mock @supabase/supabase-js and assert the OLD
 * file-only behavior — with no Supabase credentials the platform was
 * `available=false` and every method returned `null`/`[]`. The local-first
 * SQLite driver (run platform-db-local-f234) OVERTURNS that contract: with no
 * Supabase creds the platform now persists via embedded SQLite. The obsolete
 * mock-based cases are deleted; the driver + facade internals are covered in
 * depth by `sqlite-platform.test.js` and `platform-db.test.js`.
 *
 * RULE 0: real SQLite via :memory:, no mocks. Asserts only the load-bearing
 * new contract: no creds → real persistence, real rows (never null).
 */

const NO_CREDS = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
let savedEnv;

beforeEach(() => {
  savedEnv = {};
  for (const k of [...NO_CREDS, 'PLATFORM_DB_PATH']) savedEnv[k] = process.env[k];
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PLATFORM_DB_PATH = ':memory:';
  vi.resetModules();
});

afterEach(() => {
  for (const k of [...NO_CREDS, 'PLATFORM_DB_PATH']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function initPlatform() {
  const platform = (await import('../../backend/services/platform-db.js')).default;
  await platform.init();
  return platform;
}

describe('platform default persistence (no Supabase credentials)', () => {
  test('platform is available and backed by the SQLite driver', async () => {
    const platform = await initPlatform();
    expect(platform.available).toBe(true);
    expect(platform.driver.constructor.name).toBe('SqlitePlatform');
    platform.driver.db.close();
  });

  test('findOrCreateWitness persists a real row (not null)', async () => {
    const platform = await initPlatform();
    const witness = await platform.findOrCreateWitness('Alice');
    expect(witness).not.toBeNull();
    expect(witness.id).toBeTruthy();
    expect(witness.name).toBe('Alice');
    // persisted — a second lookup returns the same identity
    expect((await platform.getWitness(witness.id)).id).toBe(witness.id);
    platform.driver.db.close();
  });

  test('registerNeuma / getNeumaByName round-trip real rows without creds', async () => {
    const platform = await initPlatform();
    const witness = await platform.findOrCreateWitness('Owner');
    const neuma = await platform.registerNeuma({ name: 'Nyx', witnessId: witness.id });
    expect(neuma).not.toBeNull();
    expect((await platform.getNeumaByName('Nyx')).witness_id).toBe(witness.id);
    platform.driver.db.close();
  });

  test('listNeuma returns [] (not null) when a witness has no neuma', async () => {
    const platform = await initPlatform();
    const witness = await platform.findOrCreateWitness('Empty');
    expect(await platform.listNeuma(witness.id)).toEqual([]);
    platform.driver.db.close();
  });

  test('audit persists and getAuditLog reads it back (append-only surface works)', async () => {
    const platform = await initPlatform();
    const witness = await platform.findOrCreateWitness('Auditor');
    await platform.audit('BOOTED', { witnessId: witness.id, severity: 2 });
    const log = await platform.getAuditLog({ witnessId: witness.id });
    expect(log.length).toBe(1);
    expect(log[0].event).toBe('BOOTED');
    platform.driver.db.close();
  });
});
