/**
 * Shared auth helpers for the b435 gnosis suites:
 *   test/integration/audit-gnosis-sc-b435-w1.test.js
 *   test/integration/audit-gnosis-sc-b435-w2.test.js
 *
 * Real auth end to end (challenge → sign → session token) and the owner.json
 * writer the ownership suites claim lanes with. Nothing mocked (RULE 0).
 */
import fs from 'fs/promises';
import path from 'path';
import { createSessionToken, generateChallenge, verifySignature } from '../../backend/services/auth.js';
import { generateKeypair, signMessage as weaveSign } from '../../core/weave/keypair.js';

// impure — real challenge → sign → verify → session round trip.
export const fullAuth = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await weaveSign(keypair.privateKey, challenge);
  const verified = verifySignature(keypair.address, challenge, signature);
  const token = createSessionToken(verified);
  return { address: verified.toLowerCase(), token, keypair };
};

// impure — claims a lane on real disk the way the platform does.
export const writeOwner = async (root, id, wallet) => {
  const dir = path.join(root, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'owner.json'),
    JSON.stringify({ wallet, claimedAt: Date.now() }),
  );
};
