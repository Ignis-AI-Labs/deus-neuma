/**
 * Markdown press — renders markdown into document body HTML under a brand kit.
 * Pure: same markdown + same kit → same HTML. No IO.
 *
 * Author-facing extras beyond CommonMark/GFM:
 *   - ```chartjs fences        → server-rendered SVG charts (chart-press)
 *   - ```pagebreak fences, [PAGEBREAK], <!--pagebreak--> → hard page breaks
 *   - ::: summary|feature|warning|note [title] ... :::   → callout boxes
 *   - @<icon>[alt] placeholders → brand-kit icon spans (keys from kit.logos)
 */

import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import { pressChart, DEFAULT_PALETTE } from './chart-press.js';
import { escapeMarkup } from './text-escape.js';

const BOX_TYPES = Object.freeze(['summary', 'feature', 'warning', 'note']);
const PAGE_BREAK_HTML = '<div class="page-break"></div>';

/**
 * Normalizes every page-break spelling to a single marker div. Pure.
 * @param {string} markdown
 * @returns {string}
 */
export function normalizePageBreaks(markdown) {
  return markdown
    .replace(/^[ \t]*\[(?:PAGEBREAK|PAGE-BREAK|PAGE_BREAK)\][ \t]*$/gim, PAGE_BREAK_HTML)
    .replace(/<!--\s*pagebreak\s*-->/gi, PAGE_BREAK_HTML);
}

/**
 * Expands ::: box containers into HTML shells, leaving inner markdown
 * for the renderer. Unknown container types pass through untouched. Pure.
 * @param {string} markdown
 * @returns {string}
 */
export function expandBoxes(markdown) {
  const out = [];
  let depth = 0;
  for (const line of markdown.split('\n')) {
    const open = line.match(/^:::\s*([a-zA-Z]+)\s*(.*)$/);
    if (open && BOX_TYPES.includes(open[1].toLowerCase())) {
      const type = open[1].toLowerCase();
      const title = open[2].trim();
      depth += 1;
      out.push('', `<div class="press-box press-${type}">`, '');
      if (title) out.push(`<div class="press-box-title">${escapeMarkup(title)}</div>`, '');
      continue;
    }
    if (/^:::\s*$/.test(line) && depth > 0) {
      depth -= 1;
      out.push('', '</div>', '');
      continue;
    }
    out.push(line);
  }
  while (depth > 0) {
    depth -= 1;
    out.push('', '</div>');
  }
  return out.join('\n');
}

function highlightCode(code, lang) {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
    } catch {
      // fall through to markdown-it's default escaping
    }
  }
  return '';
}

function fencePlugin(md, palette) {
  const defaultFence = md.renderer.rules.fence
    || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const info = tokens[idx].info.trim().toLowerCase();
    if (info === 'chartjs') return pressChart(tokens[idx].content, palette);
    if (info === 'pagebreak') return PAGE_BREAK_HTML;
    return defaultFence(tokens, idx, options, env, self);
  };
}

function iconSpan(key, alt) {
  return `<span class="press-icon press-icon-${key}" role="img" aria-label="${escapeMarkup(alt || `${key} icon`)}"></span>`;
}

// Token-level replacement (not a source pre-pass) so @icon text inside
// code fences and inline code is never touched.
function iconPlugin(md, iconKeys) {
  if (iconKeys.length === 0) return;
  const pattern = new RegExp(`@(${iconKeys.join('|')})(?:\\[([^\\]]*)\\])?`, 'g');
  md.core.ruler.after('inline', 'press_icons', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.children) continue;
      token.children = token.children.flatMap((child) => {
        if (child.type !== 'text' || !child.content.includes('@')) return [child];
        const pieces = [];
        let last = 0;
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(child.content)) !== null) {
          if (match.index > last) {
            const text = new state.Token('text', '', 0);
            text.content = child.content.slice(last, match.index);
            pieces.push(text);
          }
          const html = new state.Token('html_inline', '', 0);
          html.content = iconSpan(match[1], match[2]);
          pieces.push(html);
          last = match.index + match[0].length;
        }
        if (pieces.length === 0) return [child];
        if (last < child.content.length) {
          const text = new state.Token('text', '', 0);
          text.content = child.content.slice(last);
          pieces.push(text);
        }
        return pieces;
      });
    }
  });
}

/**
 * Builds a configured markdown renderer for a brand kit. Pure.
 * @param {object} kit - Loaded brand kit (see brand-kit.js)
 * @returns {MarkdownIt}
 */
function buildRenderer(kit) {
  const md = new MarkdownIt({
    html: true,
    breaks: true,
    linkify: true,
    typographer: true,
    highlight: highlightCode
  });
  md.use(fencePlugin, kit.charts?.palette || DEFAULT_PALETTE);
  md.use(iconPlugin, Object.keys(kit.logos || {}).filter((k) => k !== 'primary'));
  return md;
}

/**
 * Presses markdown into document body HTML. Pure.
 * @param {string} markdown
 * @param {object} kit - Loaded brand kit
 * @returns {string} - Body HTML (no document shell)
 */
export function pressBody(markdown, kit) {
  const prepared = expandBoxes(normalizePageBreaks(String(markdown)));
  return buildRenderer(kit).render(prepared);
}
