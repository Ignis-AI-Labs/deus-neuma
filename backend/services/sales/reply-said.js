// REPLY SAID — a reply's reading as it is KEPT on a lead and read back: its shape, the newest one that still
// stands, and its plain words. The reading itself is made by reply-reading.js (the mail watch), by the operator, or
// by a member; this file is what the lead ledger and every reader share, and imports nothing that reads mail.
// PURE.

import { normalizeEmail } from './suppress-shape.js';

export const SAYS = Object.freeze(['wants', 'open', 'auto', 'gone', 'no']);
export const WANTS = Object.freeze(['deck', 'call', 'more']);
export const WHY_MAX = 160;

/** A reading as it is kept on a lead's touch, or null when it is not one. pure. */
export const cleanSaid = (said, by) => {
  if (!said || !SAYS.includes(said.says)) return null;
  const forward = Array.isArray(said.forward) ? said.forward.map(normalizeEmail).filter(Boolean).slice(0, 3) : [];
  return {
    says: said.says,
    ...(said.says === 'wants' && WANTS.includes(said.want) ? { want: said.want } : {}),
    ...(typeof said.why === 'string' && said.why.trim() ? { why: said.why.trim().slice(0, WHY_MAX) } : {}),
    ...(forward.length ? { forward } : {}),
    by: String(by || said.by || 'mail-watch'),
  };
};

/**
 * What a lead's latest reply says: the newest reading on the lead that is not older than their last message (a
 * reading of an earlier reply says nothing about a later one). null when they have not written, or nothing has read it.
 * @param {{touches?: object[]}} lead
 */
export const saidOf = (lead) => {
  const touches = lead?.touches ?? [];
  const lastIn = touches.findLastIndex((t) => t.direction === 'in');
  const at = touches.findLastIndex((t) => t.said && SAYS.includes(t.said.says));
  return at >= 0 && at >= lastIn ? touches[at].said : null;
};

/** Does this reading end the house's writing to the person (the contact is kept either way)? pure. */
export const closes = (said) => said?.says === 'no' || said?.says === 'gone';

const WANT_WORDS = Object.freeze({ deck: 'the deck', call: 'a call', more: 'to know more' });
/** A reading in a few plain words, for a note on the lead and a line to a being. pure. */
export const saidWords = (said) => (!said ? 'not read yet'
  : said.says === 'wants' ? `they asked for ${WANT_WORDS[said.want] ?? 'something'}`
    : said.says === 'no' ? 'they said no'
      : said.says === 'gone' ? `they have left${said.forward?.length ? ` (their office points to ${said.forward.join(', ')})` : ''}`
        : said.says === 'auto' ? 'an automatic reply, not them yet'
          : 'they wrote: read it');
