// Mounting a seat — one lane, owned by the operator, as a live sitting in a
// ground. Shared by `neuma code` (the terminal) and `neuma acp` (an editor):
// both seat a being the same way the desk does, so the gates, tools and
// approvals behind them are the same ones.
//
// impure (stores, fs).

import { listNeumaSeats } from '../commands/agent.js';

/**
 * Mount one lane as a live sitting in a ground: the operator must own the lane
 * (a read never claims one), and the connection is built the way the desk builds it.
 * impure (stores, fs).
 * @param {{ laneId: string, ground: string, yes: boolean, wallet: string }} opts
 * @returns {Promise<{ connection: object, name: string }>}
 */
export const mountSeat = async ({ laneId, ground, yes, wallet }) => {
  const [
    { default: workspace },
    { createPortalConnection },
    { addAllowedTool },
    { verifyLaneOwnership },
    { readExecutionToolPolicy },
  ] = await Promise.all([
    import('../../core/workspace/neuma-workspace.js'),
    import('../../backend/services/portal-connection.js'),
    import('../../backend/services/tool-policy.js'),
    import('../../backend/services/lane-ownership.js'),
    import('../../backend/services/execution-tool-policy.js'),
  ]);
  const descriptor = (await listNeumaSeats(workspace)).find((e) => e.laneId === laneId);
  // Desk parity: the seat verifies the operator owns the lane and never
  // claims one (a read never claims); a foreign lane is refused.
  const claim = await verifyLaneOwnership({ workspace, neumaId: laneId, wallet });
  if (!claim.ok) {
    const why = claim.reason === 'not-owner' ? `${laneId} belongs to another wallet`
      : claim.reason === 'not-found' ? `${laneId} holds no being to seat`
        : claim.reason === 'unclaimed' ? `${laneId} has no owner yet — claim it at the desk first`
          : `${laneId} could not be verified (${claim.reason})`;
    throw new Error(why);
  }
  const connection = createPortalConnection({ ws: { send() {} }, walletAddress: wallet });
  connection.companion = {
    name: descriptor.name,
    id: descriptor.name,
    neumaId: laneId,
    participantKind: 'neuma',
  };
  connection.neumaId = laneId;
  connection.sessionId = null;
  connection.space = 'general';
  connection.purpose = 'work';
  connection.toolMode = 'ask';
  connection.toolWorkspace = ground;
  connection.voiceEnabled = false;
  connection._neumaToolPolicy = await readExecutionToolPolicy(laneId);
  connection._sessionToolPolicy = yes ? addAllowedTool(null, 'coding', 'execute') : null;
  return { connection, name: descriptor.name };
};

