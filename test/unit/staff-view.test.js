// staff-view.test.js — the CHIEF OF STAFF window's display law, proven two
// ways: the pure helpers with real inputs and outputs (RULE 0), and the
// whole pane rendered for real (react-dom/server) over data shaped exactly
// like the server's own responses — the seat, the roster, the dispatches.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  seatLine, seatHeldLine, holderNameFor, holderLabel, seatTitleLabel, isOfficeHolder,
  postsLine, postLine, planSummary, runStatusLabel, runRegister, runLine, activityStatusWords,
} from '../../frontend/app/RelinkShell/staff-view.js';
import { StaffBody } from '../../frontend/app/RelinkShell/StaffBody.jsx';

const SEAT = { laneId: 'optio-lane', designatedAt: '2026-09-13T06:00:00.000Z' };
const LANES = [
  { neumaId: 'optio-lane', name: 'Cael' },
  { neumaId: 'faber-lane', name: 'Aethon' },
];

const render = (props) => renderToStaticMarkup(createElement(StaffBody, {
  seat: null, board: null, lanes: LANES, pick: '', busy: false, error: null,
  confirmClear: false,
  onPick: () => {}, onSeat: () => {}, onAskClear: () => {}, onClear: () => {}, onCancelClear: () => {},
  ...props,
}));

describe('staff-view — the display law, pure', () => {
  it('the seat line: empty office, or the holder and since-when', () => {
    expect(seatLine(null, null)).toBe('THE OFFICE STANDS EMPTY');
    expect(seatLine(SEAT, 'Cael')).toContain('CAEL');
    expect(seatLine(SEAT, 'Cael')).toContain('SINCE');
    expect(seatLine(SEAT, null)).toContain('OPTIO-LANE');
    expect(seatHeldLine(SEAT, 'Cael')).toContain('HELD BY CAEL');
  });

  it('the roster holder: the kind-0 seat is the OPERATOR, never "witness"', () => {
    expect(holderLabel({ isWitness: true })).toBe('OPERATOR');
    expect(holderLabel({ isWitness: false, name: 'Aethon', neumaId: 'faber-lane' })).toBe('Aethon');
    expect(holderLabel({ isWitness: false, name: null, neumaId: 'faber-lane' })).toBe('faber-lane');
    expect(holderLabel({ isWitness: false, name: null, neumaId: null })).toBe('NO LANE ON THIS SEAT');
  });

  it('holder lookup and the office mark', () => {
    expect(holderNameFor(SEAT, LANES)).toBe('Cael');
    expect(holderNameFor(SEAT, [])).toBeNull();
    expect(holderNameFor(null, LANES)).toBeNull();
    expect(isOfficeHolder({ neumaId: 'optio-lane' }, SEAT)).toBe(true);
    expect(isOfficeHolder({ neumaId: 'faber-lane' }, SEAT)).toBe(false);
    expect(isOfficeHolder({ neumaId: 'optio-lane' }, null)).toBe(false);
  });

  it('the inbox line: clear, counted, torn flagged', () => {
    expect(postsLine(null)).toBe('THE OFFICE INBOX IS CLEAR');
    expect(postsLine({ count: 0, torn: 0 })).toBe('THE OFFICE INBOX IS CLEAR');
    expect(postsLine({ count: 1, torn: 0 })).toBe('1 DISPATCH WAITS');
    expect(postsLine({ count: 3, torn: 1 })).toBe('3 DISPATCHES WAIT · 1 TORN');
  });

  it('one dispatch reads who, what it answers, the body', () => {
    expect(postLine({ from: 'aethon', re: 'the launch', body: 'ready when you are' }))
      .toBe('aethon — "the launch": ready when you are');
    expect(postLine({ from: 'aethon', body: 'no subject' })).toBe('aethon: no subject');
    expect(postLine({})).toBe('UNKNOWN: ');
  });

  it('the standing plan of record, or null', () => {
    expect(planSummary(null)).toBeNull();
    const one = planSummary({ name: 'launch push', goal: 'ship the announcement', steps: [{}], approvedAt: '2026-09-13T06:30:00.000Z' });
    expect(one.title).toBe('launch push');
    expect(one.detail).toContain('ship the announcement');
    expect(one.detail).toContain('1 STEP —');
    expect(planSummary({ goal: 'g', steps: [{}, {}] }).detail).toContain('2 STEPS');
    expect(planSummary({ steps: [] }).title).toBe('THE STANDING PLAN');
  });

  it('run status: words, register, line', () => {
    expect(runStatusLabel('needs_operator')).toBe('NEEDS OPERATOR');
    expect(runStatusLabel(undefined)).toBe('UNKNOWN');
    expect(runRegister('running')).toBe('live');
    expect(runRegister('failed')).toBe('loud');
    // a run cut off with its backend, or settled as an error, did not finish its work either
    expect(runRegister('lost')).toBe('loud');
    expect(runRegister('error')).toBe('loud');
    expect(runRegister('stopped')).toBe('quiet');
    expect(runRegister('done')).toBe('quiet');
    expect(runLine({ id: 'r1', status: 'running' })).toBe('r1 — RUNNING (IN FLIGHT)');
    expect(runLine({ id: 'r2', name: 'night run', status: 'done', finishedAt: '2026-09-13T07:00:00.000Z' }))
      .toContain('night run — DONE, FINISHED');
  });

  it('the activity chip says a wake\'s two states in words; a charge keeps its own', () => {
    expect(activityStatusWords('awake')).toBe('awake');
    expect(activityStatusWords('waiting')).toBe('waiting for the model');
    expect(activityStatusWords('working')).toBe('working');
    expect(activityStatusWords(undefined)).toBe('unknown');
  });
});

