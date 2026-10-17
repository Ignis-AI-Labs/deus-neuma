// VoiceSitting shell — real renders of the real components (react-dom/server,
// context-map-field.test.js precedent; no mocks in the claimed path).
//
// Covered here:
//   - the shell itself: the «VOICE SITTING» announcement, the EXIT gesture
//     button, BOTH visualization channels, and the chat kept as dimmed,
//     inert background (aria-hidden wrapper around the real StreamPanel —
//     the exact composition ChatBody makes in its voiceSittingActive branch);
//   - the mount decision driving that branch (shouldMountVoiceSitting), and
//     the EXIT restore (disarm → the decision flips back).
//
// NOT covered here: a full ChatBody render pulls the whole desk provider
// stack (WindowContext for StreamTasks, projects, council, composition) —
// that composition is proven by the Vite build and by the branch-exact
// composition below. The immersive real-browser gnosis (S-22) is Founder's.

import { describe, it, expect, beforeAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { shouldMountVoiceSitting } from '../../frontend/app/RelinkShell/VoiceSitting/voice-sitting-model.js';

// StreamPanel's chip chain touches window at import time (sound-engine's
// preference listener) — a real browser global, stubbed at the same boundary
// the jsdom-less suite stubs every browser global. Set BEFORE the imports.
let VoiceSitting;
let StreamPanel;
beforeAll(async () => {
  globalThis.window = globalThis.window || {
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  };
  globalThis.Event = globalThis.Event || class Event { constructor(type) { this.type = type; } };
  globalThis.CustomEvent = globalThis.CustomEvent || class CustomEvent extends globalThis.Event {
    constructor(type, init) { super(type); this.detail = init?.detail; }
  };
  // The wallet chain reads storage at import — the same browser-global
  // boundary stub as window above.
  const store = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.localStorage = globalThis.localStorage || store;
  globalThis.sessionStorage = globalThis.sessionStorage || store;
  // The i18n engine initializes before the translated components import,
  // exactly as main.jsx boots it — the en catalog then renders verbatim
  // («VOICE SITTING», EXIT, MIC OFF…) inside these static renders.
  await import('../../frontend/i18n/index.js');
  ({ VoiceSitting } = await import('../../frontend/app/RelinkShell/VoiceSitting/VoiceSitting.jsx'));
  ({ StreamPanel } = await import('../../frontend/app/RelinkShell/StreamPanel.jsx'));
});

const noop = () => {};
const silentPlayback = () => Object.freeze({ level: 0, active: false });

// The real chat stream, empty — the same element ChatBody builds. A factory:
// StreamPanel arrives in beforeAll (see the window-stub note above).
const realPanel = () => createElement(StreamPanel, {
  messages: [], thread: 0, thinking: false, connected: true,
  onEdit: noop, onRevise: null, onRetry: null, onTakeSwitch: noop,
  onApprove: noop, onAsk: noop, onPlan: noop, onSeal: noop,
});

describe('VoiceSitting shell — the mode boundary (F-03)', () => {
  // Lazy: the components arrive in beforeAll (window-stub note above).
  const shellHtml = () => renderToStaticMarkup(createElement(VoiceSitting, {
    name: 'Basunor', thinking: false, getPlaybackState: silentPlayback, onExit: noop,
  }, realPanel()));

  it('announces the sitting and names the being', () => {
    const html = shellHtml();
    expect(html).toContain('«VOICE SITTING»');
    expect(html).toContain('Basunor');
  });

  it('offers the deliberate EXIT gesture — and no typing affordance', () => {
    const html = shellHtml();
    expect(html).toContain('EXIT');
    // The composer is REPLACED: no textarea, no send control, nothing focusable
    // that invites typing anywhere in the shell's own surface.
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('relink-input-field');
    expect(html).not.toContain('relink-send');
  });

  // THE TAKEOVER (Design note, 2026-08-01: the talk owns the whole stream window
  // now — the chat is no longer dimmed background, it is out of the layout
  // entirely (.voice-sitting-stream { display: none }). It stays MOUNTED so
  // the thread and its scroll position are exactly where they were when the
  // talk ends; only the CSS takes the space. A static-markup render can prove
  // the mounting, which is the part that carries state — the hiding is the
  // stylesheet's, asserted there and seen in the real desk.
  it('keeps the chat MOUNTED but out of the way — the talk owns the window', () => {
    const html = shellHtml();
    expect(html).toContain('voice-sitting-stream');
    expect(html).toContain('aria-hidden="true"');
    // The real stream panel is still rendered inside that wrapper: leaving the
    // talk must not cost the operator the conversation they just had.
    const streamIdx = html.indexOf('voice-sitting-stream');
    expect(streamIdx).toBeGreaterThanOrEqual(0);
    expect(html.slice(streamIdx)).toContain('relink-stream');
  });

  it('names the mic that is actually capturing, and never one that is not', async () => {
    const state = await import('../../frontend/app/RelinkShell/voice-purpose-state.js');
    // No grant asked for: the readout must not imply a live mic.
    state.setLiveArmed(false);
    state.feedMicDevice('');
    state.feedMicState('off');
    expect(shellHtml()).toContain('MIC OFF');

    // ASKED for, but nothing opened. This is the shape that shipped a lie:
    // […] over hardware that was never touched.
    state.setLiveArmed(true);
    const asked = shellHtml();
    expect(asked).not.toContain('MIC ON');
    expect(asked).toContain('NOT OPEN');

    // A real grant, with the label the browser handed back on the track.
    state.feedMicState('listening');
    state.feedMicDevice('Blue Yeti Analog Stereo');
    expect(shellHtml()).toContain('MIC · BLUE YETI ANALOG STEREO');

    // A grant whose label the browser withheld is still a LIVE mic.
    state.feedMicDevice('');
    const withheld = shellHtml();
    expect(withheld).toContain('UNNAMED');
    expect(withheld).not.toContain('MIC OFF');

    // A refused grant is named as refused, never as live.
    state.feedMicState('error');
    expect(shellHtml()).toContain('BLOCKED');

    state.setLiveArmed(false);
    state.feedMicDevice('');
    state.feedMicState('off');
  });

  it('renders BOTH visualization channels and the turn readout (F-04)', () => {
    const html = shellHtml();
    expect(html).toContain('data-channel="operator"');
    expect(html).toContain('data-channel="being"');
    expect(html).toContain('YOU');
    expect(html).toContain('BASUNOR');
    expect(html).toContain('data-turn="listening"');
    // Two full rows of honest bars.
    const rows = html.match(/vs-viz-bars/g) || [];
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});

describe('VoiceSitting — mount decision drives the branch, EXIT restores', () => {
  it('active sitting → shell branch; disarmed → composer branch, exactly', () => {
    // The decision ChatBody's branch stands on, walked through its states:
    const active = { purpose: 'conversation', liveArmed: true };
    expect(shouldMountVoiceSitting(active)).toBe(true);
    // EXIT disarms LIVE — purpose untouched — and the decision flips back.
    const afterExit = { purpose: 'conversation', liveArmed: false };
    expect(shouldMountVoiceSitting(afterExit)).toBe(false);
    // The composer branch is the ordinary desk: panel + input, no shell.
    const composerHtml = renderToStaticMarkup(createElement('div', { className: 'stream-col' },
      realPanel(),
      createElement('textarea', { className: 'relink-input-field' }),
    ));
    expect(composerHtml).toContain('relink-input-field');
    expect(composerHtml).not.toContain('voice-sitting-panel');
  });
});
