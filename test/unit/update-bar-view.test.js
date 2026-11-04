/**
 * The desk's update bar and WHAT'S NEW panel, rendered for real (react-dom/server, no mocks):
 * one primary act per install form, WHAT'S NEW and later beside it, the notes the bar module
 * selects from a REAL release notes file, and the plain sentence when a version has none.
 * The bridge and IPC behind them are proven in real Electron by scripts/prove-update-bar.mjs.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { UpdateBarView, WhatsNewPanel } from '../../frontend/app/RelinkShell/UpdateBar.jsx';

const require = createRequire(import.meta.url);
const { barFor } = require('../../electron/update-notes.cjs');

const REPO = path.resolve(import.meta.dirname, '../..');
// the shipped 0.1.54 notes, frozen as they went out (test/fixtures/release-notes/)
const notes54 = fs.readFileSync(path.join(REPO, 'test/fixtures/release-notes/release-notes-0.1.54.md'), 'utf8');
const noop = () => {};
const render = (el) => renderToStaticMarkup(el);
const buttons = (html) => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));

describe('UpdateBarView', () => {
  it('a downloaded update: the version, RESTART TO UPDATE as the one primary act, WHAT\'S NEW, later', () => {
    const bar = barFor({ form: 'self', ready: true, availableVersion: '0.1.54', notes: notes54 }, { current: '0.1.49', dismissed: null });
    const html = render(createElement(UpdateBarView, { bar, pending: null, refused: null, onAct: noop, onNotes: noop }));
    expect(html).toContain('0.1.54</span> IS READY');
    expect(buttons(html)).toEqual(['RESTART TO UPDATE', 'WHAT&#x27;S NEW', 'later']);
    expect(html.match(/btn-primary/g)).toHaveLength(1);
    expect(html).toContain('role="status"');
  });

  it('a system package: DOWNLOAD, saying it opens the downloads page', () => {
    const bar = barFor({ form: 'notify', ready: false, availableVersion: '0.1.54', notes: null }, { current: '0.1.49', dismissed: null });
    const html = render(createElement(UpdateBarView, { bar, pending: null, refused: null, onAct: noop, onNotes: noop }));
    expect(html).toContain('0.1.54</span> IS OUT');
    expect(buttons(html)[0]).toBe('DOWNLOAD');
    expect(html).toContain('Opens the downloads page');
  });

  it('every press answers: the act in flight, and a refusal in words', () => {
    const bar = { version: '0.1.54', action: 'restart', notes: [] };
    const busy = render(createElement(UpdateBarView, { bar, pending: 'restart', refused: null, onAct: noop, onNotes: noop }));
    expect(buttons(busy)[0]).toBe('RESTARTING…');
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>.*RESTARTING/);
    const refused = render(createElement(UpdateBarView, { bar, pending: null, refused: 'no downloaded update to install', onAct: noop, onNotes: noop }));
    expect(refused).toContain('no downloaded update to install');
  });
});

describe('WhatsNewPanel', () => {
  it('shows each unseen version\'s section from the real notes, never the standing description', () => {
    const bar = barFor({ form: 'self', ready: true, availableVersion: '0.1.54', notes: notes54 }, { current: '0.1.39', dismissed: null });
    const html = render(createElement(WhatsNewPanel, { title: 'WHAT\'S NEW IN 0.1.54', version: '0.1.54', notes: bar.notes, bar, pending: null, onAct: noop, onClose: noop }));
    expect(html).toContain('NEW IN 0.1.54');
    expect(html).toContain('NEW IN 0.1.49');
    expect(html).not.toContain('NEW IN 0.1.39');
    expect(html).toContain('The first screen leads with the model.');
    expect(html).not.toContain('What you need');
    expect(buttons(html)).toEqual(['RESTART TO UPDATE', 'CLOSE']);
    expect(html).toContain('role="dialog"');
  });

  it('one version: its notes with no per-version heading', () => {
    const html = render(createElement(WhatsNewPanel, { title: 'NOW RUNNING 0.1.54 · WHAT\'S NEW', version: '0.1.54', notes: [{ version: '0.1.54', body: '- **One.** A thing.' }], onClose: noop }));
    expect(html).not.toContain('NEW IN 0.1.54');
    expect(html).toContain('<strong>One.</strong>');
    expect(buttons(html)).toEqual(['CLOSE']);
  });

  it('a version with no notes says so plainly', () => {
    const html = render(createElement(WhatsNewPanel, { title: 'WHAT\'S NEW IN 0.1.56', version: '0.1.56', notes: [], onClose: noop }));
    expect(html).toContain('No release notes were published for 0.1.56.');
  });

  it('notes are text: markup in them never becomes markup', () => {
    const html = render(createElement(WhatsNewPanel, { title: 't', version: '0.1.56', notes: [{ version: '0.1.56', body: '<img src=x onerror=alert(1)> plain' }], onClose: noop }));
    expect(html).not.toContain('<img');
    expect(html).toContain('plain');
  });
});
