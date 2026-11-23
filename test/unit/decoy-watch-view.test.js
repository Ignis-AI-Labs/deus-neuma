// decoy-watch-view.test.js — the SECURITY window's DECOYS section: the line
// it shows (pure helpers, real inputs) and the section rendered for real
// (react-dom/server) over a status shaped the way tripwire.js answers one.
//
// NOT proven here: the section on the live desk (a press of the button, the
// fold opening on a frozen program).

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { decoyStats, decoyRows, frozenRows, decoysWait } from '../../frontend/app/RelinkShell/decoy-watch-view.js';
import { DecoyWatchBody } from '../../frontend/app/RelinkShell/DecoyWatchBody.jsx';

const OFF = {
  supported: true, enabled: false, mode: 'off', frozen: [], lastIncident: null,
  decoys: [{ id: 'solana', name: 'Solana key', status: 'none', reason: null, files: [] }],
};
const ON = {
  supported: true, enabled: true, mode: 'inotify', lastIncident: { at: '2026-11-20T12:00:00.000Z', title: 'A decoy wallet file was opened: Solana key', severity: 'critical' },
  frozen: [{ pid: 4242, startedAtMs: 1, exe: '/usr/bin/node', comm: 'node', script: '/tmp/pkg/postinstall.js', at: '2026-11-20T12:00:01.000Z' }],
  decoys: [
    { id: 'solana', name: 'Solana key', status: 'planted', reason: null, files: ['/home/a/.config/solana/id.json'] },
    { id: 'aws', name: 'AWS credentials', status: 'skipped', reason: 'the real app already has a folder there', files: [] },
  ],
};

const render = (state, extra = {}) => renderToStaticMarkup(createElement(DecoyWatchBody, {
  state, busy: false, error: null, onToggle: () => {}, onRelease: () => {}, ...extra,
}));

describe('the DECOYS line', () => {
  it('says its state and counts in words', () => {
    expect(decoyStats(null)).toEqual(['—']);
    expect(decoyStats({ supported: false })).toEqual(['LINUX ONLY FOR NOW']);
    expect(decoyStats(OFF)).toEqual(['OFF']);
    expect(decoyStats(ON)).toEqual([
      { text: 'ON', tone: 'on' }, '1 OF 2 PLANTED', { text: 'SEES AN OPEN AT ONCE', tone: 'on' }, { text: '1 FROZEN', tone: 'alert' },
    ]);
    expect(decoyStats({ ...ON, mode: 'blind', frozen: [] })[2]).toEqual({ text: 'CANNOT SEE READS ON THIS DISK', tone: 'alert' });
  });

  it('waits on the operator only while a program is frozen', () => {
    expect(decoysWait(OFF)).toBe(false);
    expect(decoysWait(ON)).toBe(true);
    expect(decoysWait(null)).toBe(false);
  });

  it('a row per decoy: where it stands, or why it does not', () => {
    expect(decoyRows(ON)).toEqual([
      { id: 'solana', name: 'Solana key', status: 'PLANTED', planted: true, where: '/home/a/.config/solana/id.json' },
      { id: 'aws', name: 'AWS credentials', status: 'SKIPPED', planted: false, where: 'the real app already has a folder there' },
    ]);
    expect(frozenRows(ON)).toEqual([{ pid: 4242, program: '/usr/bin/node running /tmp/pkg/postinstall.js', at: '2026-11-20T12:00:01.000Z' }]);
  });
});

describe('the DECOYS section, rendered', () => {
  it('off: one line, and the press that turns it on', () => {
    const html = render(OFF);
    expect(html).toContain('DECOYS');
    expect(html).toContain('TURN ON AND PLANT THE DECOYS');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('<table');
  });

  it('on with a frozen program: opens, names it, and offers the release by name', () => {
    const html = render(ON);
    expect(html).toMatch(/<details[^>]*open/);
    expect(html).toContain('1 FROZEN');
    expect(html).toContain('/usr/bin/node running /tmp/pkg/postinstall.js');
    expect(html).toContain('aria-label="Release /usr/bin/node running /tmp/pkg/postinstall.js, process 4242"');
    expect(html).toContain('TURN OFF AND REMOVE THE DECOYS');
    expect(html).toContain('/home/a/.config/solana/id.json');
    expect(html).toContain('A decoy wallet file was opened: Solana key');
  });

  it('a refusal is shown as it stands, as an alert', () => {
    const html = render(OFF, { error: "This computer's settings belong to its owner." });
    expect(html).toContain('role="alert"');
    expect(html).toContain('This computer&#x27;s settings belong to its owner.');
  });

  it('another system: says so, and offers no switch', () => {
    const html = render({ supported: false, enabled: false, mode: 'off', decoys: [], frozen: [], lastIncident: null });
    expect(html).toContain('LINUX ONLY FOR NOW');
    expect(html).not.toContain('<button');
  });
});
