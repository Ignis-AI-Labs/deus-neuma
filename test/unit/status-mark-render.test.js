// StatusMark and the surfaces that now say a status through it, through a
// real react-dom render (no mock): every status draws a real shape, its name
// beside it or on its hover, and DONE FOR YOU says each row by the one table.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusMark } from '../../frontend/app/RelinkShell/StatusMark.jsx';
import { DoneForYou } from '../../frontend/app/RelinkShell/mandate/DoneForYou.jsx';
import { STATUS_MARKS } from '../../frontend/app/RelinkShell/post-status-marks.js';

const html = (el) => renderToStaticMarkup(el);

describe('StatusMark', () => {
  it('every status in the table draws a shape (never an empty mark) in its own tone, named beside it', () => {
    for (const [key, m] of Object.entries(STATUS_MARKS)) {
      const out = html(createElement(StatusMark, { status: key, named: true }));
      expect(out, key).toMatch(/<svg[^>]*class="stm-mark"[^>]*><(circle|path|rect)/);
      expect(out, key).toContain(`class="stm is-${m.tone}"`);
      expect(out, key).toContain(`data-status="${key}"`);
      expect(out, key).toContain(`<span class="stm-name">${m.name}</span>`);
    }
  });

  it('unnamed, the mark is an image whose name is its label and its hover', () => {
    const out = html(createElement(StatusMark, { status: 'failed' }));
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="FAILED"');
    expect(out).toContain('title="FAILED"');
    expect(out).not.toContain('stm-name');
  });

  it('from a queue entry: a mandate\'s approval reads BY MANDATE; a hover can carry more', () => {
    expect(html(createElement(StatusMark, { entry: { status: 'approved', decidedUnder: 'm1' }, named: true }))).toContain('BY MANDATE');
    const sent = html(createElement(StatusMark, { entry: { status: 'sent', postId: '77' }, named: true, title: 'SENT · post 77' }));
    expect(sent).toContain('title="SENT · post 77"');
    expect(sent).toContain('>SENT</span>');
  });
});

describe('DONE FOR YOU', () => {
  it('each row\'s standing is its StatusMark: an act by its post, an event by its own kind', () => {
    const rows = [
      { id: 'a', at: '2026-10-24T09:05:00Z', kind: 'event', what: 'You withdrew the mandate', text: '', status: 'withdrawn' },
      { id: 'b', at: '2026-10-24T09:01:00Z', kind: 'act', what: 'Posted', where: 'x · x-1', text: 'two', status: 'withdrawn' },
      { id: 'c', at: '2026-10-24T09:00:00Z', kind: 'act', what: 'Posted', where: 'x · x-1', text: 'one', status: 'sent', link: 'https://x.com/i/web/status/77' },
      { id: 'd', at: '2026-10-24T08:00:00Z', kind: 'event', what: 'The mandate paused', text: 'pace', status: 'tripped' },
    ];
    const out = html(createElement(DoneForYou, { rows, onChanged: () => {} }));
    expect([...out.matchAll(/data-status="([^"]+)"/g)].map((m) => m[1])).toEqual(['mandate-withdrawn', 'withdrawn', 'sent', 'mandate-tripped']);
    expect([...out.matchAll(/<span class="stm-name">([^<]+)</g)].map((m) => m[1])).toEqual(['MANDATE OFF', 'WITHDRAWN', 'SENT', 'PAUSED']);
  });
});
