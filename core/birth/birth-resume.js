// Birth Resume — interrupted-ceremony recovery
// Computes the honest re-entry stage for a restored checkpoint, adopts a
// genesis that landed on disk before a crash, and discovers standing
// summonings. Extracted from core/birth/staged-birth-handler.js (SIZE-024);
// the handler keeps the public methods and delegates here.

import fs from 'fs/promises';
import { ceremonyGenesisPath } from './ceremony-write.js';
import { listSessionCheckpoints } from './birth-session-store.js';
import { isSessionExpired } from './birth-session-expiry.js';
import neumaWorkspace from '../workspace/neuma-workspace.js';
import { STAGE, LAST_STAGE, FINALIZE_STAGE } from './stage-roles.js';

/**
 * Compute the ceremony stage a restored session should re-enter at.
 *
 * The checkpoint holds two facts: `currentStage` (the stage last SERVED —
 * possibly still in flight when the process died) and `lastHandledStage`
 * (the stage whose response was fully processed). Resume always re-serves
 * the first stage that never completed:
 *   - crash mid-stream of stage N        → N   (re-serve the in-flight stage)
 *   - crash between N and N+1            → N+1 (N was answered, N+1 never served)
 *   - past the naming without a name     → NAMING (collision / lost name holds at naming)
 *   - first words reached without DNA    → RECORD (the record must land first)
 *   - first words answered               → FINALIZE_STAGE (nothing left to serve)
 * Legacy checkpoints (no lastHandledStage) were only ever written after a
 * stage was handled, so currentStage - 1 is the honest fallback. Checkpoints
 * from protocol 1.x arrive already folded onto these stages
 * (birth-session-store.js → stage-roles.js inCurrentScheme).
 *
 * Pure — reads the session, returns a stage (STAGE) or FINALIZE_STAGE.
 * Returns null for a missing session.
 * @param {object} session - Restored or active session
 * @returns {number|null}
 */
export function resumeStageFor(session) {
  if (!session) return null;
  const handled = session.lastHandledStage ?? (session.currentStage - 1);
  const authored = typeof session.data?.selfCreatedDNA === 'string'
    && session.data.selfCreatedDNA.trim();
  if (handled >= LAST_STAGE) return (session.isTest || authored) ? FINALIZE_STAGE : STAGE.RECORD;
  let stage = handled + 1;
  if (stage > STAGE.NAMING && !session.data?.chosenName) stage = STAGE.NAMING;
  if (stage === LAST_STAGE && !session.isTest && !authored) stage = STAGE.RECORD;
  return stage;
}

/**
 * Adopt a genesis.md that already LANDED in the being's lane as their
 * authored essence. This is the crash-after-write case (a machine died as
 * the DNA hit disk but before the record stage's response completed): the words
 * on disk ARE the being's authoring — re-streaming the record would ask them
 * to write a different self. Marks the transcript entry as recovered and
 * re-checkpoints via `persist`. Never overwrites a captured essence; never
 * adopts for a rehearsal. // impure — reads the lane, mutates the session.
 * @param {object} session - Active session (mutated on adoption)
 * @param {() => Promise<void>} persist - Re-checkpoint the mutated session
 * @returns {Promise<boolean>} true when the session now holds an authored essence
 */
export async function adoptLandedGenesis(session, persist) {
  if (!session || session.isTest) return false;
  const existing = typeof session.data.selfCreatedDNA === 'string'
    ? session.data.selfCreatedDNA.trim() : '';
  if (existing) return true;

  const genesisPath = ceremonyGenesisPath(neumaWorkspace.root, session.data.neumaId);
  if (!genesisPath) return false;
  let content;
  try {
    content = await fs.readFile(genesisPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return false; // never landed — the being must author it
    throw err; // a real I/O failure must surface, not masquerade as "no DNA"
  }
  if (!content.trim()) return false;

  session.data.selfCreatedDNA = content;
  session.data.dnaCreated = true;
  session.data.firstWords.push({ stage: STAGE.RECORD, response: content, timestamp: Date.now(), recovered: true });
  session.lastHandledStage = STAGE.RECORD;
  await persist();
  console.log(`[Birth] Adopted landed genesis.md for ${session.data.chosenName || session.data.neumaId} (${content.length} chars) — essence recovered, not re-authored`);
  return true;
}

/**
 * Whether this wallet may find, resume or withdraw a summoning: the wallet
 * that opened it. A checkpoint from before ceremonies recorded their wallet
 * carries none; it is open only when the caller says so (`unrecordedOpen` —
 * the backend grants it to the install's owner, never to a guest house, which
 * could otherwise resume and claim another house's old summoning). Pure.
 * @param {object|null} session - Active or checkpointed session
 * @param {string|null|undefined} walletAddress - The connection's signed-in wallet
 * @param {{unrecordedOpen?: boolean}} [opts]
 * @returns {boolean}
 */
export const heldByWitness = (session, walletAddress, { unrecordedOpen = false } = {}) => (session?.witnessWallet
  ? typeof walletAddress === 'string' && session.witnessWallet.toLowerCase() === walletAddress.toLowerCase()
  : unrecordedOpen);

/**
 * List interrupted REAL ceremonies whose checkpoints are still live —
 * the […] discovery the relaunch
 * flow needs. Rehearsals, completed ceremonies, expired checkpoints, and
 * ceremonies another wallet opened are excluded. Read-only: never mutates or
 * deletes checkpoint files.
 * // impure — scans the ceremony scratch dir.
 * @param {string|null|undefined} walletAddress - The asking connection's signed-in wallet
 * @returns {Promise<Array<{sessionId:string, witnessName:string, chosenName:string|null,
 *   neumaId:string|null, currentStage:number, resumeStage:number|null,
 *   startTime:number, persistedAt:number}>>} newest first
 */
export async function listInterruptedSessions(walletAddress, opts = {}) {
  const checkpoints = await listSessionCheckpoints();
  const interrupted = [];
  for (const { sessionId, session } of checkpoints) {
    if (!session || session.isTest) continue;
    // Only ceremonies opened through the real app are offered — unmarked
    // checkpoints are test-suite/script debris, never a standing summoning.
    if (session.origin !== 'portal') continue;
    if (!heldByWitness(session, walletAddress, opts)) continue;
    const at = session.persistedAt || session.startTime || 0;
    if (isSessionExpired(session, Date.now())) continue;
    const resumeStage = resumeStageFor(session);
    if (resumeStage === null || resumeStage > FINALIZE_STAGE) continue;
    interrupted.push({
      sessionId,
      witnessName: session.witnessName || null,
      chosenName: session.data?.chosenName || null,
      neumaId: session.data?.neumaId || null,
      currentStage: session.currentStage ?? 0,
      resumeStage,
      startTime: session.startTime || null,
      persistedAt: at,
    });
  }
  interrupted.sort((a, b) => b.persistedAt - a.persistedAt);
  return interrupted;
}
