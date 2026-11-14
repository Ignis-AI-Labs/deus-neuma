import { describe, test, expect } from 'vitest';
import { BADGE_MARK, buildDocumentHtml, buildPdfChrome } from '../../backend/services/doc-press/document-shell.js';
import { DEFAULT_KIT } from '../../backend/services/doc-press/brand-kit.js';

const brandedKit = {
  ...DEFAULT_KIT,
  companyName: 'Acme & Sons',
  documentFooter: 'Confidential <internal>',
  colors: { ...DEFAULT_KIT.colors, accent: '#ff0000' },
  logoData: {
    primary: 'data:image/svg+xml;base64,AA==',
    badge: 'data:image/svg+xml;base64,BB==',
    seal: 'data:image/svg+xml;base64,CC==',
    bullets: 'data:image/svg+xml;base64,DD=='
  }
};

describe('buildDocumentHtml (pure)', () => {
  test('injects kit colors and logos as CSS custom properties', () => {
    const html = buildDocumentHtml({ bodyHtml: '<p>x</p>', kit: brandedKit, title: 'T' });
    expect(html).toContain('--press-accent: #ff0000;');
    expect(html).toContain('--press-logo-badge: url("data:image/svg+xml;base64,BB==");');
  });
  test('masthead, footer seal, and footer text render when the kit has them', () => {
    const html = buildDocumentHtml({ bodyHtml: '<p>x</p>', kit: brandedKit, title: 'T' });
    expect(html).toContain('header-logo');
    expect(html).toContain('footer-seal');
    expect(html).toContain('Confidential &lt;internal&gt;');
  });
  test('the neutral kit renders no masthead and no footer', () => {
    const html = buildDocumentHtml({ bodyHtml: '<p>x</p>', kit: DEFAULT_KIT, title: 'T' });
    expect(html).not.toContain('class="document-header"');
    expect(html).not.toContain('class="document-footer"');
  });
  test('custom bullet styles appear only when the kit ships a bullets logo', () => {
    expect(buildDocumentHtml({ bodyHtml: '', kit: brandedKit, title: 'T' })).toContain('--press-logo-bullets');
    expect(buildDocumentHtml({ bodyHtml: '', kit: DEFAULT_KIT, title: 'T' })).not.toContain('ul li::before');
  });
  test('escapes the document title', () => {
    const html = buildDocumentHtml({ bodyHtml: '', kit: DEFAULT_KIT, title: '<script>' });
    expect(html).toContain('<title>&lt;script&gt;</title>');
  });
});

describe('buildPdfChrome (pure)', () => {
  test('branded header carries badge, title, and company name', () => {
    const { headerTemplate, footerTemplate, badge } = buildPdfChrome({ kit: brandedKit, title: 'Quarterly' });
    // the badge rides as a marker the press fills with it drawn at its printed size (deus-neuma #33)
    expect(headerTemplate).toContain(`src="${BADGE_MARK}"`);
    expect(badge).toBe('data:image/svg+xml;base64,BB==');
    expect(headerTemplate).toContain('Quarterly');
    expect(headerTemplate).toContain('Acme &amp; Sons');
    expect(footerTemplate).toContain('pageNumber');
    expect(footerTemplate).toContain('totalPages');
  });
  test('the neutral kit gets an empty header', () => {
    expect(buildPdfChrome({ kit: DEFAULT_KIT, title: 'T' }).headerTemplate).toBe('<div></div>');
  });
});
