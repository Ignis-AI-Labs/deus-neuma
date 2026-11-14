// MAIL UPKEEP — what the house mailbox watch does for the lead engine with
// each new message, before (and beside) any wake: a lead's reply records
// itself on the lead (replied, direction in); a reply that asks to be left
// alone puts the address on the do-not-contact list and closes the lead; a
// bounce notice does the same for the address that failed. The rules are
// fixed (reply-rules.js) — no model reads the words here, so nothing in them
// can steer what happens. Never throws: the watch and its wake stand either way.
// impure (IMAP read, the house's lead ledger and do-not-contact list).

import { readMessage } from '../email/imap-reader.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { addSuppression } from './sales-store.js';
import { makeSuppression, normalizeEmail } from './suppress-shape.js';
import { recordReceived } from './email-ledger.js';
import { isBounce, bouncedAddresses, asksToStop } from './reply-rules.js';
import { createLogger } from '../logger.js';

const log = createLogger('Sales.MailUpkeep');

// impure — the address goes on the list; every lead at it is closed, with why.
const closeAddress = async (house, address, reason, note) => {
  const now = new Date().toISOString();
  await addSuppression(house, makeSuppression({ target: address, reason, note, by: 'mail-watch', now }));
  const ledger = await leadLedgerFor(house);
  const hits = (await ledger.load()).filter((l) => normalizeEmail(l.contact) === address && l.status !== 'lost');
  for (const lead of hits) await ledger.touch(lead.id, { status: 'lost', note, by: 'mail-watch' });
  return hits.length;
};

/**
 * Settle one new message for the lead engine.
 * @param {string} house the house's wallet
 * @param {{credentials: object, message: {uid: number, from: string, subject: string}, sender: string, isLead: boolean, leads: object[]}} m
 * @returns {Promise<{kind: 'bounce'|'stop'|'reply'|null, closed?: number}>}
 */
export const settleMail = async (house, { credentials, message, sender, isLead, leads }) => {
  try {
    const ref = `mail #${message.uid}`;
    if (isBounce(message)) {
      const read = await readMessage(credentials, message.uid);
      const failed = read.ok ? bouncedAddresses(read.message.text, leads.map((l) => l.contact)) : [];
      let closed = 0;
      for (const address of failed) closed += await closeAddress(house, address, 'bounced', `address bounced (${ref})`);
      return { kind: 'bounce', closed };
    }
    if (!isLead) return { kind: null };
    await recordReceived(house, { from: sender, ref });
    const read = await readMessage(credentials, message.uid);
    if (read.ok && asksToStop(read.message.text)) {
      return { kind: 'stop', closed: await closeAddress(house, normalizeEmail(sender), 'asked', `asked to be left alone (${ref})`) };
    }
    return { kind: 'reply' };
  } catch (err) {
    log.warn('Mail upkeep could not settle a message — the watch stands', { uid: message?.uid, err: err.message });
    return { kind: null };
  }
};
