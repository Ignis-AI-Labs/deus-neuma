// portal-house-local-handlers.js — the frames that found a house ON THIS COMPUTER (house-local-founding.js):
//   house:found_local_preflight {probe: true}   → house:found_local_state {record} | house:found_local_open {…roster}
//   house:found_local_preflight {titles}        → house:found_local_ready {offer} (every being's mark already signed)
//   house:found_local_sign {witnessSig}          → house:found_local_founded {record}
//   any refusal                                  → house:found_local_error {code, message}
// The operator is the portal's authenticated wallet; only lanes it owns ever found with it. The held founding
// lives on the connection between ready and sign: the beings' marks were made over exactly those words.
import { createLogger } from '../services/logger.js';
import { probeLocalFounding, prepareLocalFounding, completeLocalFounding } from '../services/house-local-founding.js';

const log = createLogger('HouseLocal');

const send = (connection, frame) => connection.ws.send(JSON.stringify(frame));
const refuse = (connection, code, message) => send(connection, { type: 'house:found_local_error', code, message });

export const houseFoundLocalPreflight = async (connection, message) => {
  try {
    if (message?.probe) {
      const out = await probeLocalFounding(connection.walletAddress);
      if (!out.ok) return refuse(connection, out.code, out.message);
      if (out.founded) return send(connection, { type: 'house:found_local_state', record: out.record });
      return send(connection, { type: 'house:found_local_open', ...out.open });
    }
    const out = await prepareLocalFounding({ wallet: connection.walletAddress, titles: message?.titles });
    if (!out.ok) return refuse(connection, out.code, out.message);
    connection.pendingLocalFounding = out.pending;
    return send(connection, { type: 'house:found_local_ready', ...out.offer });
  } catch (err) {
    log.error('Local founding preflight failed', { err: err.message });
    return refuse(connection, 'PREFLIGHT', 'The founding could not be prepared');
  }
};

export const houseFoundLocalSign = async (connection, message) => {
  try {
    const out = await completeLocalFounding({ wallet: connection.walletAddress, pending: connection.pendingLocalFounding, witnessSig: message?.witnessSig });
    if (!out.ok) return refuse(connection, out.code, out.message);
    connection.pendingLocalFounding = null;
    log.info('House founded on this computer', { houseName: out.record.houseName, members: out.record.members.length });
    return send(connection, { type: 'house:found_local_founded', record: out.record });
  } catch (err) {
    log.error('Local founding failed', { err: err.message });
    return refuse(connection, 'FOUNDING', 'The founding could not be written');
  }
};
