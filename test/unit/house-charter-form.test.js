/**
 * The charter form says what a choice means where the operator makes it
 * (RULE 0, nothing faked): the pure words, and the form rendered for real
 * (react-dom/server) over a draft built the way the window builds it.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { draftFromCharter, OPTIO_SEAT_NOTE, cadenceCapWarning } from '../../frontend/app/RelinkShell/house-clock/house-clock-view.js';
import { CharterSection } from '../../frontend/app/RelinkShell/house-clock/CharterSection.jsx';
import { normalizeCharter } from '../../backend/services/house-clock/charter-shape.js';

const NAMES = { optio: 'Cael', mate: 'Quae' };
const LANES = [{ neumaId: 'optio' }, { neumaId: 'mate' }];
const charter = normalizeCharter({ goal: 'Ship one digest a week.', seats: [{ laneId: 'optio', dailyCap: 3 }, { laneId: 'mate', dailyCap: 3 }], cadence: { everyHours: 24 } });
const noop = () => {};
const form = (props) => renderToStaticMarkup(createElement(CharterSection, {
  charter, history: [], names: NAMES, draft: draftFromCharter(charter, LANES), busy: false, optio: 'optio',
  onEdit: noop, onDraft: noop, onSeat: noop, onSave: noop, onCancel: noop, onApprove: noop, ...props,
}));

describe('the charter form — the Optio\'s seat', () => {
  it('beside the Optio\'s own seat: what the office does, and that it is the member\'s to accept', () => {
    expect(OPTIO_SEAT_NOTE).toMatch(/CLEAR lets one go on, HOLD brings it to you/);
    expect(OPTIO_SEAT_NOTE).toMatch(/the desk does not ask them for you/);
    const html = form({});
    expect(html.match(/data-optio-note/g)).toHaveLength(1);
    expect(html).toContain(OPTIO_SEAT_NOTE.replace(/'/g, '&#x27;'));
    // beside her row, not another member's
    expect(html.indexOf('data-optio-note')).toBeGreaterThan(html.indexOf('Cael may wake'));
    expect(html.indexOf('data-optio-note')).toBeLessThan(html.indexOf('Quae may wake'));
  });

  it('no Optio seated: no note on any seat', () => {
    expect(form({ optio: null })).not.toContain('data-optio-note');
  });
});

describe('the charter form — a review cadence past the Optio\'s daily limit', () => {
  const draft = (patch = {}, cap = '3') => {
    const d = draftFromCharter(charter, LANES);
    return { ...d, ...patch, seats: { ...d.seats, optio: { ...d.seats.optio, cap } } };
  };
  it('said when the cadence wakes her more times a day than her limit lets her; nothing when it fits', () => {
    expect(cadenceCapWarning(draft({ cadenceHours: '6' }), 'optio', NAMES))
      .toBe('A REVIEW EVERY 6 HOURS WAKES CAEL UP TO 4 TIMES A DAY — CAEL\'S DAILY LIMIT IS 3. Past it, a review waits for the next day, and every other wake of theirs counts against the same limit.');
    expect(cadenceCapWarning(draft({ cadenceHours: '5' }), 'optio', NAMES)).toMatch(/UP TO 5 TIMES A DAY/);
    expect(cadenceCapWarning(draft({ cadenceHours: '8' }), 'optio', NAMES)).toBeNull();
    expect(cadenceCapWarning(draft({ cadenceHours: '24' }), 'optio', NAMES)).toBeNull();
    expect(cadenceCapWarning(draft({ cadenceHours: '1' }, '24'), 'optio', NAMES)).toBeNull();
  });
  it('nothing when no cadence is on, the Optio holds no seat in the draft, or none is seated', () => {
    expect(cadenceCapWarning(draft({ cadenceHours: '1', cadenceOn: false }), 'optio', NAMES)).toBeNull();
    const off = draft({ cadenceHours: '1' });
    expect(cadenceCapWarning({ ...off, seats: { ...off.seats, optio: { on: false, cap: '3' } } }, 'optio', NAMES)).toBeNull();
    expect(cadenceCapWarning(draft({ cadenceHours: '1' }), null, NAMES)).toBeNull();
    // a half-typed number is the server's to refuse, not a warning
    expect(cadenceCapWarning(draft({ cadenceHours: '' }), 'optio', NAMES)).toBeNull();
  });
  it('the form says it above SAVE — a warning, never a refusal: SAVE stays open', () => {
    const html = form({ draft: draft({ cadenceHours: '2' }) });
    expect(html).toContain('data-warn="cadence-cap"');
    expect(html).toContain('A REVIEW EVERY 2 HOURS WAKES CAEL UP TO 12 TIMES A DAY');
    expect(html.indexOf('data-warn="cadence-cap"')).toBeLessThan(html.indexOf('>SAVE<'));
    expect(html).not.toMatch(/<button type="submit"[^>]*disabled/);
    expect(form({})).not.toContain('data-warn="cadence-cap"');
  });
});
