import process from 'node:process';
import console from 'node:console';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

setWorkspacesRoot(process.env.RATE_SLOT_ROOT);
let granted = 0;
for (let attempt = 0; attempt < Number(process.env.RATE_SLOT_ATTEMPTS || 10); attempt += 1) {
  if (await workspace.consumeSpendRateSlot('rate-limit-proof', { limit: 10, windowMs: 3_600_000 })) granted += 1;
}
console.log(JSON.stringify({ granted }));
