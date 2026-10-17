/**
 * THE LIVE PARTIAL LINE — rendered (real server render, no mocks — the
 * stream-panel-retry.test.js pattern: renderToStaticMarkup against the real
 * StreamPanel tree, fed by the REAL stream-reducer so the message under
 * render is the one the reducer actually mints).
 *
 * Pinned here:
 *   - a VOICE_PARTIAL message renders as a TRANSIENT line (is-transient)
 *     carrying the heard words — the operator sees the lane hearing them
 *   - once the utterance retires it (VOICE_UTTERANCE) and the ordinary send
 *     path bubbles the words (USER_SENT), the stream holds exactly ONE
 *     non-transient bubble — the partial is gone, no double-bubble
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { reducer, initialState } from '../../frontend/app/RelinkShell/stream-reducer.js';

// The desk's sound engine registers a module-level `window` listener on
// import — a browser fact, not part of the render path under test (no sound
// plays in a static render). Provisioned, never exercised (precedent:
// stream-panel-retry.test.js).
let StreamPanel;
beforeAll(async () => {
  globalThis.window = globalThis.window ?? { addEventListener: () => {}, dispatchEvent: () => true };
  globalThis.localStorage = globalThis.localStorage ?? {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
  };
  ({ StreamPanel } = await import('../../frontend/app/RelinkShell/StreamPanel.jsx'));
});

const run = (actions) => actions.reduce(reducer, initialState);

const render = (state) =>
  renderToStaticMarkup(createElement(StreamPanel, {
    messages: state.messages,
    thread: state.thread,
    thinking: state.thinking,
    connected: true,
    onRetry: () => {},
    onTakeSwitch: () => {},
  }));

describe('StreamPanel — the live voice partial line', () => {
  it('a partial renders TRANSIENT with the heard words, beside the settled record', () => {
    const state = run([
      { type: 'USER_SENT', text: 'earlier thought' },
      { type: 'SPEECH', text: 'earlier answer' },
      { type: 'COMPLETE', metadata: null },
      { type: 'VOICE_PARTIAL', text: 'the portal is open' },
    ]);
    const html = render(state);
    expect(html).toContain('the portal is open');
    expect(html).toContain('is-transient');
    // The settled conversation above it renders untouched.
    expect(html).toContain('earlier thought');
    expect(html).toContain('earlier answer');
    // Exactly one transient line — each partial replaces the last.
    expect(html.match(/is-transient/g)).toHaveLength(1);
  });

  it('final retires the partial; the ordinary bubble is the only line that holds the words', () => {
    const state = run([
      { type: 'VOICE_PARTIAL', text: 'the portal is open' },
      { type: 'VOICE_UTTERANCE' },
      { type: 'USER_SENT', text: 'the portal is open' },
    ]);
    const html = render(state);
    expect(html).toContain('the portal is open');
    expect(html).not.toContain('is-transient');
    expect(html.match(/the portal is open/g)).toHaveLength(1);
  });

  it('a degrade note renders as an honest in-stream line, not a partial', () => {
    const state = run([
      { type: 'VOICE_PARTIAL', text: 'are you still' },
      { type: 'VOICE_NOTE', code: 'stt_unavailable' },
    ]);
    const html = render(state);
    expect(html).not.toContain('are you still'); // the partial retired with the mic
    expect(html).toContain('the sitting continues as text');
  });
});
