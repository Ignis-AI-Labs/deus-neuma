// their-email — a lead's email, read from the house mailbox, whatever became of it since the watch recorded it (Founder,
// 2026-11-19, Blockchain Capital's reply would not open: […]). The watch named it by its number in the inbox; an email
// archived or labelled away since keeps no number there, and a number in the inbox can come to name another email.
// So the number is believed only when the email there is from them; otherwise it is found by who sent it and when
// (imap-reader.js findMessage). An email with no plain part arrives as words, not markup (imap-reader.js messageOf).
// impure (IMAP).

import { readMessage, findMessage } from '../email/imap-reader.js';
import { normalizeEmail } from './suppress-shape.js';
import { theirWords, THEIR_WORDS_MAX } from './reply-rules.js';

/** pure — the address in a From line ("Name <a@b>" or a bare address). */
const addressOf = (from) => normalizeEmail((/<([^<>]+)>/.exec(String(from ?? '')) ?? [])[1] ?? from);

/** pure — the words of a read email: their own words above what they quoted, or the whole email when nothing stands
 *  above it (a reply that is only a quote still shows something true). */
const wordsOf = (message) => {
  const text = String(message.text ?? '');
  return { text, words: theirWords(text) || text.slice(0, THEIR_WORDS_MAX).trim() };
};

/**
 * @param {object} credentials the house mailbox
 * @param {{uid: number, from: string, near: string}} q the number the watch recorded, the lead's address, when it came
 * @returns {Promise<{ok: true, message: object & {folder: string, words: string}} | {ok: false, detail: string}>}
 */
export const readTheirEmail = async (credentials, { uid, from, near }) => {
  const inbox = await readMessage(credentials, uid);
  const theirs = inbox.ok && addressOf(inbox.message.from) === normalizeEmail(from);
  const read = theirs ? { ok: true, message: { ...inbox.message, folder: 'INBOX' } } : await findMessage(credentials, { from, near });
  if (!read.ok) {
    const first = inbox.ok ? `#${uid} in the inbox is now someone else's email` : inbox.detail;
    return { ok: false, detail: `${first}; looked for it elsewhere: ${read.detail}` };
  }
  return { ok: true, message: { ...read.message, ...wordsOf(read.message) } };
};
