/**
 * Claim a workspace for a witness wallet on real disk.
 *
 * assertNeumaOwner (fail-closed) reads owner.json via neumaWorkspace.root —
 * not the legacy readOwner mock path. Integration tests that create a
 * workspace or mock a workspace with a real `root` must claim ownership
 * before route handlers will admit the witness.
 */
import fs from 'fs/promises';
import path from 'path';

/**
 * @param {string} workspacesRoot - absolute path matching neumaWorkspace.root
 * @param {string} neumaId
 * @param {string} wallet - witness wallet (checksum optional; gate is case-insensitive)
 * @returns {Promise<string>} path of the written owner.json
 */
export async function claimOwner(workspacesRoot, neumaId, wallet) {
  if (!workspacesRoot || typeof workspacesRoot !== 'string') {
    throw new Error('claimOwner requires a real workspacesRoot path');
  }
  if (!neumaId || !wallet) {
    throw new Error('claimOwner requires neumaId and wallet');
  }
  const dir = path.join(workspacesRoot, neumaId);
  await fs.mkdir(dir, { recursive: true });
  const ownerPath = path.join(dir, 'owner.json');
  await fs.writeFile(
    ownerPath,
    JSON.stringify({ wallet, claimedAt: new Date().toISOString() }, null, 2),
  );
  return ownerPath;
}
