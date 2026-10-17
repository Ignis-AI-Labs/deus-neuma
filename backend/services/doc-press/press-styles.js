/**
 * Base stylesheet for pressed documents.
 * Pure — a template over brand-kit CSS custom properties (--press-*).
 * Brand identity enters ONLY through the tokens the document shell injects;
 * nothing here hardcodes a company's look.
 */

export const BASE_STYLES = `
body {
  font-family: var(--press-font-body);
  font-size: 12px;
  line-height: 1.5;
  color: var(--press-ink);
  background: var(--press-paper);
  margin: 0;
  padding: 0;
}

.document-header {
  text-align: center;
  margin-bottom: 20px;
  padding-bottom: 10px;
}

.header-logo img {
  height: 60px;
  max-width: 220px;
  margin: 0 auto;
}

.title-page {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 80vh;
  page-break-after: always;
  break-after: page;
}

.title-page h1 {
  font-size: 48px !important;
  border-bottom: none !important;
  text-align: center;
}

.document-title {
  font-size: 28px;
  text-align: center;
  margin: 48px 0 24px 0;
  font-weight: 700;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--press-font-body);
  font-weight: 600;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  color: var(--press-heading);
  page-break-after: avoid;
  break-after: avoid;
}

h1 {
  font-size: 22px;
  border-bottom: 1px solid var(--press-rule);
  padding-bottom: 0.3em;
  text-align: center;
  margin-top: 0;
}

h2 {
  font-size: 18px;
  border-bottom: 1px solid var(--press-rule-soft);
  padding-bottom: 0.3em;
}

h3 { font-size: 16px; }
h4 { font-size: 14px; }
h5, h6 { font-size: 12px; }

a {
  color: var(--press-accent);
  text-decoration: none;
}

p, ul, ol { margin-bottom: 16px; }

ul, ol { padding-left: 2em; }
li { margin-bottom: 0.25em; }

pre, code {
  font-family: var(--press-font-mono);
  font-size: 11px;
  background-color: var(--press-wash);
  border-radius: 3px;
}

pre {
  padding: 16px;
  overflow: auto;
  line-height: 1.45;
  margin-bottom: 16px;
  page-break-inside: avoid;
  break-inside: avoid;
}

code { padding: 0.2em 0.4em; }
pre code { padding: 0; background-color: transparent; }

/* Compact neutral code color theme (hljs) tinted by the kit accent. */
.hljs-comment, .hljs-quote { color: var(--press-muted); font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-section, .hljs-name { color: var(--press-accent); font-weight: 600; }
.hljs-string, .hljs-regexp, .hljs-addition { color: #2e7d32; }
.hljs-number, .hljs-literal, .hljs-symbol, .hljs-bullet { color: #7b3fa0; }
.hljs-title, .hljs-attr, .hljs-attribute, .hljs-built_in { color: #205ea6; }
.hljs-deletion { color: #b3261e; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: bold; }

blockquote {
  margin: 0 0 16px 0;
  padding: 0 1em;
  color: var(--press-muted);
  border-left: 0.25em solid var(--press-rule);
  page-break-inside: avoid;
  break-inside: avoid;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 16px;
  font-size: 10px;
  page-break-inside: avoid;
  break-inside: avoid;
}

table, th, td { border: 1px solid var(--press-rule); }
th, td { padding: 6px 13px; }

th {
  background-color: var(--press-wash);
  font-weight: 600;
}

tr:nth-child(even) { background-color: var(--press-wash-soft); }

img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 16px auto;
}

hr {
  height: 0.25em;
  padding: 0;
  margin: 24px 0;
  background-color: var(--press-rule);
  border: 0;
}

.page-break {
  page-break-before: always;
  break-before: page;
  height: 0;
  margin: 0;
  border: 0;
  clear: both;
}

.no-break {
  page-break-inside: avoid;
  break-inside: avoid;
}

.press-box {
  padding: 16px;
  margin-bottom: 16px;
  background-color: var(--press-wash-soft);
  border-left: 4px solid var(--press-accent);
  page-break-inside: avoid;
  break-inside: avoid;
}

.press-box-title {
  font-weight: 700;
  font-size: 13px;
  margin-bottom: 8px;
}

.press-summary { background-color: var(--press-wash-soft); border-left-color: var(--press-heading); }
.press-feature { background-color: var(--press-accent-wash); border-left-color: var(--press-accent); }
.press-warning { background-color: #fff8f7; border-left-color: #d73a49; }
.press-note { background-color: var(--press-wash-soft); border-left-color: var(--press-muted); font-style: italic; }

.press-icon {
  display: inline-block;
  height: 20px;
  width: 20px;
  vertical-align: middle;
  margin-right: 6px;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  position: relative;
  top: -2px;
}

.document-footer {
  text-align: center;
  margin-top: 30px;
  padding-top: 10px;
  border-top: 1px solid var(--press-rule-soft);
}

.footer-seal {
  height: 40px;
  width: 40px;
  margin: 0 auto;
  background-image: var(--press-logo-seal, none);
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}

.footer-text {
  font-size: 9px;
  color: var(--press-muted);
  margin-top: 6px;
}

.chart-container {
  margin: 25px 0;
  text-align: center;
  page-break-inside: avoid;
  break-inside: avoid;
}

.chart-container svg {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0 auto;
}

.chart-error {
  background-color: #f8d7da;
  border: 1px solid #f5c6cb;
  color: #721c24;
  padding: 12px;
  border-radius: 4px;
  margin: 16px 0;
  text-align: center;
  font-size: 14px;
}
`;

/**
 * List styling used only when the kit ships a bullets icon. Pure constant.
 */
export const CUSTOM_BULLET_STYLES = `
ul { list-style-type: none; }

ul li { position: relative; }

ul li::before {
  content: "";
  display: inline-block;
  height: 8px;
  width: 8px;
  background-image: var(--press-logo-bullets);
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  position: absolute;
  left: -1.2em;
  top: 0.5em;
}
`;
