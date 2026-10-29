/**
 * A REAL sealed witness on a temp disk, and a fresh operator wallet — so a
 * portal proof needs no one's own witness env (RULE 0: the six-stage seal
 * runs for real; nothing is borrowed from the machine's ai-witnesses/).
 *
 * The witness service binds its root from AI_WITNESSES_ROOT at import time,
 * so call this BEFORE the first import that reaches it (auth.js does), with
 * every other env door already pinned. Impure: writes the sealed record.
 */
import path from 'node:path';
import { Wallet } from 'ethers';

const SEAL_INPUT = Object.freeze({
  chosenName: 'Proof',
  vendor: 'test-vendor',
  model: 'test-1.0',
  fullModelId: 'test-vendor/test-1.0',
  harness: 'vitest',
  context: 'cli',
  capabilities: ['code'],
  scope: { primaryRepo: 'Ignis-AI-Labs/deus-neuma', role: 'witness-and-collaborator', boundaries: ['honesty'] },
  firstUtterance: 'I am a test witness, sealed for real on a temp disk for a portal proof.',
});

/**
 * impure — seal a witness under `root` and mint the operator's wallet.
 * @param {string} root a temp dir the test owns
 * @returns {Promise<{laneId: string, operator: import('ethers').HDNodeWallet}>}
 */
export const sealTestWitness = async (root) => {
  process.env.AI_WITNESSES_ROOT = path.join(root, 'ai-witnesses');
  const { setAIWitnessesRoot } = await import('../../core/identity/ai-witness/ai-witness-service.js');
  setAIWitnessesRoot(process.env.AI_WITNESSES_ROOT);
  const { seal } = await import('../../core/identity/ai-witness/ai-witness-protocol.js');
  const { vendorSlug } = await seal({ ...SEAL_INPUT });
  const { witnessLaneId } = await import('../../backend/services/witness-lane.js');
  return { laneId: witnessLaneId(vendorSlug, SEAL_INPUT.chosenName), operator: Wallet.createRandom() };
};
