/**
 * RETRY ANYWHERE — the ↻ affordance, rendered (real server render, no mocks —
 * the markdown-render.test.js pattern: renderToStaticMarkup against the real
 * StreamPanel tree).
 *
 * Pinned here:
 *   - a settled USER bubble carrying its turn-point offers ↻ (retry from the
 *     witness's own message — the conversation continues from that point)
 *   - a settled ERROR bubble carrying its persisted point offers ↻; a
 *     pre-persist refusal (no turnId) offers NOTHING — there is no point to ask
 *   - the answer's takes block (‹ k/N › + ↻) is untouched, and take
 *     navigation never appears on user/error bubbles
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The desk's sound engine registers a module-level `window` listener on
// import — a browser fact, not part of the render path under test (no sound
// plays in a static render; the click handlers never fire). jsdom is not a
// dependency of this project, so the test provisions the one global the
// import graph needs, before loading the panel. Nothing about sound
// behavior itself is exercised or claimed here.
let StreamPanel;
beforeAll(async () => {
  // The import graph's module-level browser facts (sound engine's listener,
  // the wallet registry's storage read) — provisioned, never exercised.
  globalThis.window = globalThis.window ?? { addEventListener: () => {}, dispatchEvent: () => true, requestIdleCallback: () => {} };
  globalThis.localStorage = globalThis.localStorage ?? {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
  };
  ({ StreamPanel } = await import('../../frontend/app/RelinkShell/StreamPanel.jsx'));
});

const message = (role, text, extra = {}) => ({
  id: `m-${role}-${text}`,
  role,
  streaming: false,
  isHistory: false,
  at: null,
  segments: [{ kind: 'speech', text }],
  meta: null,
  ...extra,
});

const render = (messages, props = {}) =>
  renderToStaticMarkup(createElement(StreamPanel, {
    messages,
    thread: 0,
    thinking: false,
    connected: true,
    onRetry: () => {},
    onTakeSwitch: () => {},
    ...props,
  }));

describe('StreamPanel — ↻ at any named point', () => {
  it('a settled USER bubble with a turn-point offers ↻ (no take navigation)', () => {
    const html = render([message('user', 'what is the void?', { turnId: 't1' })]);
    expect(html).toContain('stream-retry');
    expect(html).toContain('Ask from this point again');
    expect(html).not.toContain('stream-take-step'); // the takes belong to the answer
  });

  it('a settled ERROR bubble with a persisted point offers ↻', () => {
    const html = render([message('error', 'provider overloaded', { turnId: 't1' })]);
    expect(html).toContain('stream-retry');
    expect(html).toContain('the failure left it on the record');
  });

  it('bubbles WITHOUT a turn-point offer no ↻ — nothing honest to retry', () => {
    const userHtml = render([message('user', 'legacy words')], { onEdit: () => {} });
    expect(userHtml).not.toContain('stream-retry');
    expect(userHtml).toContain('relink-edit'); // EDIT still stands on its own
    const errorHtml = render([message('error', 'pre-persist refusal')]);
    expect(errorHtml).not.toContain('stream-retry');
  });

  it('no ↻ renders anywhere while onRetry is gated off (mid-turn)', () => {
    const html = renderToStaticMarkup(createElement(StreamPanel, {
      messages: [message('user', 'q', { turnId: 't1' }), message('error', 'failed', { turnId: 't2' })],
      thread: 0,
      thinking: true,
      connected: true,
      onRetry: null,
      onTakeSwitch: () => {},
    }));
    expect(html).not.toContain('stream-retry');
  });

  it('the answer\'s takes block is untouched: ‹ k/N › plus ↻ on a multi-take point', () => {
    const html = render([
      message('user', 'q', { turnId: 't1' }),
      message('neuma', 'take two', {
        turnId: 't1',
        takeIndex: 2,
        takeCount: 2,
        takes: [
          { takeIndex: 1, at: null, segments: [{ kind: 'speech', text: 'take one' }], meta: null },
          { takeIndex: 2, at: null, segments: [{ kind: 'speech', text: 'take two' }], meta: null },
        ],
      }),
    ]);
    expect(html).toContain('stream-take-step');
    expect(html).toContain('2/2');
    // One ↻ for the answer, one for the user bubble — both name the same point.
    expect(html.match(/stream-retry/g)).toHaveLength(2);
  });

  it('EDIT passes the point identity — the bubble keeps its turnId through the recall affordance', () => {
    // The payload shape itself is wired in ChatApp/StreamInput; what the PANEL
    // guarantees is that EDIT and ↻ stand together on a named user point.
    const html = render([message('user', 'revise me', { turnId: 't1' })], { onEdit: () => {} });
    expect(html).toContain('relink-edit');
    expect(html).toContain('stream-retry');
  });
});

describe('StreamPanel — the edit, in place (ruling, 2026-07-28)', () => {
  it('EDIT opens the editor AT the bubble — the message text is the draft, and the composer is never involved', () => {
    // renderToStaticMarkup runs the initial render only, so this pins the
    // affordance and the editor's closed state; the click-through fork is the
    // e2e's claim (retry-anywhere.spec.js step 2, real lane).
    const html = render([message('user', 'revise me', { turnId: 't1' })], {
      onEdit: () => {}, onRevise: () => {},
    });
    expect(html).toContain('relink-edit');
    expect(html).toContain('Edit this message where it stands');
    // Closed at rest: no editor, no save act — the bubble reads as a message.
    expect(html).not.toContain('relink-inline-edit-field');
    expect(html).not.toContain('SAVE — CONTINUE FROM HERE');
  });

  it('a bubble with NO revise path offers no EDIT at all — nothing honest to fork with', () => {
    const html = render([message('user', 'stranded words', { turnId: 't1' })]);
    expect(html).not.toContain('relink-edit');
  });

  it('a disconnected lane (onRevise gated off) still offers EDIT through the composer fallback', () => {
    const html = render([message('user', 'legacy words')], { onEdit: () => {}, onRevise: null });
    expect(html).toContain('relink-edit');
  });

  it('the edit affordance belongs to the WITNESS\'s own words only — an answer never offers it', () => {
    const html = render([message('neuma', 'the house speaks', { turnId: 't1', takeIndex: 1, takeCount: 1 })], {
      onEdit: () => {}, onRevise: () => {},
    });
    expect(html).not.toContain('relink-edit');
  });
});

describe('StreamPanel — a failure says why', () => {
  it('an ERROR bubble shows the reason the frame named, under its words', () => {
    const html = render([message('error', '[Connection to the void disrupted]', { turnId: 't1', reason: 'context length exceeded' })]);
    expect(html).toContain('relink-msg-reason');
    expect(html).toContain('context length exceeded');
  });

  it('a bubble with no reason shows none', () => {
    expect(render([message('error', 'Refused')])).not.toContain('relink-msg-reason');
  });
});
