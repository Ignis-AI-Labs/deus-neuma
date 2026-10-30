// The house mailbox, as the raise room reaches an investor through it: the
// lane must hold its own house's mailbox (the single-holder position the
// email/send act keeps), and the account must resolve. The send itself is the
// house's SMTP sender (email/smtp-sender.js) — no second road out.
// impure.

import { resolveEmailCredential } from '../email/email-credentials.js';
import { emailBinding, canNeumaUseEmail } from '../email/email-binding.js';
import { houseOfLane } from '../social/house-positions.js';
import { sendEmail } from '../email/smtp-sender.js';

/**
 * The mailbox this lane may write from, or the refusal.
 * @param {string} laneId
 * @returns {Promise<{credentials: object} | {refusal: string}>}
 */
export const mailboxFor = async (laneId) => {
  const house = await houseOfLane(laneId);
  const [bindings, credentials] = await Promise.all([emailBinding.load(house).catch(() => ({})), resolveEmailCredential(house).catch(() => null)]);
  if (!canNeumaUseEmail(bindings, laneId)) return { refusal: 'the house mailbox is not yours to hold — the operator binds email to the Mercator who reaches investors' };
  if (credentials === null) return { refusal: 'the house mailbox is not configured — the operator connects the account' };
  return { credentials };
};

/** Send one message through it. impure. @returns {Promise<{ok: boolean, messageId?: string, detail?: string}>} */
export const sendThrough = (credentials, { to, subject, text }, signal) => sendEmail(credentials, { to, subject, text }, { signal });
