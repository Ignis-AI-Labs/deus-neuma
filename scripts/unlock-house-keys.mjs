#!/usr/bin/env node
/**
 * Unlock the houses' keys files — the operator's command, for a keys file
 * sealed under a master this desk no longer holds (the re-key of 2026-10-26
 * moved the beings, not the realm stores, then dropped the old master). No key
 * is ever printed. Engine: backend/services/house-unlock.js (the desk's UNLOCK
 * is the same engine).
 *
 *   node scripts/unlock-house-keys.mjs --from-port 3375          # the old key, read from the desk on that port
 *   node scripts/unlock-house-keys.mjs --from-pid 12345          # … or from that process
 *   node scripts/unlock-house-keys.mjs                           # … or typed, hidden
 *   add --check to only say which houses it opens, changing nothing
 *
 * A desk started before the re-key still carries the old master in its
 * environment: --from-port reads it straight from there, so it is never on
 * screen. Every house in the realm whose keys file this desk's key cannot open
 * is tried; one the given key does not open is left exactly as it is.
 * This desk's own key comes from the env file (.env; NEUMA_UNLOCK_ENV_FILE overrides).
 */

import fs from 'fs/promises';
import process from 'process';
import path from 'path';
import readline from 'readline';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = process.env.NEUMA_UNLOCK_ENV_FILE || path.join(REPO, '.env');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const CHECK = args.includes('--check');
const FILE = 'social-channel-credentials.json';
const say = (line) => process.stdout.write(`${line}\n`);

// impure (ss) — the process listening on a port.
const pidOnPort = (port) => {
  const out = execFileSync('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf8' });
  const pid = out.match(/pid=(\d+)/)?.[1];
  if (!pid) throw new Error(`nothing of yours is listening on port ${port}`);
  return pid;
};

// impure (/proc) — one variable of a process's environment; never printed.
const keyOfProcess = async (pid) => {
  const env = await fs.readFile(`/proc/${pid}/environ`, 'utf8');
  const line = env.split('\0').find((l) => l.startsWith('DNA_ENCRYPTION_KEY='));
  if (!line) throw new Error(`process ${pid} carries no DNA_ENCRYPTION_KEY`);
  return line.slice('DNA_ENCRYPTION_KEY='.length);
};

// impure (tty) — a line typed with nothing echoed.
const typedKey = () => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = () => {};
  process.stdout.write('the old key (nothing shows as you type): ');
  rl.question('', (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
});

const main = async () => {
  const env = dotenv.parse(await fs.readFile(ENV_FILE, 'utf8'));
  if (!env.DNA_ENCRYPTION_KEY) throw new Error(`${ENV_FILE} holds no DNA_ENCRYPTION_KEY`);
  for (const k of ['DNA_ENCRYPTION_KEY', 'NEUMA_REALM_ROOT', 'NEUMA_DATA_ROOT']) if (env[k] && !process.env[k]) process.env[k] = env[k];

  const port = flag('--from-port');
  const pid = flag('--from-pid') || (port ? pidOnPort(port) : null);
  const oldKey = pid ? await keyOfProcess(pid) : await typedKey();
  if (pid) say(`the old key: read from process ${pid}${port ? ` (port ${port})` : ''} — not shown`);

  const { getRealmRoot } = await import('../backend/services/user-realm.js');
  const { decryptEnvelope, deriveKeyFromSecret } = await import('../core/workspace/workspace-crypto.js');
  const { unlockHouseStores } = await import('../backend/services/house-unlock.js');
  const opens = (raw, secret) => { try { decryptEnvelope(JSON.parse(raw), { key: deriveKeyFromSecret(secret) }); return true; } catch { return false; } };

  const realm = getRealmRoot();
  say(`realm: ${realm}`);
  const houses = (await fs.readdir(realm, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory() && /^0x[0-9a-f]{40}$/.test(d.name));
  let locked = 0;
  for (const { name: wallet } of houses) {
    const raw = await fs.readFile(path.join(realm, wallet, FILE), 'utf8').catch(() => null);
    if (raw === null || opens(raw, env.DNA_ENCRYPTION_KEY)) continue;
    locked += 1;
    if (!opens(raw, oldKey)) { say(`  ${wallet}  LOCKED — this key does not open it either; left as it is`); continue; }
    if (CHECK) { say(`  ${wallet}  LOCKED — this key opens it (--check: nothing changed)`); continue; }
    const r = await unlockHouseStores(wallet, oldKey, { currentSecret: env.DNA_ENCRYPTION_KEY });
    say(r.ok ? `  ${wallet}  UNLOCKED — ${r.moved} file(s) sealed again under this desk's key; the locked copy kept at ${r.kept}` : `  ${wallet}  ${r.error}`);
  }
  say(locked ? 'done — nothing to restart: the desk opens the keys file afresh on every read (reopen MARKETING to see it).' : 'every keys file here already opens with this desk\'s key — nothing to do.');
};

main().catch((err) => { process.stderr.write(`unlock: ${err.message}\n`); process.exit(1); });