describe('StaffBody — the pane rendered for real', () => {
  it('unseated: the announcement stands, the sections read honest empty states', () => {
    const html = render();
    expect(html).toContain('NO CHIEF OF STAFF SEATED');
    expect(html).toContain('THE OFFICE STANDS EMPTY');
    expect(html).toContain('SEAT A CHIEF OF STAFF AND THE HOUSE READS HERE');
    expect(html).toContain('THE BOARD READS ONCE THE OFFICE IS SEATED');
  });

  it('seated: the roster shows the OPERATOR and the office mark, dispatches read live', () => {
    const board = {
      cos: SEAT,
      roster: {
        houseName: 'ignis', roster: [
          { title: 'Rector', neumaId: null, name: null, isWitness: true },
          { title: 'Optio', neumaId: 'optio-lane', name: 'Cael', isWitness: false },
        ],
      },
      posts: { count: 2, torn: 0, recent: [{ from: 'aethon', body: 'the build is green' }] },
      plan: { name: 'launch push', goal: 'ship it', steps: [{}, {}], approvedAt: '2026-09-13T06:30:00.000Z' },
      runs: [{ id: 'r1', name: 'night run', status: 'running' }],
    };
    const html = render({ seat: SEAT, board });
    expect(html).toContain('HELD BY CAEL');
    expect(html).toContain('OPERATOR');
    expect(html).toContain('THE OPTIO');
    expect(html).toContain('2 DISPATCHES WAIT');
    expect(html).toContain('aethon: the build is green');
    expect(html).toContain('LAUNCH PUSH');
    expect(html).toContain('night run — RUNNING (IN FLIGHT)');
  });

  it('a member no founding record seats renders untitled — an unfounded house\'s roster never crashes the pane (ruling, 2026-10-18)', () => {
    expect(seatTitleLabel({ title: 'Faber' })).toBe('FABER');
    expect(seatTitleLabel({ title: null })).toBe('NO SEAT ON-CHAIN');
    const board = {
      cos: SEAT,
      roster: {
        houseName: 'fixture', founded: false, roster: [
          { title: null, neumaId: 'optio-lane', name: 'Corvane', isWitness: false },
          { title: null, neumaId: 'faber-lane', name: 'Ithel', isWitness: false },
        ],
      },
      posts: { count: 0, torn: 0, recent: [] }, plan: null, runs: [],
    };
    const html = render({ seat: SEAT, board });
    expect(html).toContain('HOUSE FIXTURE');
    expect(html).toContain('NO SEAT ON-CHAIN');
    expect(html).toContain('Ithel');
    expect(html).toContain('THE OPTIO');
  });

  it('a run lost with its backend reads loud in the run list, like a failed one', () => {
    const board = {
      cos: SEAT, roster: null, posts: { count: 0, torn: 0, recent: [] }, plan: null,
      runs: [{ id: 'r-lost', name: 'cut off', status: 'lost' }, { id: 'r-done', name: 'finished', status: 'done' }],
    };
    const html = render({ seat: SEAT, board });
    expect(html).toContain('<li class="staff-run label-data is-loud"><span class="staff-tag is-loud label-data">LOST</span>');
    expect(html).toContain('<li class="staff-run label-data is-quiet"><span class="staff-tag is-quiet label-data">DONE</span>');
  });

  it('a standing plan offers END PLAN, and the deliberate second step names what ending does', () => {
    const board = {
      cos: SEAT, roster: null, posts: { count: 0, torn: 0, recent: [] }, runs: [],
      plan: { name: 'gap-validation-sprint', goal: 'validate', steps: [{}], approvedAt: '2026-10-10T03:00:00.000Z' },
    };
    const asked = render({ seat: SEAT, board });
    expect(asked).toContain('END PLAN');
    expect(asked).not.toContain('end this plan?');
    const confirming = render({ seat: SEAT, board, confirmEndPlan: true });
    expect(confirming).toContain('end this plan? Its record is kept');
    expect(confirming).toContain('CANCEL');
    const none = render({ seat: SEAT, board: { ...board, plan: null } });
    expect(none).not.toContain('END PLAN');
  });

  it('seated without a founding receipt: the roster says so plainly', () => {
    const html = render({ seat: SEAT, board: { cos: SEAT, roster: null, posts: { count: 0, torn: 0, recent: [] }, plan: null, runs: [] } });
    expect(html).toContain('NO FOUNDING RECEIPT SEATS THE OFFICE YET');
    expect(html).toContain('THE OFFICE INBOX IS CLEAR');
    expect(html).toContain('NO STANDING PLAN OF RECORD');
    expect(html).toContain('NONE RECORDED');
  });
});
