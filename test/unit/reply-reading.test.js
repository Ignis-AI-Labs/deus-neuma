// What a reply SAYS — the fixed rules (sales/reply-reading.js), and the reading as it is kept and read back
// (reply-said.js). The replies are the kinds a cold email to an investor actually gets; the first is the one the
// house got from Khosla on 2026-11-19, with its addresses changed. Pure. RULE 0.
import { describe, it, expect } from 'vitest';
import { readReply, cleanSaid, saidOf, closes, saidWords, SAYS } from '../../backend/services/sales/reply-reading.js';

const says = (text, extra = {}) => readReply({ text, ...extra });

describe('a reply read by fixed rules', () => {
  it('a notice that the person has left: gone, with the addresses the office points to', () => {
    const read = says('Hello,\nKatie Mishra has transitioned out of Khosla Ventures. If you would like to speak with someone from Khosla Ventures please email kv@khosla.example or call the main office.\nIf you would like to reach Katie directly you can reach her at katie@mail.example .\nKhosla Ventures', { from: 'kmishra@khosla.example' });
    expect(read).toEqual({ says: 'gone', why: 'Hello, Katie Mishra has transitioned out of Khosla Ventures.', forward: ['kv@khosla.example', 'katie@mail.example'] });
    expect(says('She is no longer with the firm.').says).toBe('gone');
    expect(says('This mailbox is no longer monitored.').says).toBe('gone');
    // Their own address is never offered as where to write instead.
    expect(says('Sam has left the company. Reach sam@old.example or team@old.example.', { from: 'sam@old.example' }).forward).toEqual(['team@old.example']);
  });

  it('a decline, however politely put: no', () => {
    for (const text of [
      'Thanks for reaching out. This is not a fit for us at this time. Best of luck.',
      'We will pass on this one, but wish you the best.',
      'Not interested, thanks.',
      'This is outside of our focus.',
      'We are not currently investing in new companies.',
      'Appreciate the note — it is too early for us.',
      'No thank you.',
      'Unfortunately we won\'t be able to participate.',
    ]) expect(says(text).says, text).toBe('no');
    expect(says('Thanks for reaching out. This is not a fit for us at this time. Best of luck.').why).toBe('This is not a fit for us at this time.');
  });

  it('a request: wants, and what for', () => {
    expect(says('Thanks Orrin — can you send the deck over?')).toEqual({ says: 'wants', want: 'deck', why: 'Thanks Orrin — can you send the deck over?' });
    expect(says('Yes, send the deck.\nEric')).toMatchObject({ says: 'wants', want: 'deck' });
    expect(says('Please share your one-pager and any materials.')).toMatchObject({ want: 'deck' });
    expect(says('Let\'s find a time next week to chat.')).toMatchObject({ says: 'wants', want: 'call' });
    expect(says('Happy to hop on a call. I booked a slot for Tuesday.')).toMatchObject({ want: 'call' });
    expect(says('Interesting. What is your valuation?')).toMatchObject({ says: 'wants', want: 'more' });
    expect(says('Tell me more about the local model side.')).toMatchObject({ want: 'more' });
    // […] is a yes to looking, not a no.
    expect(says('Not really our focus but happy to take a look, send the deck.')).toMatchObject({ says: 'wants', want: 'deck' });
  });

  it('a decline that still asks for something is a person\'s to read, never a rule\'s', () => {
    expect(says('No thanks, we will pass, but what is your valuation?')).toMatchObject({ says: 'open' });
    expect(says('Not a fit for the fund. Send me the deck anyway and I will forward it.').says).toBe('open');
  });

  it('a machine\'s reply: auto — by its subject, or by words no person writes to a stranger', () => {
    expect(says('I am out of the office until Monday with limited access to email.').says).toBe('auto');
    expect(readReply({ subject: 'Automatic reply: Deus Neuma: Local AI, Live', text: 'I am away. Happy to chat when I return.' })).toEqual({ says: 'auto', why: 'Automatic reply: Deus Neuma: Local AI, Live' });
    expect(readReply({ subject: 'Re: Out of office', text: 'Back on the 3rd.' }).says).toBe('auto');
    expect(says('We have received your message and will respond shortly.').says).toBe('auto');
    // […] opens many a real answer: in the body it decides nothing.
    expect(says('Thanks for reaching out! Could you send the deck?').says).toBe('wants');
  });

  it('anything else, or no words at all: open — read it', () => {
    expect(says('Got it, thanks.')).toEqual({ says: 'open', why: null });
    expect(says('I will pass this on to my partner who covers AI.').says).toBe('open');
    expect(says('')).toEqual({ says: 'open', why: null });
    expect(readReply()).toEqual({ says: 'open', why: null });
  });

  it('only their own words are read: the email of ours they quoted decides nothing', () => {
    const quoted = 'Sounds good.\n\nOn Thu, Nov 19, 2026 at 4:09 PM Orrin wrote:\n> If this is not a fit, no worries. Can I send the deck?';
    expect(says(quoted)).toEqual({ says: 'open', why: null });
    expect(says('Pass.\n\n> Could you send the deck and book a call?').says).toBe('open'); // one bare word is not a rule's to call
  });
});

describe('a reading as it is kept on a lead', () => {
  it('is cleaned to its shape, and refused when it is not a reading', () => {
    expect(cleanSaid({ says: 'wants', want: 'deck', why: '  send the deck  ', forward: ['x'] }, 'mail-watch')).toEqual({ says: 'wants', want: 'deck', why: 'send the deck', by: 'mail-watch' });
    expect(cleanSaid({ says: 'no', want: 'deck', why: 'x'.repeat(400) }, 'operator')).toEqual({ says: 'no', why: 'x'.repeat(160), by: 'operator' });
    expect(cleanSaid({ says: 'gone', forward: ['KV@Khosla.example', 'not an address', 'a@b.example', 'c@d.example', 'e@f.example'] }, 'mail-watch').forward).toEqual(['kv@khosla.example', 'a@b.example', 'c@d.example']);
    expect(cleanSaid({ says: 'maybe' }, 'x')).toBeNull();
    expect(cleanSaid(null, 'x')).toBeNull();
    expect(SAYS).toEqual(['wants', 'open', 'auto', 'gone', 'no']);
  });

  it('the newest reading stands, unless they have written again since', () => {
    const no = { says: 'no', by: 'mail-watch' };
    const wants = { says: 'wants', want: 'deck', by: 'operator' };
    expect(saidOf({ touches: [{ direction: 'out' }, { direction: 'in', said: no }] })).toEqual(no);
    // The operator says otherwise, later: theirs stands.
    expect(saidOf({ touches: [{ direction: 'in', said: no }, { said: wants }] })).toEqual(wants);
    // They write again and nothing has read it yet: the old reading says nothing about the new reply.
    expect(saidOf({ touches: [{ direction: 'in', said: no }, { said: wants }, { direction: 'in' }] })).toBeNull();
    expect(saidOf({ touches: [{ direction: 'out' }] })).toBeNull();
    expect(saidOf({})).toBeNull();
  });

  it('a no and a departure end the writing; nothing else does', () => {
    expect(SAYS.filter((s) => closes({ says: s }))).toEqual(['gone', 'no']);
    expect(closes(null)).toBe(false);
    expect(saidWords({ says: 'wants', want: 'deck' })).toBe('they asked for the deck');
    expect(saidWords({ says: 'gone', forward: ['kv@khosla.example'] })).toBe('they have left (their office points to kv@khosla.example)');
    expect(saidWords({ says: 'no' })).toBe('they said no');
    expect(saidWords(null)).toBe('not read yet');
  });
});
