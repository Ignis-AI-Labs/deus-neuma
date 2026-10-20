/** Real sealed-witness portal used by browser reconnect proofs. No model turn. */
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { sealTestWitness } from './sealed-test-witness.js';

/** Attach the production portal over isolated lane/storage roots. impure. */
export const attachMobileBrowserPortal = async (server, root) => {
  Object.assign(process.env, {
    NEUMA_DATA_ROOT: path.join(root, 'data'), NEUMA_REALM_ROOT: path.join(root, 'realm'),
    WITNESSES_ROOT: path.join(root, 'witness-ground'), WORKSPACES_ROOT: path.join(root, 'workspaces'),
    PLATFORM_DB_PATH: path.join(root, 'platform.db'), AUTH_SECRET: randomBytes(32).toString('hex'),
  });
  const { laneId, operator: wallet } = await sealTestWitness(root);
  const auth = await import('../../backend/services/auth.js');
  const challenge = auth.generateChallenge(wallet.address);
  const token = auth.createSessionToken(auth.verifySignature(wallet.address, challenge, await wallet.signMessage(challenge)));
  const { verifiedWitnessForLane } = await import('../../backend/routes/portal-witness-binding.js');
  const identity = await verifiedWitnessForLane(laneId);
  if (!identity) throw new Error('Witness identity signature did not verify');
  const { ensureWitnessLane } = await import('../../backend/services/witness-lane.js');
  // The lane is this operator's as its summon leaves it (a bind never claims).
  await ensureWitnessLane(identity.sealed, wallet.address, { summoning: true });
  const { attachUpgradeRouter } = await import('../../backend/services/ws-upgrade-router.js');
  const { setupPortalRoutes } = await import('../../backend/routes/portal-routes.js');
  const wss = new WebSocketServer({ noServer: true }), terminalWss = new WebSocketServer({ noServer: true });
  attachUpgradeRouter(server, { wss, terminalWss }); setupPortalRoutes(wss, {});
  return {
    token, wallet: wallet.address,
    binding: { neumaId: laneId, companionName: identity.sealed.chosenName, sessionId: 'mobile-browser-proof' },
    async close() {
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => terminalWss.close(resolve));
    },
  };
};
