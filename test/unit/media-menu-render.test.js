// The media menu as a person reads it: the production CtxMenu rows rendered
// (react-dom/server) from the production menu model — settings say whether
// they are on, the speed page marks the current speed, and an item that cannot
// apply is simply not there.
import { describe, test, expect, beforeAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mediaMenuItems, speedMenuItems } from '../../frontend/app/RelinkShell/media-menu.js';

let CtxMenuRows;
beforeAll(async () => {
  // The sound engine registers a module-level `window` listener on import — a
  // browser fact a static render never exercises.
  globalThis.window = globalThis.window ?? { addEventListener: () => {}, dispatchEvent: () => true, requestIdleCallback: () => {} };
  ({ CtxMenuRows } = await import('../../frontend/app/RelinkShell/CtxMenu.jsx'));
});

const rows = (items) => renderToStaticMarkup(createElement('div', null, createElement(CtxMenuRows, {
  items, sel: -1, onHover: () => {}, onPick: () => {},
})));
const labels = (html) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

describe('the media menu, rendered', () => {
  test('a forge clip on a card: the browser\'s options and the two ways home, in plain words', () => {
    const html = rows(mediaMenuItems(
      { kind: 'video', src: 'blob:x', path: '/srv/house/lanes/orla/art/images/3f2b8c1e-9a4d-4c6b-8e2f-1a2b3c4d5e6f.mp4' },
      { player: { paused: false, muted: false, loop: true, controls: true, rate: 1, pip: true, pipOn: false }, fullscreen: true },
    ));
    expect(labels(html)).toEqual([
      'View full screen', 'Picture in picture',
      'Pause', 'Mute', 'Loop', 'Show controls', 'Playback speed: Normal  ›',
      'Open in gallery', 'Show in files',
      'Download', 'Copy path',
    ]);
    expect(html.match(/class="cmenu-sep"/g)).toHaveLength(3);
    // The two settings say they are ON, to a screen reader and to the eye.
    expect(html).toMatch(/role="menuitemcheckbox" aria-checked="true" class="cmenu-item is-checked">Loop</);
    expect(html).toMatch(/role="menuitemcheckbox" aria-checked="true" class="cmenu-item is-checked">Show controls</);
    expect(html).toMatch(/role="menuitem" class="cmenu-item">Open in gallery</);
  });

  test('loop off reads as an unchecked setting, not a missing one', () => {
    const html = rows(mediaMenuItems({ kind: 'video', src: 'blob:x' }, { player: { paused: true, muted: true, loop: false, controls: true, rate: 2, pip: false, pipOn: false } }));
    expect(html).toMatch(/aria-checked="false" class="cmenu-item">Loop</);
    expect(labels(html)).toEqual(['Play', 'Unmute', 'Loop', 'Show controls', 'Playback speed: 2×  ›', 'Download']);
  });

  test('the speed page marks only the current speed', () => {
    const html = rows(speedMenuItems(1.25));
    expect(labels(html)[0]).toBe('‹  Playback speed');
    expect(html.match(/is-checked/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true" class="cmenu-item is-checked">1.25×</);
  });

  test('a pasted picture with no file shows no folder, no path and no gallery', () => {
    const html = rows(mediaMenuItems({ kind: 'image', src: 'data:image/png;base64,AA==' }, { canCopyImage: true }));
    expect(labels(html)).toEqual(['View full screen', 'Download', 'Copy image']);
    expect(html).not.toMatch(/disabled/);
  });
});
