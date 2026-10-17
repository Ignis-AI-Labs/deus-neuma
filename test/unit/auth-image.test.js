// AuthImage's first paint, through a REAL react-dom render — no mocks, the
// house idiom from app-title.test.js.
//
// ⚠️ SCOPE, STATED PLAINLY (RULE 0 forbids dressing a belief as knowledge):
// `renderToStaticMarkup` does not run effects, so what is PROVEN here is the
// first-paint contract — the part that silently breaks a grid. The fetch itself
// is exercised live by the surfaces that use it (the AI-activity rail, the
// forge bench).
//
// The first-paint contract matters on its own: a component that renders nothing
// while waiting collapses to zero height, so its row reflows as each image
// arrives.
//
// AuthImage is now the FALLBACK path, for lane-scoped routes that accept a
// header and nothing else. THE GALLERY no longer uses it — /gallery/file takes
// `?token=`, so a tile is a plain <img> the browser loads, caches and evicts on
// its own (proven in api-gallery-file.test.js). The IntersectionObserver
// load/release machine that used to live here went with it: it existed only for
// the gallery, and `loading="lazy"` is the browser's own version of it.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthImage } from '../../frontend/app/RelinkShell/AuthImage.jsx';

const render = (props) => renderToStaticMarkup(createElement(AuthImage, props));

describe('AuthImage first paint', () => {
  it('paints a placeholder rather than nothing, so the row does not collapse', () => {
    const html = render({ src: '/api/v1/image/thumb?laneId=abc' });
    expect(html).toContain('authimg-loading');
    // Never an <img> before bytes exist: a src-less or blob-less img is the
    // broken-image glyph the whole AuthImage component exists to avoid.
    expect(html).not.toContain('<img');
  });

  it('carries the caller class onto the placeholder, so the box keeps its size', () => {
    const html = render({ src: '/x', className: 'tool-chip-made-img' });
    expect(html).toContain('tool-chip-made-img');
  });

  it('the placeholder is aria-hidden — it is furniture, not content', () => {
    expect(render({ src: '/x' })).toContain('aria-hidden');
  });

  it('renders without throwing on an empty src', () => {
    expect(() => render({ src: '' })).not.toThrow();
  });
});
