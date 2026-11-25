/**
 * EVERY ADDRESS CHECKED BEFORE IT IS SENT, AND A BOUNCE IN THE PIPELINE (Outbox.jsx, SalesStagesOut.jsx,
 * sales-pipeline-view.js, lead-upkeep.js bouncedLead) — Design note, 2026-11-19, a Google Group that bounced: […] Pure, and the screen rendered for real (react-dom/server).
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bouncedLead, upkeepDue } from '../../backend/services/sales/lead-upkeep.js';
import { Outbox } from '../../frontend/app/RelinkShell/company-line/Outbox.jsx';
import { SentStage } from '../../frontend/app/RelinkShell/company-line/SalesStagesOut.jsx';
import { sentRows, pipelineOf } from '../../frontend/app/RelinkShell/company-line/sales-pipeline-view.js';

const touch = (at, extra) => ({ at, by: 'x', ...extra });

describe('a bounce is not a no', () => {
  it('a lead the bounce closed is BOUNCED until it moves to a new address; the seat is asked to find the right one, first', () => {
    const bounced = { id: 'l1', name: '1kx Investment Team', contact: 'team@1kx.capital', status: 'lost', kind: 'buyer',
      touches: [touch('2026-11-19T04:46:19Z', { direction: 'out', note: 'emailed: "Umbrae"' }), touch('2026-11-19T04:51:15Z', { status: 'lost', note: 'address bounced (mail #7240)' })] };
    expect(bouncedLead(bounced)).toEqual({ at: '2026-11-19T04:51:15Z', address: 'team@1kx.capital' });
    // Closed for another reason, or moved on since: not bounced.
    expect(bouncedLead({ ...bounced, touches: [touch('2026-11-19T05:00:00Z', { status: 'lost', note: 'not interested' })] })).toBe(null);
    expect(bouncedLead({ ...bounced, status: 'cold', touches: [...bounced.touches, touch('2026-11-19T06:00:00Z', { status: 'cold', contactFrom: 'team@1kx.capital', note: 'moved' })] })).toBe(null);
    const due = upkeepDue({ leads: [bounced], now: Date.parse('2026-11-19T06:00:00Z'), suppressed: () => true });
    expect(due).toEqual([expect.objectContaining({ kind: 'bounced', leadId: 'l1', address: 'team@1kx.capital' })]);
  });

  it('SENT puts a bounced lead first, marked BOUNCED, and the stage says how many bounced', () => {
    const engine = {
      campaigns: [], segments: [], outbox: { drafts: [] },
      upkeep: [{ kind: 'bounced', leadId: 'l1', address: 'team@1kx.capital' }],
      leads: [
        { id: 'l0', name: 'Merantix', contact: 'info@merantix.com', status: 'contacted', thread: [], bounced: null },
        { id: 'l1', name: '1kx Investment Team', contact: 'team@1kx.capital', status: 'lost', thread: [], bounced: { at: '2026-11-19T04:51:15Z', address: 'team@1kx.capital' } },
      ],
    };
    expect(sentRows(engine, 'all').map((l) => l.id)).toEqual(['l1', 'l0']);
    expect(pipelineOf({ engine }).find((s) => s.id === 'sent').yours).toBe('1 BOUNCED');
    const html = renderToStaticMarkup(createElement(SentStage, { engine, view: 'all' }));
    expect(html).toContain('data-bounced="1"');
    expect(html).toContain('BOUNCED · 2026-11-19');
    expect(html).toContain('<td class="is-alert">FIND THE RIGHT ONE</td>');
  });
});

describe('the outbox says what each address\'s check said, before anything is sent', () => {
  it('VALID, WILL BOUNCE, RISKY or NOT CHECKED YET on every row, and CHECK ADDRESSES for the ones not yet asked', () => {
    const drafts = ['ok@a.io', 'dead@b.io', 'any@c.io', 'new@d.io'].map((to, i) => ({ id: `m-${i}`, to: [to], subject: 's', text: 'the words of a staged email', state: 'waiting', at: `2026-11-19T0${i}:00:00Z` }));
    const checks = { 'ok@a.io': { status: 'valid', checker: 'Hunter', at: '2026-11-19' }, 'dead@b.io': { status: 'invalid', checker: 'Tomba', at: '2026-11-19' }, 'any@c.io': { status: 'accept_all', checker: 'Hunter', at: '2026-11-19' } };
    const html = renderToStaticMarkup(createElement(Outbox, { outbox: { review: true, drafts }, leads: [], busy: false, onSend: () => {}, onReturn: () => {}, onEdit: () => {}, checks, onCheck: () => {} }));
    for (const [status, words] of [['valid', 'VALID'], ['invalid', 'WILL BOUNCE'], ['accept_all', 'RISKY — ITS SERVER TAKES ANY ADDRESS'], ['none', 'NOT CHECKED YET']]) {
      expect(html).toContain(`data-address-check="${status}"`);
      expect(html).toContain(words);
    }
    expect(html).toContain('CHECK ADDRESSES (1)');
  });
});
