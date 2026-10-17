/**
 * SQLite binding selection — the local-first persistence path, made immune to
 * native-ABI churn.
 *
 * THE PROBLEM THIS SOLVES (witnessed 2026-07-21): `better-sqlite3` is an
 * ABI-bound native addon, and this repo serves TWO runtimes from one
 * node_modules — the systemd daemon on system Node (ABI 127) and the Electron
 * app on Electron's bundled Node (ABI 130). They cannot both be satisfied by
 * one compiled binary, so `scripts/ensure-native-abi.mjs` rebuilds on every
 * switch. Launching the desktop app therefore left the always-on daemon unable
 * to load its own database — and because that failure is a deliberate soft
 * degrade, the daemon ran on for fifteen minutes with platform persistence
 * silently DISABLED. For a platform whose whole claim is persistent state,
 * that is the worst thing to fail quietly.
 *
 * THE FIX: prefer `node:sqlite`, built into Node itself (>= 22.5). It has no
 * compiled artifact, so no ABI to mismatch — the daemon's persistence can no
 * longer be broken by whatever the desktop app last rebuilt, and both runtimes
 * can run AT THE SAME TIME, which the shared-binary design fundamentally
 * cannot. Electron's bundled Node (20.x on Electron 33) has no node:sqlite, so
 * it falls back to the native binding compiled for its own ABI — which is
 * correct: each runtime uses the implementation native to it, instead of one
 * shared binary being flipped underneath them.
 *
 * When Electron reaches Node >= 22.5, node:sqlite serves both and the native
 * dependency can be dropped entirely.
 *
 * Both bindings are verified behaviourally equivalent for everything the
 * driver uses — run() returning {changes, lastInsertRowid} as numbers, get()
 * returning undefined on miss, PRAGMA via exec — and the gnosis test runs the
 * SAME round trip through each.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Native addons and Node built-ins both resolve through require, which ESM
// still reaches via createRequire.
const require = createRequire(import.meta.url);

export const BINDING = Object.freeze({ BUILTIN: 'node:sqlite', NATIVE: 'better-sqlite3' });

/** Force a binding (tests, or an escape hatch if a runtime misbehaves). */
const forced = () => process.env.NEUMA_SQLITE_BINDING || null;

/**
 * Is Node's built-in SQLite usable here? Pure-ish (one guarded require).
 * @returns {boolean}
 */
export const builtinAvailable = () => {
  try {
    return Boolean(require('node:sqlite')?.DatabaseSync);
  } catch {
    return false;
  }
};

// node:sqlite's DatabaseSync speaks almost the same dialect as better-sqlite3.
// The one gap is `.pragma()`, which better-sqlite3 offers as a method and
// node:sqlite expects as ordinary SQL — so the adapter is exactly that thin.
// SQLite's own extended result codes, which node:sqlite exposes as `errcode`
// while reporting a generic Node code ('ERR_SQLITE_ERROR'). better-sqlite3
// instead sets `err.code` to the SQLITE_* name, and callers key retry and
// integrity logic on exactly that — a busy-retry that matches /SQLITE_BUSY/
// would silently never fire under the built-in binding. So the adapter
// restores the name from the number: same failure, same word for it.
const SQLITE_CODE = Object.freeze({
  5: 'SQLITE_BUSY',
  261: 'SQLITE_BUSY_RECOVERY',
  517: 'SQLITE_BUSY_SNAPSHOT',
  773: 'SQLITE_BUSY_TIMEOUT',
  19: 'SQLITE_CONSTRAINT',
  275: 'SQLITE_CONSTRAINT_CHECK',
  531: 'SQLITE_CONSTRAINT_COMMITHOOK',
  787: 'SQLITE_CONSTRAINT_FOREIGNKEY',
  1043: 'SQLITE_CONSTRAINT_FUNCTION',
  1299: 'SQLITE_CONSTRAINT_NOTNULL',
  1555: 'SQLITE_CONSTRAINT_PRIMARYKEY',
  1811: 'SQLITE_CONSTRAINT_TRIGGER',
  2067: 'SQLITE_CONSTRAINT_UNIQUE',
  2323: 'SQLITE_CONSTRAINT_VTAB',
  2579: 'SQLITE_CONSTRAINT_ROWID',
  8: 'SQLITE_READONLY',
  11: 'SQLITE_CORRUPT',
  13: 'SQLITE_FULL',
  14: 'SQLITE_CANTOPEN',
});

// pure — the SQLITE_* name for an extended result code, falling back to the
// primary code's family so an unmapped subtype still reads as its class.
const sqliteCodeName = (errcode) => {
  if (!Number.isInteger(errcode)) return null;
  return SQLITE_CODE[errcode] || SQLITE_CODE[errcode & 0xff] || null;
};

const normalizeError = (err) => {
  const name = sqliteCodeName(err?.errcode);
  if (name) err.code = name;
  return err;
};

