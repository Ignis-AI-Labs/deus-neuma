/**
 * platform-db-kit.js — shared lifecycle for the platform-db security suites
 * (run-id platform-db-local-f234), extracted verbatim from the pre-split
 * test/unit/platform-db-security.test.js.
 *
 * RULE 0: every assertion runs against a REAL better-sqlite3 file (or the raw
 * connection the driver exposes as `driver.db`). No mocks, no stubs.
 *
 * Hostile inputs with control chars / null bytes are built with
 * String.fromCharCode(...) so the test harness never mangles them.
 *
 * Importing this kit registers an afterEach that closes every driver and raw
 * connection opened through it — a leaked handle keeps the WAL lock and
 * poisons the next test's file.
 */

import path from 'node:path';
import { afterEach } from 'vitest';

import { openDatabase } from '../../backend/services/drivers/sqlite-binding.js';
import { createTempDir } from './temp-fs.js';
import { SqlitePlatform } from '../../backend/services/drivers/sqlite-platform.js';

// --- shared lifecycle: real file DB per test, closed in afterEach ------------

const openDrivers = [];
const openConns = [];

// impure (creates a temp dir + opens a real DB file)
export async function makeDriver(label = 'platsec') {
  const dir = await createTempDir(label);
  const dbFile = path.join(dir, 'platform.db');
  const d = new SqlitePlatform(dbFile);
  await d.init();
  openDrivers.push(d);
  return { d, dbFile, dir };
}

// A second, independent connection to the same file. Opened through the
// binding layer rather than better-sqlite3 directly, so the suites keep
// testing the DRIVER's guarantees instead of failing on whichever ABI
// node_modules happens to hold right now (see drivers/sqlite-binding.js).
// impure
export function rawConn(dbFile) {
  const c = openDatabase(dbFile);
  openConns.push(c);
  return c;
}

afterEach(() => {
  while (openConns.length) {
    try { openConns.pop().close(); } catch { /* already closed */ }
  }
  while (openDrivers.length) {
    try { openDrivers.pop().db?.close(); } catch { /* already closed */ }
  }
});

// pure over the live connection — row count of a table
export const tableCount = (db, table) =>
  db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

// pure over the live connection — does the table exist?
export const tableExists = (db, table) =>
  Boolean(db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
  ).get(table));
