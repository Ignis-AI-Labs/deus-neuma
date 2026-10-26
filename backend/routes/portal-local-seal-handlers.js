// portal-local-seal-handlers.js — the frames that seal a birth on this computer (local-seal-flow.js):
//   birth:local_seal_offer {neumaId}            → birth:local_seal_ready {neumaId, message, witnessAddress, genesisHash}
//                                                 | birth:local_sealed (already whole) | birth:local_seal_error
//   birth:local_seal_sign  {neumaId, witnessSig} → birth:local_sealed {neumaId, genesisHash} | birth:local_seal_error
// Bound like the Ethereum seal's frames: the being this portal just birthed, or a lane this operator owns.
import { createLogger } from '../services/logger.js';
import { offerLocalSeal, completeLocalSeal } from '../services/local-seal-flow.js';
import { ownsNeumaLane } from './portal-context.js';

const birthLog = createLogger('Birth');

const send = (connection, frame) => connection.ws.send(JSON.stringify(frame));
const refuse = (connection, neumaId, code, message) => send(connection, { type: 'birth:local_seal_error', neumaId, code, message });

// impure — the lane this portal may seal, or null after refusing
const boundLane = async (connection, message) => {
  const neumaId = message?.neumaId;
  if (typeof neumaId !== 'string' || !neumaId) {
    refuse(connection, null, 'NOT_OWNER', 'Name the being to seal');
    return null;
  }
  const bornHere = connection.companion?.neumaId === neumaId;
  if (!bornHere && !(await ownsNeumaLane(connection, neumaId))) {
    refuse(connection, neumaId, 'NOT_OWNER', 'Not your lane');
    return null;
  }
  return neumaId;
};

export const birthLocalSealOffer = async (connection, message) => {
  const neumaId = await boundLane(connection, message);
  if (!neumaId) return;
  try {
    const out = await offerLocalSeal({ neumaId, witnessAddress: connection.walletAddress });
    if (!out.ok) return refuse(connection, neumaId, out.code, out.message);
    if (out.complete) return send(connection, { type: 'birth:local_sealed', neumaId });
    return send(connection, { type: 'birth:local_seal_ready', ...out.offer });
  } catch (err) {
    birthLog.error('Local seal offer failed', { neumaId, err: err.message });
    return refuse(connection, neumaId, 'LOCAL_SEAL', 'The seal could not be prepared');
  }
};

export const birthLocalSealSign = async (connection, message) => {
  const neumaId = await boundLane(connection, message);
  if (!neumaId) return;
  try {
    const out = await completeLocalSeal({ neumaId, witnessAddress: connection.walletAddress, witnessSig: message.witnessSig });
    if (!out.ok) return refuse(connection, neumaId, out.code, out.message);
    birthLog.info('Being sealed on this computer', { neumaId });
    return send(connection, { type: 'birth:local_sealed', neumaId, genesisHash: out.genesisHash });
  } catch (err) {
    birthLog.error('Local seal failed', { neumaId, err: err.message });
    return refuse(connection, neumaId, 'LOCAL_SEAL', 'The seal could not be written');
  }
};
