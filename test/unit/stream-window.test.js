/**
 * A long chat draws its recent tail first (use-stream-window.js) — the real
 * StreamPanel rendered (renderToStaticMarkup, the stream-panel-retry.test.js
 * pattern): forty messages drawn, the earlier ones counted above them.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { tailStart, STREAM_WINDOW } from '../../frontend/app/RelinkShell/use-stream-window.js';

let StreamPanel;
beforeAll(async () => {
  // The import graph's module-level browser facts — provisioned, never exercised.
  globalThis.window = globalThis.window ?? { addEventListener: () => {}, dispatchEvent: () => true, requestIdleCallback: () => {} };
  globalThis.localStorage = globalThis.localStorage ?? { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  ({ StreamPanel } = await import('../../frontend/app/RelinkShell/StreamPanel.jsx'));
});

const chat = (n) => Array.from({ length: n }, (_, i) => ({
  id: `m-${i}`, role: i % 2 ? 'neuma' : 'user', streaming: false, isHistory: true, at: null,
  segments: [{ kind: 'speech', text: `message number ${i}` }], meta: null,
}));
const render = (messages) => renderToStaticMarkup(createElement(StreamPanel, {
  messages, thread: 0, thinking: false, connected: true, onRetry: () => {}, onTakeSwitch: () => {},
}));

describe('the stream draws a long chat from its tail', () => {
  it('the window starts forty from the end, never before the first message', () => {
    expect(STREAM_WINDOW).toBe(40);
    expect(tailStart(227)).toBe(187);
    expect(tailStart(12)).toBe(0);
  });

  it('a 100-message chat draws its last forty, the sixty before them counted', () => {
    const html = render(chat(100));
    expect(html).toContain('60 EARLIER MESSAGES · SHOW');
    expect(html).toContain('message number 99');
    expect(html).toContain('message number 60');
    expect(html).not.toContain('message number 59<');
    expect(html).toContain('SESSION RESUMED');
  });

  it('a short chat draws whole, with nothing to show earlier', () => {
    const html = render(chat(12));
    expect(html).not.toContain('EARLIER MESSAGE');
    expect(html).toContain('message number 0');
  });
});
