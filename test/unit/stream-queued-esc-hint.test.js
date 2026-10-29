/**
 * The held word's Escape hint (owner, 2026-10-23: […]): only the NEWEST queued bubble says ESC TAKES IT BACK —
 * Escape's first tap pulls that one (StreamInput's ladder) — and only while the doors are live.
 * Rendered for real (react-dom/server, no mocks).
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueuedWordDoors, newestHoldId } from '../../frontend/app/RelinkShell/QueuedWordDoors.jsx';

describe('ESC TAKES IT BACK on the held word', () => {
  it('names the newest queued word only', () => {
    const messages = [
      { id: 'm1', role: 'user' },
      { id: 'm2', role: 'user', queued: true, holdId: 'h1' },
      { id: 'm3', role: 'neuma' },
      { id: 'm4', role: 'user', queued: true, holdId: 'h2' },
    ];
    expect(newestHoldId(messages)).toBe('h2');
    expect(newestHoldId([{ id: 'x', queued: false, holdId: 'h9' }])).toBe(null);
    expect(newestHoldId(undefined)).toBe(null);
  });

  it('the newest bubble shows the hint beside QUEUED and SEND NOW; the others do not', () => {
    const newest = renderToStaticMarkup(createElement(QueuedWordDoors, { holdId: 'h2', onQueueNow: () => {}, escTakesBack: true }));
    expect(newest).toMatch(/QUEUED.*SEND NOW.*ESC TAKES IT BACK/);
    expect(newest).toContain('Esc takes this message out of the queue');
    const older = renderToStaticMarkup(createElement(QueuedWordDoors, { holdId: 'h1', onQueueNow: () => {} }));
    expect(older).toContain('QUEUED');
    expect(older).not.toContain('ESC TAKES IT BACK');
  });
});
