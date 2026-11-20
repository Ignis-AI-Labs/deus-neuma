/**
 * PUBLISHING IN HOUSE WORK IS THE OPERATOR'S — the platform's own list, beside
 * the Optio's review (audit P6-105).
 *
 * The Optio's review is a model reading a housemate's words, and a model can
 * be talked into CLEAR. What the operator keeps for themselves is therefore
 * never the review's to decide. Money out (charter-shape.js MONEY_OUT) and
 * posting and email (optio-review.js OUTWARD) were already named by act; the
 * other acts that put the house's words or work in front of people outside it
 * reached the review. They are named here, and the table (actRoute) sends
 * them to the operator before any review is asked. Only the charter's
 * `allow`, which the operator alone writes, lets one run in house work.
 *
 * A new act that publishes joins this list in the same change that adds it.
 *
 * Pure.
 */

/** Acts that put the house's words or work where people outside it see them, or take them back. */
export const PUBLISHING = Object.freeze([
  'intents/social.post',
  'intents/delivery.publish',
  'intents/vault.publish',
  'intents/security.escalate',
  'intents/marketing.plan',
  'social/queue_retract',
]);

/** Why a publishing act in house work went to the operator. */
export const PUBLISHING_IS_THE_OPERATORS = 'publishing goes to the operator unless the charter allows it';

/**
 * Acts that ask the operator for money, or bill and book it under the house's
 * name. None spends, so in the operator's chat each runs on its own row; in
 * house work nobody watches a bill go out or a reward be asked for, so the
 * table sends them to the operator unless the charter allows them.
 */
export const MONEY_ASKS = Object.freeze(['intents/lp.reward', 'intents/treasury.invoice', 'intents/treasury.invoice-paid']);

/** Why a money ask in house work went to the operator. */
export const MONEY_ASKS_ARE_THE_OPERATORS = 'a reward request and an invoice go to the operator unless the charter allows them';

/** Whether an act publishes. Pure. */
export const isPublishing = (tool) => PUBLISHING.includes(tool);
