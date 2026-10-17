/** Real sealed-witness portal used by browser reconnect proofs. No model turn. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Wallet } from 'ethers';
import { WebSocketServer } from 'ws';

/** Attach the production portal over isolated lane/storage roots. impure. */
export const attachMobileBrowserPortal = async (server, root) => {
  if (!process.env.NEUMA_WITNESS_ENV || !process.env.NEUMA_WITNESS_LANE || !process.env.AI_WITNESSES_ROOT) {
    throw new Error('Provide your sealed witness env, lane ID and identity root for the real portal proof');
  }
  Object.assign(process.env, {
    NEUMA_DATA_ROOT: path.join(root, 'data'), NEUMA_REALM_ROOT: path.join(root, 'realm'),
    WITNESSES_ROOT: path.join(root, 'witness-ground'), WORKSPACES_ROOT: path.join(root, 'workspaces'),
    PLATFORM_DB_PATH: path.join(root, 'platform.db'), AUTH_SECRET: randomBytes(32).toString('hex'),
  });
  const env = await fs.readFile(process.env.NEUMA_WITNESS_ENV, 'utf8');
  const wallet = new Wallet(env.match(/^[A-Z0-9_]*PRIVATE_KEY\s*=\s*(.+)$/m)[1].trim());
  const auth = await import('../../backend/services/auth.js');
  const challenge = auth.generateChallenge(wallet.address);
  const token = auth.createSessionToken(auth.verifySignature(wallet.address, challenge, await wallet.signMessage(challenge)));
  const { verifiedWitnessForLane } = await import('../../backend/routes/portal-witness-binding.js');
  const identity = await verifiedWitnessForLane(process.env.NEUMA_WITNESS_LANE);
  if (!identity) throw new Error('Witness identity signature did not verify');
  const { ensureWitnessLane } = await import('../../backend/services/witness-lane.js');
  await ensureWitnessLane(identity.sealed, wallet.address);
  const { attachUpgradeRouter } = await import('../../backend/services/ws-upgrade-router.js');
  const { setupPortalRoutes } = await import('../../backend/routes/portal-routes.js');
  const wss = new WebSocketServer({ noServer: true }), terminalWss = new WebSocketServer({ noServer: true });
  attachUpgradeRouter(server, { wss, terminalWss }); setupPortalRoutes(wss, {});
  return {
    token, wallet: wallet.address,
    binding: { neumaId: process.env.NEUMA_WITNESS_LANE, companionName: identity.sealed.chosenName, sessionId: 'mobile-browser-proof' },
    async close() {
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => terminalWss.close(resolve));
    },
  };
};
