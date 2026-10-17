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
 * @returns {{headerTemplate: string, footerTemplate: string}}
 */
export function buildPdfChrome({ kit, title }) {
  const badge = kit.logoData.badge
    ? `<img src="${kit.logoData.badge}" style="height: 12px; margin-right: 5px; vertical-align: middle;" />`
    : '';
  const headerTemplate = kit.companyName || badge
    ? `<div style="display: flex; width: 100%; font-size: 8px; padding: 0 1cm; align-items: center; font-family: Arial, sans-serif; color: #666;">
  <div style="flex: 1; text-align: left;">${badge}<span>${escapeMarkup(title)}</span></div>
  <div style="flex: 1; text-align: right;">${escapeMarkup(kit.companyName)}</div>
</div>`
    : '<div></div>';
  const footerTemplate = `<div style="width: 100%; text-align: center; font-size: 8px; font-family: Arial, sans-serif; color: #888;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`;
  return { headerTemplate, footerTemplate };
}
