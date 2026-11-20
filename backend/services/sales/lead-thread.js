// lead-thread — what went back and forth with a lead, message by message, and through which channel (Founder,
// 2026-11-18: […]). Read from the lead's own history: every touch the house wrote
// out (the mailbox marks its own; an older one only set the status to contacted) and every one they wrote in. An
// email says so (the mailbox writes […] and its sending address); anything else went through the channel the
// lead is reached on (an x.com contact is X). Pure.

import { isOut } from './lead-upkeep.js';
import { sourceOf } from '../leads/lead-ledger.js';
import { htmlToText } from '../html-to-text.js';

const EMAILED = /^(maybe )?emailed\b/i;
const MAIL_REF = /\(mail #(\d+)\)/;
// A reply kept before the mailbox read HTML-only email as words (2026-11-20) can hold its markup: read as words here.
const MARKUP = /<(?:div|br|p|a|span|table|td|tr|html|body|font|b|i|strong|em|img|blockquote)\b[^>]*>/i;
const wordsOf = (text) => (MARKUP.test(text) ? htmlToText(text) : text);

/**
 * @param {object} lead - a lead on the ledger, with its touches
 * @returns {Array<{at: string, way: 'out'|'in', channel: string, note: ?string, from: ?string, by: ?string, subject?: string, text?: string, uid?: number}>} oldest first
 *   — a message they wrote carries its subject and their words where the mailbox watch kept them, and the mailbox's
 *   number for it (uid), so an older one can be read again whole (GET /lead-engine/mail/:uid).
 */
export const leadThread = (lead) => (lead?.touches ?? [])
  .map((t) => ({ t, way: isOut(t) ? 'out' : t.direction === 'in' || (!t.direction && t.status === 'replied') ? 'in' : null }))
  .filter(({ way }) => way)
  .map(({ t, way }) => ({
    at: t.at, way,
    channel: t.from || EMAILED.test(String(t.note ?? '')) ? 'email' : sourceOf(lead),
    note: t.note ?? null, from: t.from ?? null, by: t.by || null,
    ...(way === 'in' && t.subject ? { subject: t.subject } : {}),
    ...(way === 'in' && t.text ? { text: wordsOf(t.text) } : {}),
    ...(way === 'in' && MAIL_REF.test(String(t.note ?? '')) ? { uid: Number(MAIL_REF.exec(String(t.note)).at(1)) } : {}),
  }));
