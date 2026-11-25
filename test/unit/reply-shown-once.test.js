// REPLIES, a row opened: their latest reply stands first and is shown ONCE — the thread under it is everything else
// that went between (Design note, 2026-11-20: […]). Real component,
// real thread reading (messagesOf), a real render. RULE 0.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Replied } from '../../frontend/app/RelinkShell/company-line/SalesStagesOut.jsx';

const lead = (thread) => ({ id: 'lead-1', name: 'Katie Mishra', contact: 'kmishra@example.com', thread });
const render = (thread) => renderToStaticMarkup(createElement(Replied, { engine: { outbox: { drafts: [] } }, lead: lead(thread) }));
const count = (html, words) => html.split(words).length - 1;
const OUT = { way: 'out', channel: 'email', at: '2026-11-19T09:09:00.000Z', subject: 'Deus Neuma: Local AI, Live', text: 'Hi Katie, the deck is at deusneuma.ai/deck.' };
const IN = { way: 'in', channel: 'email', at: '2026-11-19T09:14:00.000Z', subject: 'Re: Deus Neuma: Local AI, Live', text: 'Katie Mishra has transitioned out of Khosla Ventures.' };

describe('their reply is shown once', () => {
  it('one email out, one reply back: the reply once at the top, the sent email under it', () => {
    const html = render([OUT, IN]);
    expect(count(html, 'Katie Mishra has transitioned out of Khosla Ventures.')).toBe(1);
    expect(count(html, 'THEIR REPLY')).toBe(1);
    expect(count(html, 'THEY WROTE')).toBe(0);
    expect(count(html, 'Hi Katie, the deck is at deusneuma.ai/deck.')).toBe(1);
    expect(html.indexOf('THEIR REPLY')).toBeLessThan(html.indexOf('SENT'));
  });

  it('two replies: the latest at the top once, the earlier one still in the thread', () => {
    const first = { ...IN, at: '2026-11-19T09:12:00.000Z', text: 'An earlier note from their office.' };
    const html = render([OUT, first, IN]);
    expect(count(html, 'Katie Mishra has transitioned out of Khosla Ventures.')).toBe(1);
    expect(count(html, 'An earlier note from their office.')).toBe(1);
    expect(count(html, 'THEY WROTE')).toBe(1);
  });

  it('a reply with nothing sent before it leaves no empty thread and no "no message" line', () => {
    const html = render([IN]);
    expect(count(html, 'Katie Mishra has transitioned out of Khosla Ventures.')).toBe(1);
    expect(html).not.toContain('NO MESSAGE IS RECORDED');
    expect(html).not.toContain('spl-thread');
  });
});
