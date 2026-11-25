// render-view — a page in a neuma's browser, as the neuma reads it. Pure.
//
// Nothing is cut silently (Design note, 2026-11-17: […]): the words and the numbered
// list each come a window at a time, and every window says where it sits and how to read the next.
// Everything the page authored — its title, words, the names on its buttons, its link addresses —
// rides inside the untrusted frame; the address, the read instant and the instructions are ours.
import { frameUntrustedContent } from '../untrusted-content.js';

export const TEXT_WINDOW = 12_000;
export const REF_WINDOW = 150;

const toCount = (value) => (Number.isInteger(value) && value > 0 ? value : 0);

/** One numbered thing, as a line. Pure. */
export const elementLine = (e) => [
  `[${e.ref}] ${e.kind} "${e.name}"`,
  e.href ? ` → ${e.href}` : '',
  typeof e.value === 'string' && e.value ? ` = "${e.value}"` : '',
  typeof e.checked === 'boolean' ? (e.checked ? ' (checked)' : ' (unchecked)') : '',
  Array.isArray(e.options) && e.options.length ? ` options: ${e.options.join(' | ')}` : '',
].join('');

/**
 * The page as the neuma reads it.
 * @param {{url: string, title: string, text: string, textTotal: number, elements: object[], elementTotal: number}} view
 * @param {{from?: number, refsFrom?: number, readAt?: string|null, refused?: string[]}} [opts]
 * @returns {string}
 */
export const renderView = (view, { from = 0, refsFrom = 1, readAt = null, refused = [] } = {}) => {
  const start = Math.min(toCount(from), view.text.length);
  const words = view.text.slice(start, start + TEXT_WINDOW);
  const wordsEnd = start + words.length;
  const firstRef = Math.max(1, toCount(refsFrom) || 1);
  const shown = view.elements.filter((e) => e.ref >= firstRef).slice(0, REF_WINDOW);
  const lastRef = shown.length ? shown[shown.length - 1].ref : firstRef - 1;

  const notes = [];
  if (start > 0 || wordsEnd < view.text.length) {
    notes.push(`words ${start.toLocaleString('en-US')}–${wordsEnd.toLocaleString('en-US')} of ${view.text.length.toLocaleString('en-US')}`
      + (wordsEnd < view.text.length ? `; read on with browser_look {from: ${wordsEnd}}` : ''));
  }
  if (view.textTotal > view.text.length) notes.push(`the page holds ${view.textTotal.toLocaleString('en-US')} characters; only the first ${view.text.length.toLocaleString('en-US')} could be carried back`);
  if (firstRef > 1 || lastRef < view.elements.length) {
    notes.push(`numbered things ${shown.length ? `${firstRef}–${lastRef}` : 'none here'} of ${view.elements.length}`
      + (lastRef < view.elements.length ? `; see more with browser_look {refsFrom: ${lastRef + 1}}` : ''));
  }
  if (view.elementTotal > view.elements.length) notes.push(`${view.elementTotal - view.elements.length} more things on the page were not numbered`);

  const body = [
    view.title ? `${view.title}\n` : '',
    words || '(no words on this page)',
    `\n\nWhat you can act on:\n${shown.map(elementLine).join('\n') || '(nothing numbered here)'}`,
  ].join('\n');
  const head = `${view.url}${readAt ? `\nread ${readAt}` : ''}${notes.length ? `\n[${notes.join(' · ')}]` : ''}`;
  const blocked = refused.length
    ? `\nRefused by the platform (this computer or its network, never reached): ${refused.slice(0, 5).join(', ')}${refused.length > 5 ? ` and ${refused.length - 5} more` : ''}`
    : '';
  return `${head}\n${frameUntrustedContent(`the page open in your browser at ${view.url}`, body)}\nAct with browser_click {ref} or browser_type {ref, text}.${blocked}`;
};
