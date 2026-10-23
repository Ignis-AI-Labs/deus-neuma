/**
 * A video render reads VIDEO on the desk's chips (Design note, 2026-10-23. Real server
 * renders of the PRODUCTION ApprovalChip and ToolChip (renderToStaticMarkup,
 * the approval-chip-whole.test.js pattern), fed the frames the backend sends —
 * the words come from the real naming map, never typed here. No mocks.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderingLine, madeLine, renderActName } from '../../backend/services/image-forge/render-kind.js';
import { toActivityRow } from '../../frontend/app/RelinkShell/comfyui-workbench-view.js';

let ApprovalChip; let ToolChip;
beforeAll(async () => {
  // The sound engine registers a module-level `window` listener on import and
  // warms its sprite when the page goes idle — browser facts a static render
  // never exercises (a page that never idles never warms).
  globalThis.window = globalThis.window ?? { addEventListener: () => {}, dispatchEvent: () => true, requestIdleCallback: () => {} };
  ({ ApprovalChip } = await import('../../frontend/app/RelinkShell/ApprovalChip.jsx'));
  ({ ToolChip } = await import('../../frontend/app/RelinkShell/ToolChip.jsx'));
});

const card = (extra = {}) => ({
  kind: 'approval', phase: 'pending', id: 'a1', tool: 'intents/image.generate', label: 'video/generate',
  scope: 'render a video from image i1: "slow push in" (video.ltx.i2v)', args: '{}', fullArgs: '', media: [], lane: null, decision: null, ...extra,
});
const chip = (summary, status) => ({ kind: 'tool', phase: 'resolved', label: 'image/generate', status, summary, detail: '' });

describe('the approval card names the act a person is deciding', () => {
  it('pending: video/generate heads the card, never the wire tool', () => {
    const html = renderToStaticMarkup(createElement(ApprovalChip, { segment: card(), onRespond: () => {} }));
    expect(html).toContain('NEEDS APPROVAL');
    expect(html).toContain('>video/generate<');
    expect(html).toContain('GRANTS: render a video from image i1');
    expect(html).not.toContain('intents/image.generate');
  });

  it('resolved: the record reads video/generate and the decision', () => {
    const html = renderToStaticMarkup(createElement(ApprovalChip, { segment: card({ phase: 'resolved', decision: 'allow' }), onRespond: () => {} }));
    expect(html).toContain('video/generate (render a video from image i1');
    expect(html).toContain('ALLOWED ONCE');
  });

  it('a card with no label still names its tool (every other act)', () => {
    const html = renderToStaticMarkup(createElement(ApprovalChip, { segment: card({ tool: 'fs/write', label: '' }), onRespond: () => {} }));
    expect(html).toContain('>fs/write<');
  });
});

describe('the render chip says video from the first beat to the clip', () => {
  it('working, rendering with a filling bar, then made — each line says video', () => {
    const working = renderToStaticMarkup(createElement(ToolChip, { segment: chip(`${renderActName('video')} — working`, 'executing') }));
    expect(working).toContain('video/generate — working');
    const half = renderToStaticMarkup(createElement(ToolChip, { segment: chip(renderingLine('video', '50%'), 'running') }));
    expect(half).toContain('rendering video — 50%');
    expect(half).toContain('aria-valuenow="50"');
    const made = renderToStaticMarkup(createElement(ToolChip, {
      segment: chip(madeLine('video', [{ bytes: 4.2 * 1024 * 1024 }], { seconds: 5, width: 720, height: 1280 }), 'ok'),
    }));
    expect(made).toContain('made 1 video — 4.2 MB · 5 s · portrait');
    for (const html of [working, half, made]) expect(html).not.toMatch(/image\(s\)|rendering —|intents\/image/);
  });

  it('a still keeps saying image', () => {
    const html = renderToStaticMarkup(createElement(ToolChip, { segment: chip(madeLine('image', [{ bytes: 969 * 1024 }], { width: 1024, height: 1024 }), 'ok') }));
    expect(html).toContain('made 1 image — 969 KB · 1024×1024');
  });
});

describe('the forge rail says what each job makes', () => {
  it('a video job reads VIDEO beside its phase; anything else reads IMAGE', () => {
    expect(toActivityRow({ jobId: 'j', phase: 'rendering', kind: 'video' })).toMatchObject({ word: 'RENDERING', what: 'VIDEO' });
    expect(toActivityRow({ jobId: 'j', phase: 'done' })).toMatchObject({ word: 'DONE', what: 'IMAGE' });
  });
});
