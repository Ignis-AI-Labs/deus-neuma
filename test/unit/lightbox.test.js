// The marketing previews' loupe — proven through a real react-dom render of
// the actual dialog tree (no mocks; the renderToStaticMarkup house pattern,
// markdown-render.test.js / empty-state.test.js). The lens arithmetic was
// already proven pure in gallery-viewer-zoom.test.js; what this pins is the
// room the previews open: a modal dialog named by the image's own alt text,
// the real src hung at FIT (the browser's own fit, transform at identity),
// the CLOSE act, the zoom readout at a fresh 100%, and the caption line
// that names what is being judged.
//
// What it deliberately does NOT claim: key/wheel/click wiring — those need
// a browser, and this suite is jsdom-less by standing decision
// (stream-panel-retry.test.js precedent). The live desk check is the
// operator's own click.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LightboxRoom } from '../../frontend/app/RelinkShell/Lightbox.jsx';

const render = (props) => renderToStaticMarkup(createElement(LightboxRoom, props));

const baseProps = { src: 'blob:queue-media-1', alt: 'the staged card, described', onClose: () => {} };

describe('LightboxRoom', () => {
  it('is a modal dialog named by the image\'s own alt text', () => {
    const html = render(baseProps);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="the staged card, described"');
  });

  it('hangs the real src at FIT — the identity transform, never magnified', () => {
    const html = render(baseProps);
    expect(html).toContain('class="lightbox-media"');
    expect(html).toContain(`src="${baseProps.src}"`);
    expect(html).toContain('alt="the staged card, described"');
    expect(html).toContain('transform:translate(0px, 0px) scale(1)');
    expect(html).toContain('draggable="false"');
  });

  it('offers CLOSE, and FIT only once there is a lean to return from', () => {
    const html = render(baseProps);
    expect(html).toContain('>CLOSE</button>');
    const fit = html.match(/<button[^>]*>FIT<\/button>/)[0];
    expect(fit).toContain('disabled');
  });

  it('reads 100% at a fresh hang', () => {
    expect(render(baseProps)).toContain('>100%</span>');
  });

  it('names what is being judged when a caption is given, and stays silent otherwise', () => {
    expect(render({ ...baseProps, caption: 'card.png · ON THE BRAND' }))
      .toContain('card.png · ON THE BRAND');
    expect(render(baseProps)).not.toContain('lightbox-caption');
  });

  it('falls back to the caption for an undescribed image', () => {
    const html = render({ src: 'blob:x', caption: 'mark.svg', onClose: () => {} });
    expect(html).toContain('aria-label="mark.svg"');
    expect(html).toContain('alt=""');
  });
});
