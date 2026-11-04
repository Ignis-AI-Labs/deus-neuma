/**
 * The approval card says when its preview was cut and offers the whole text
 * (audit C5, 2026-10-19). Real server render of the real ApprovalChip
 * (renderToStaticMarkup, the stream-panel-retry.test.js pattern); no mocks.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let ApprovalChip;
beforeAll(async () => {
  // The sound engine registers a module-level `window` listener on import, and
  // schedules an idle warm-up that reads localStorage — browser facts the static
  // render never exercises (requestIdleCallback is inert, so the warm-up never runs
  // and never throws into a later test).
  globalThis.window = globalThis.window ?? { addEventListener: () => {}, dispatchEvent: () => true, requestIdleCallback: () => {} };
  ({ ApprovalChip } = await import('../../frontend/app/RelinkShell/ApprovalChip.jsx'));
});

const pending = (extra = {}) => ({
  kind: 'approval', phase: 'pending', id: 'a1', tool: 'fs/write', scope: 'use fs/write', media: [], lane: null, decision: null, ...extra,
});

describe('ApprovalChip — a cut preview is said and opens whole', () => {
  it('a cut preview names the cut and the whole length', () => {
    const fullArgs = `{"content": "${'x'.repeat(700)}"}`;
    const html = renderToStaticMarkup(createElement(ApprovalChip, { segment: pending({ args: '{ …\n[truncated]', fullArgs }), onRespond: () => {} }));
    expect(html).toContain('[truncated]');
    expect(html).toContain(`CUT SHORT — SHOW ALL ${fullArgs.length} CHARACTERS`);
    expect(html).toContain('ALLOW ONCE');
  });

  it('a whole preview offers no second view', () => {
    const html = renderToStaticMarkup(createElement(ApprovalChip, { segment: pending({ args: '{"content": "brief"}', fullArgs: '' }), onRespond: () => {} }));
    expect(html).not.toContain('CUT SHORT');
    expect(html).toContain('brief');
  });
});
