/**
 * Stopping the substrate a SIBLING Neuma process spawned (size-law extraction
 * from llama-server-supervisor.js, 2026-09-12 — the supervisor needed room for
 * the owner-bound stop contract). This module COMMANDS by claim; it holds no
 * process state of its own, which is exactly why it can leave.
 */
import { createLogger } from './logger.js';
import {
  clearClaim, pidAlive, writeStopIntent,
} from './substrate-claim-registry.js';
import { expireServedTruth } from './served-model-truth.js';

const log = createLogger('LlamaSupervisor');

const STOP_GRACE_MS = 8000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// impure — stop a server another NEUMA process spawned (the claim names the SERVER's pid), SIGTERM then SIGKILL.
export const stopClaimed = async (claim) => {
  const owner = claim.pid; // the claim names the SERVER itself
  if (!pidAlive(owner)) { clearClaim(); expireServedTruth(); return { status: 'not-running' }; }
  try {
    writeStopIntent(); // tell the spawner's exit handler this is NEUMA's own act
    process.kill(owner, 'SIGTERM');
    const deadline = Date.now() + STOP_GRACE_MS;
    while (Date.now() < deadline) {
      if (!pidAlive(owner)) break;
      await delay(200);
    }
    if (pidAlive(owner)) process.kill(owner, 'SIGKILL');
  } catch (err) {
    log.warn('could not stop the claimed substrate', { err: err.message });
    expireServedTruth();
    return { status: 'not-running' };
  }
  clearClaim();
  expireServedTruth();
  log.info('llama-server stopped (claimed by another NEUMA process)', { pid: owner });
  return { status: 'stopped' };
};
