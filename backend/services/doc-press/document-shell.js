/**
 * Document shell — wraps pressed body HTML in the branded document chrome:
 * kit tokens as CSS custom properties, masthead logo, footer seal, and the
 * PDF header/footer templates. Pure — kits arrive fully loaded (logoData
 * already data URIs); no IO here.
 */

import { BASE_STYLES, CUSTOM_BULLET_STYLES } from './press-styles.js';
import { escapeMarkup } from './text-escape.js';

function kitTokens(kit) {
  const c = kit.colors;
  const f = kit.fonts;
  const tokens = [
    `--press-ink: ${c.ink};`,
    `--press-paper: ${c.paper};`,
    `--press-heading: ${c.heading};`,
    `--press-accent: ${c.accent};`,
    `--press-accent-wash: ${c.accentWash};`,
    `--press-muted: ${c.muted};`,
    `--press-rule: ${c.rule};`,
    `--press-rule-soft: ${c.ruleSoft};`,
    `--press-wash: ${c.wash};`,
    `--press-wash-soft: ${c.washSoft};`,
    `--press-font-body: ${f.body};`,
    `--press-font-mono: ${f.mono};`
  ];
  for (const [key, dataUri] of Object.entries(kit.logoData)) {
    tokens.push(`--press-logo-${key}: url("${dataUri}");`);
  }
  return tokens.join('\n  ');
}

// A colour as CSS may carry it into a page rule: hex, rgb()/hsl(), or a name. Anything else is
// left out of @page (a kit's colours are its author's, but a page rule is no place for markup).
const CSS_COLOR = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s]+\)|[a-zA-Z]{3,30})$/;

// THE PAGE IS THE PAPER (deus-neuma #33): Chromium paints the body's background only inside the
// print margins, so a tinted kit pressed a tinted box inside a white border on every page. A page
// rule carrying the margin and the paper colour paints the whole sheet; the running header and
// footer still print. Pure.
function pageRule(kit) {
  const paper = String(kit.colors?.paper || '').trim();
  const margin = Number(kit.pdf?.marginCm);
  const parts = [
    Number.isFinite(margin) && margin >= 0 ? `margin: ${margin}cm;` : '',
    CSS_COLOR.test(paper) ? `background: ${paper};` : '',
  ].filter(Boolean);
  return parts.length ? `@page { ${parts.join(' ')} }` : '';
}

/** The marker the badge's place carries until the press has drawn it at its printed size (chromium-press.js). */
export const BADGE_MARK = '__PRESS_BADGE__';

function iconStyles(kit) {
  return Object.keys(kit.logoData)
    .filter((key) => key !== 'primary')
    .map((key) => `.press-icon-${key} { background-image: var(--press-logo-${key}); }`)
    .join('\n');
}

/**
 * Assembles the complete printable HTML document. Pure.
 * @param {object} params
 * @param {string} params.bodyHtml - Output of pressBody()
 * @param {object} params.kit - Loaded brand kit
 * @param {string} params.title - Document title
 * @returns {string}
 */
export function buildDocumentHtml({ bodyHtml, kit, title }) {
  const masthead = kit.logoData.primary
    ? `<div class="document-header"><div class="header-logo"><img src="${kit.logoData.primary}" alt="${escapeMarkup(kit.companyName)} logo"></div></div>`
    : '';
  const seal = kit.logoData.seal ? '<div class="footer-seal"></div>' : '';
  const footerText = kit.documentFooter
    ? `<div class="footer-text">${escapeMarkup(kit.documentFooter)}</div>`
    : '';
  const footer = seal || footerText
    ? `<div class="document-footer">${seal}${footerText}</div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeMarkup(title)}</title>
<style>
:root {
  ${kitTokens(kit)}
}
${pageRule(kit)}
${BASE_STYLES}
${kit.logoData.bullets ? CUSTOM_BULLET_STYLES : ''}
${iconStyles(kit)}
</style>
</head>
<body>
${masthead}
<div class="markdown-body">
${bodyHtml}
</div>
${footer}
</body>
</html>`;
}

/**
 * Builds the branded PDF running header/footer templates.
 * These render in Chromium's print chrome, outside the page body —
 * inline styles and data-URI images only. Pure.
 * @param {object} params
 * @param {object} params.kit - Loaded brand kit
 * @param {string} params.title - Document title
 * @returns {{headerTemplate: string, footerTemplate: string, badge: string|null}} `badge` — the
 *   kit's badge data URI, for the press to draw small and put in BADGE_MARK's place
 */
export function buildPdfChrome({ kit, title }) {
  // The running header is drawn on EVERY page and its image is not shared between them, so the badge
  // rides as a marker the press fills with the badge drawn at its printed size (chromium-press.js):
  // inlined whole, a 2 MB badge made a 10-page document 23 MB (deus-neuma #33).
  const badge = kit.logoData.badge
    ? `<img src="${BADGE_MARK}" style="height: 12px; margin-right: 5px; vertical-align: middle;" />`
    : '';
  const headerTemplate = kit.companyName || badge
    ? `<div style="display: flex; width: 100%; font-size: 8px; padding: 0 1cm; align-items: center; font-family: Arial, sans-serif; color: #666;">
  <div style="flex: 1; text-align: left;">${badge}<span>${escapeMarkup(title)}</span></div>
  <div style="flex: 1; text-align: right;">${escapeMarkup(kit.companyName)}</div>
</div>`
    : '<div></div>';
  const footerTemplate = `<div style="width: 100%; text-align: center; font-size: 8px; font-family: Arial, sans-serif; color: #888;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`;
  return { headerTemplate, footerTemplate, badge: kit.logoData.badge || null };
}