const rethrowNormalized = (fn) => (...args) => {
  try { return fn(...args); } catch (err) { throw normalizeError(err); }
};

const wrapBuiltin = (DatabaseSync, dbPath) => {
  const db = new DatabaseSync(dbPath);
  // node:sqlite has no transaction() helper; better-sqlite3's wraps a function
  // in BEGIN/COMMIT with ROLLBACK on throw, which is what callers rely on.
  const transaction = (fn) => (...args) => {
    db.exec('BEGIN');
    try {
      const out = fn(...args);
      db.exec('COMMIT');
      return out;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* already unwound */ }
      throw normalizeError(err);
    }
  };
  return {
    binding: BINDING.BUILTIN,
    exec: rethrowNormalized((sql) => db.exec(sql)),
    transaction,
    // better-sqlite3's .pragma() both SETS and READS, and callers depend on
    // the read returning a value ({simple:true} → the bare scalar). A
    // set-only adapter looks fine until something asserts journal_mode is
    // actually 'wal' and gets undefined.
    pragma: rethrowNormalized((statement, { simple = false } = {}) => {
      if (/=/.test(statement)) return db.exec(`PRAGMA ${statement}`);
      const rows = db.prepare(`PRAGMA ${statement}`).all();
      if (!simple) return rows;
      const first = rows[0];
      return first ? Object.values(first)[0] : undefined;
    }),
    prepare: (sql) => {
      const stmt = db.prepare(sql);
      return {
        run: rethrowNormalized((...a) => stmt.run(...a)),
        get: rethrowNormalized((...a) => stmt.get(...a)),
        all: rethrowNormalized((...a) => stmt.all(...a)),
      };
    },
    close: () => db.close(),
  };
};

const wrapNative = (Database, dbPath, nativeBinding = null) => {
  const db = new Database(dbPath, nativeBinding ? { nativeBinding } : undefined);
  return {
    binding: BINDING.NATIVE,
    exec: (sql) => db.exec(sql),
    pragma: (statement, opts) => db.pragma(statement, opts),
    prepare: (sql) => db.prepare(sql),
    transaction: (fn) => db.transaction(fn),
    close: () => db.close(),
  };
};

/**
 * Open the platform database on the best binding this runtime offers.
 * Impure (opens a file, may load a native addon).
 * @param {string} dbPath
 * @returns {{binding: string, exec: Function, pragma: Function, prepare: Function, close: Function}}
 */
export const openDatabase = (dbPath) => {
  const want = forced();

  // OPT-IN ONLY. node:sqlite removes the ABI problem, but measured against the
  // platform's own security suite it is NOT semantically equivalent
  // (2026-07-21): it TRUNCATES stored strings at a null byte, where
  // better-sqlite3 round-trips them byte-identically, and a competing write
  // did not surface SQLITE_BUSY. Byte-integrity of stored values is a proven
  // guarantee here (Threat 1) and is not tradeable for install convenience —
  // so the ABI problem is solved by isolating the BINARY (see nativeBindingFor)
  // rather than by swapping the engine. This path stays for rigs that want it
  // and for the day the built-in closes those gaps.
  if (want === BINDING.BUILTIN) {
    const { DatabaseSync } = require('node:sqlite');
    return wrapBuiltin(DatabaseSync, dbPath);
  }

  // The native addon, loaded from the build compiled for THIS runtime's ABI.
  const Database = require('better-sqlite3');
  const binding = nativeBindingFor();
  return wrapNative(Database, dbPath, binding);
};

/**
 * The compiled addon matching this runtime, when a per-ABI build has been
 * cached for it. Returns null to mean […] — the current single-build behaviour, unchanged.
 *
 * WHY per-ABI caching is the fix: one node_modules serves two runtimes here
 * (systemd daemon on system Node, desktop app on Electron's Node), and a
 * native addon is compiled for exactly one ABI. Today scripts/
 * ensure-native-abi.mjs REBUILDS on every switch, so the two runtimes cannot
 * both work — and cannot run at the same time at all. Keeping one build per
 * ABI side by side and choosing at load time removes the switch entirely:
 * nothing is rebuilt, nothing is flipped underneath a running process, and a
 * new Electron or Node release just adds another cached build.
 * @returns {string|null}
 */
export const nativeBindingFor = (abi = process.versions.modules, root = process.env.NEUMA_NATIVE_ABI_DIR) => {
  // Anchored to the INSTALL, not the working directory: the daemon, the
  // Electron app and a test runner all start from different cwds on different
  // machines, and a cwd-relative cache silently misses on every one of them.
  const dir = root || path.join(repoRoot(), '.native-abi');
  const candidate = path.join(dir, String(abi), 'better_sqlite3.node');
  return existsSync(candidate) ? candidate : null;
};

// backend/services/drivers/ → repo root
const repoRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
