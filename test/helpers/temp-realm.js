// THE OPERATOR'S REALM IS NEVER A TEST'S TO WRITE. A suite that drives the
// bench plane to a settled set makes it notify its operator (bench-matched.js
// BENCHMARK DONE) — and with the default realm that card landed in the
// machine's real ~/.kenorie/realm under a throwaway wallet (2026-10-15).
// One call per suite: a temp realm for the whole file. Never restored — a
// chain a test left running settles AFTER the suite's hooks, and its card must
// still land here (each test file has its own process env and modules; the OS clears tmp).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setRealmRoot } from '../../backend/services/user-realm.js';

export const useTempRealm = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-test-realm-'));
  // the env door covers module graphs the suite re-imports (vi.resetModules)
  process.env.NEUMA_REALM_ROOT = dir;
  setRealmRoot(dir);
};
