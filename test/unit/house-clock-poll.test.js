// house-clock-poll.test.js — the HOUSE CLOCK window's poll law (RULE 0: the
// pure helpers with real inputs, and the window rendered for real through
// react-dom/server): one failed read never blanks the parts that answered, a
// charter not read yet is never "no charter" (no WRITE A CHARTER, no PAUSE on
// a guess), and a poll's failure is its own line, apart from an act's refusal.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { charterStatus, pauseSwitch, settleReads } from '../../frontend/app/RelinkShell/house-clock/house-clock-view.js';
import { HouseClockBody } from '../../frontend/app/RelinkShell/house-clock/HouseClockBody.jsx';
import { normalizeCharter } from '../../backend/services/house-clock/charter-shape.js';

const READS = ['charter', 'queue', 'ledger', 'asks'];
const approved = {
  ...normalizeCharter({ goal: 'Ship one digest a week.', seats: [{ laneId: 'mate', dailyCap: 2 }] }),
  paused: false, version: 1, approvedVersion: 1, approvedAt: '2026-10-18T10:00:00.000Z',
};

const render = (props) => renderToStaticMarkup(createElement(HouseClockBody, {
  tab: 'charter', history: [], names: {}, asks: [], busy: false, error: null, onTab: () => {}, ...props,
}));

describe('settleReads — each read lands on its own', () => {
  it('a failed queue read keeps the charter that answered, and names only what failed', async () => {
    const settled = await Promise.allSettled([
      Promise.resolve({ charter: approved, history: [] }),
      Promise.reject(new Error('Could not read the wake queue: queue store unreadable.')),
      Promise.resolve({ entries: [] }),
      Promise.resolve({ asks: [], packet: null }),
    ]);
    const { read, error } = settleReads(READS, settled);
    expect(read.charter.charter).toBe(approved);
    expect(read.queue).toBeUndefined();
    expect(read.ledger).toEqual({ entries: [] });
    expect(error).toBe('Could not read the wake queue: queue store unreadable.');
    // the charter read stands: PAUSE stays the operator's, the standing stays true
    expect(pauseSwitch(read.charter.charter).enabled).toBe(true);
    expect(charterStatus(read.charter.charter).key).toBe('approved');
  });

  it('every read answering clears the poll error', async () => {
    const settled = await Promise.allSettled(READS.map(() => Promise.resolve({})));
    expect(settleReads(READS, settled).error).toBeNull();
  });

  it('two failures are both said, in order', async () => {
    const settled = await Promise.allSettled([
      Promise.reject(new Error('Could not read the charter: 500.')),
      Promise.resolve({}),
      Promise.reject(new Error('Could not read the wake ledger: 500.')),
      Promise.resolve({}),
    ]);
    expect(settleReads(READS, settled).error).toBe('Could not read the charter: 500. · Could not read the wake ledger: 500.');
  });
});

describe('a charter not read yet is not "no charter"', () => {
  it('the standing says so, and PAUSE waits for the read', () => {
    expect(charterStatus(undefined)).toMatchObject({ key: 'unread', words: 'CHARTER NOT READ YET' });
    expect(pauseSwitch(undefined)).toMatchObject({ label: 'PAUSE', enabled: false, title: 'The charter has not been read yet' });
    expect(charterStatus(null).key).toBe('none');
  });

  it('the window offers no WRITE A CHARTER and no EDIT before the charter is read', () => {
    const html = render({ charter: undefined });
    expect(html).toContain('CHARTER NOT READ YET');
    expect(html).not.toContain('NO CHARTER');
    expect(html).not.toContain('WRITE A CHARTER');
    expect(html).not.toContain('>EDIT<');
    // read and truly absent: the operator may write one
    expect(render({ charter: null })).toContain('WRITE A CHARTER');
  });
});

describe('a poll error is its own line', () => {
  it('the head carries the poll error and the act refusal apart', () => {
    const html = render({ charter: approved, pollError: 'Could not read the wake queue: 500.', error: 'Could not pause the house: 409.' });
    expect(html).toContain('data-error="poll"');
    expect(html).toContain('Could not read the wake queue: 500.');
    expect(html).toContain('data-error="act"');
    expect(html).toContain('Could not pause the house: 409.');
    // the reads answered again: no poll line stays behind
    expect(render({ charter: approved, pollError: null, error: null })).not.toContain('hclock-error');
  });
});
