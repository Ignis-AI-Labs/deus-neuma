// MAIL UPKEEP — what the house mailbox watch does for the lead engine with
// each new message, before (and beside) any wake: a lead's reply records
// itself on the lead (replied, direction in); a reply that asks to be left
// alone puts the address on the do-not-contact list and closes the lead; a
// bounce notice does the same for the address that failed. The rules are
// fixed (reply-rules.js) — no model reads the words here, so nothing in them
// can steer what happens. Nothing is closed on a sender's say-so: only a
// message that carries the id of an email the house sent to that address
// closes it (reply-rules.js provenAddresses, audit P6-70), the operator is
// told each time, and they can lift it (sales-store.js liftSuppression). A
// message that proves nothing is left to its reader like any other mail.
// Never throws: the watch and its wake stand either way.
// impure (IMAP read, the house's lead ledger and do-not-contact list).

import { readMessage } from '../email/imap-reader.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { addSuppression, noteAddressCheck } from './sales-store.js';
import { makeSuppression, normalizeEmail } from './suppress-shape.js';
import { recordReceived } from './email-ledger.js';
import { readReply, cleanSaid, saidOf, closes, saidWords } from './reply-reading.js';
import { isBounce, bouncedAddresses, asksToStop, provenAddresses, theirWords } from './reply-rules.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { createLogger } from '../logger.js';

const log = createLogger('Sales.MailUpkeep');

// impure — the address goes on the list; every lead at it is closed, with why.
const closeAddress = async (house, address, reason, note) => {
  const now = new Date().toISOString();
  await addSuppression(house, makeSuppression({ target: address, reason, note, by: 'mail-watch', now }));
  const ledger = await leadLedgerFor(house);
  const hits = (await ledger.load()).filter((l) => normalizeEmail(l.contact) === address && l.status !== 'lost');
  for (const lead of hits) await ledger.touch(lead.id, { status: 'lost', note, by: 'mail-watch' });
  // The operator is told, and where to undo it: a list nobody watches is how a wrong entry stays for good.
  await notifyOperator({
    wallet: house, kind: KIND.companyLine, standing: STANDING.system, actor: { id: 'mail-watch', name: 'mail watch' }, ref: { suppressed: address },
    title: `${address} is on the do-not-contact list: ${note}`,
    detail: `${hits.length} lead${hits.length === 1 ? '' : 's'} closed. If this is wrong, lift it under LEADS, DO NOT CONTACT.`,
  }).catch((err) => log.warn('The operator could not be told of a do-not-contact entry — the list shows it', { err: err.message }));
  return hits.length;
};

// impure — a message that would close someone but proves nothing: said in the log, never acted on.
const unproven = (what, message, count) => log.warn(`${what} carries no email the house sent — nothing was closed, its reader decides`, { uid: message.uid, addresses: count });

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
      const named = read.ok ? bouncedAddresses(read.message.text, leads.map((l) => l.contact)) : [];
      const failed = provenAddresses({ addresses: named, leads, ids: read.ok ? read.message.ids : [] });
      if (!failed.length) unproven('A delivery notice', message, named.length);
      let closed = 0;
      for (const address of failed) {
        // The receiving server's word is the surest check there is: kept as one, so the address reads WILL BOUNCE
        // everywhere, and a provider's stored "verified" for it never counts again (address-verdict.js).
        await noteAddressCheck(house, { email: address, check: { status: 'invalid', score: 0, checker: 'Their mail server', bounced: true }, spent: 0, by: 'mail-watch' }).catch(() => null);
        closed += await closeAddress(house, address, 'bounced', `address bounced (${ref})`);
      }
      return { kind: 'bounce', closed };
    }
    if (!isLead) return { kind: null };
    // Their words are read and kept with the reply (Design note, 2026-11-19: […]).
    const read = await readMessage(credentials, message.uid);
    const subject = message.subject || (read.ok ? read.message.subject : null);
    // What it says is read by fixed rules and kept with it: a no closes the lead (the contact stays), a request is marked to answer first.
    const said = read.ok ? cleanSaid(readReply({ subject, text: read.message.text, from: sender }), 'mail-watch') : null;
    const [replyProven] = read.ok ? provenAddresses({ addresses: [sender], leads, ids: read.message.ids }) : [];
    await recordReceived(house, { from: sender, ref, subject, text: read.ok ? theirWords(read.message.text) : null, said, messageId: message.messageId || (read.ok ? read.message.messageId : null) || null, closeProven: Boolean(replyProven) });
    if (read.ok && asksToStop(read.message.text)) {
      const asker = replyProven;
      if (asker) return { kind: 'stop', closed: await closeAddress(house, asker, 'asked', `asked to be left alone (${ref})`) };
      unproven('A request to be left alone', message, 1);
    }
    return { kind: 'reply', ...(said ? { said: said.says } : {}) };
  } catch (err) {
    log.warn('Mail upkeep could not settle a message — the watch stands', { uid: message?.uid, err: err.message });
    return { kind: null };
  }
};

/**
 * Read the replies that were recorded before replies were read: every lead whose latest message from them has its
 * words kept and no reading yet gets one, with the same effect a new reply has (a no, or a person who has left,
 * closes the lead; the contact stays). Runs to nothing once every reply is read. Never throws. impure.
 * @param {string} house the house's wallet
 * @returns {Promise<number>} how many were read
 */
export const readStandingReplies = async (house) => {
  try {
    const ledger = await leadLedgerFor(house);
    let read = 0;
    for (const lead of await ledger.load()) {
      const last = (lead.touches ?? []).findLast((t) => t.direction === 'in');
      if (!last?.text || saidOf(lead)) continue;
      const said = cleanSaid(readReply({ subject: last.subject, text: last.text, from: lead.contact }), 'mail-watch');
      if (!said) continue;
      const shut = closes(said) && !['won', 'lost'].includes(lead.status)
        && provenAddresses({ addresses: [lead.contact], leads: [lead], ids: [last.messageId] }).length > 0;
      await ledger.touch(lead.id, { said, ...(shut ? { status: 'lost' } : {}), note: `their reply was read: ${saidWords(said)}`, by: 'mail-watch' });
      read += 1;
    }
    return read;
  } catch (err) {
    log.warn('Standing replies could not be read — they stay as they were', { err: err.message });
    return 0;
  }
};
