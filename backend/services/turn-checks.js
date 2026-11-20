// turn-checks.js — what a settled turn is checked for before its chat moves on. Each check may
// say so in the stream and owe the chat one platform turn (platform-follow-up.js; the first owed
// stands): the CLO's unconfirmed law (legal/answer-hold.js), then a queue change the reply claims
// but no act made (social/queue-claim-check.js). Never throws: each check guards itself.

import { settleCitationHold } from './legal/answer-hold.js';
import { settleQueueClaim } from './social/queue-claim-check.js';

/**
 * impure — run every turn-end check, in order.
 * @param {{connection: Object, text: string, interrupted: boolean, origin: string|null, recent?: Array<Object>, thought?: string}} turn
 */
export const settleTurnChecks = async (turn) => {
  await settleCitationHold(turn);
  await settleQueueClaim(turn);
};
