// team-board.test.js — the shared status board: extraction, objective state,
// and the rendered form every coordinated brief carries. Pure throughout.
import { describe, it, expect } from 'vitest';
import { STATUS_ASK, extractStatus, boardEntries, renderBoard } from '../../backend/services/team-board.js';

describe('extractStatus (pure)', () => {
  it('splits the check-in from the work product and strips the marker', () => {
    const { body, status } = extractStatus('The summary is done.\nSTATUS:\nsummary complete\nnothing left\nhand off to writer');
    expect(body).toBe('The summary is done.');
    expect(status).toBe('summary complete\nnothing left\nhand off to writer');
  });

  it('a reply without a check-in has none — never invented', () => {
    const { body, status } = extractStatus('Just the work.');
    expect(body).toBe('Just the work.');
    expect(status).toBeNull();
  });

  it('a STATUS: line INSIDE fenced code is work product, not a check-in', () => {
    const code = 'Here is the logger:\n```js\nconsole.log("STATUS: ok");\n```';
    const { body, status } = extractStatus(code);
    expect(body).toBe(code);
    expect(status).toBeNull();
  });

  it('only a marker AFTER the last fence counts, and the LAST marker wins', () => {
    const out = '```js\nrun();\n```\nSTATUS:\nfirst\nSTATUS:\nengine solid, handing to integrator';
    const { body, status } = extractStatus(out);
    expect(status).toBe('engine solid, handing to integrator');
    expect(body).toContain('run();');
  });

  it('a bare marker with nothing after it is an empty check-in (null)', () => {
    expect(extractStatus('work\nSTATUS:').status).toBeNull();
    expect(extractStatus(null).body).toBe('');
  });
});

describe('boardEntries (pure) — objective state never lies', () => {
  const steps = [
    { id: 'a', neumaId: 'n-a', role: 'HELM' },
    { id: 'b', neumaId: 'n-b', role: null },
    { id: 'c', neumaId: 'n-c', role: 'WARDEN' },
  ];

  it('done beats working beats waiting, and statuses ride along', () => {
    const entries = boardEntries({
      steps,
      results: { a: 'out' },
      working: new Set(['b']),
      statuses: { a: 'spec shipped' },
    });
    expect(entries).toEqual([
      { id: 'a', neumaId: 'n-a', role: 'HELM', state: 'done', status: 'spec shipped' },
      { id: 'b', neumaId: 'n-b', role: null, state: 'working', status: null },
      { id: 'c', neumaId: 'n-c', role: 'WARDEN', state: 'waiting', status: null },
    ]);
  });
});

describe('renderBoard (pure) — the check-in surface a brief carries', () => {
  it('marks the reader, shows objective state, and indents check-ins verbatim inside the untrusted frame', () => {
    const board = renderBoard([
      { id: 'a', role: 'HELM', neumaId: 'n', state: 'done', status: 'spec shipped\nnothing left' },
      { id: 'b', role: null, neumaId: 'n2', state: 'working', status: null },
    ], 'b', 'feedfacecafe');
    expect(board.startsWith('TEAM BOARD — where everyone stands right now:\nNOTICE:')).toBe(true);
    expect(board.endsWith(
      '— HELM [DONE]\n--- BEGIN EXTERNAL CONTENT feedfacecafe ---\n    spec shipped\n    nothing left\n'
      + '--- END EXTERNAL CONTENT feedfacecafe ---\n— b (YOU) [WORKING]'
    )).toBe(true);
  });

  it('a board with no check-ins renders plain — no notice about nothing', () => {
    expect(renderBoard([
      { id: 'a', role: 'HELM', neumaId: 'n', state: 'working', status: null },
    ], 'a')).toBe('TEAM BOARD — where everyone stands right now:\n— HELM (YOU) [WORKING]');
  });
});

describe('STATUS_ASK', () => {
  it('asks for exactly the board fields: where it stands, to-do, hand-off', () => {
    expect(STATUS_ASK).toContain('"STATUS:"');
    expect(STATUS_ASK).toMatch(/to-do list/);
    expect(STATUS_ASK).toMatch(/hand/);
  });
});
