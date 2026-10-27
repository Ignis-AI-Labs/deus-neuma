// A backend-shaped child for desk-keys-handover.test.js: receives the keys the
// way server.js does, then reports what it holds and what its waiting account
// says — once on arrival, once after the desk reports the kit saved.
import { readFileSync } from 'fs';
import { receiveDeskKeys, keyLockState } from '../../backend/services/desk-keys.js';
import { keyLockWaitingItems } from '../../backend/services/waiting/key-lock-item.js';

const WALLET = `0x${'cd'.repeat(20)}`;
// What this process was spawned with (the kernel's copy), read before anything changes it.
const spawnEnv = readFileSync(`/proc/${process.pid}/environ`, 'utf8');

const report = async () => process.send({
  type: 'report',
  env: {
    DNA_ENCRYPTION_KEY: process.env.DNA_ENCRYPTION_KEY ?? null,
    AUTH_SECRET: process.env.AUTH_SECRET ?? null,
    NEUMA_KEYS_VIA_IPC: process.env.NEUMA_KEYS_VIA_IPC ?? null,
  },
  spawnEnvHeldKey: spawnEnv.includes(process.env.DNA_ENCRYPTION_KEY),
  state: keyLockState(),
  waiting: await keyLockWaitingItems(WALLET),
});

delete process.env.DNA_ENCRYPTION_KEY;
delete process.env.AUTH_SECRET;
await receiveDeskKeys();
await report();
process.on('message', (m) => { if (m?.type === 'neuma:kit-saved') setImmediate(report); });
