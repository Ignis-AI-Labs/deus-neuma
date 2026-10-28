// What a right-click was over, read the moment the menu opens (the selection
// still stands then): the sentence the word sits in, and the message box of
// the chat window it was read in — where ASK IN CHAT drafts its question.
// impure — reads the live selection and DOM.

import { sentenceAround } from './define-view.js';

const COMPOSER = 'textarea.relink-input-field:not(:disabled)';
const BLOCK = 'p, li, blockquote, td, h1, h2, h3, h4, h5, h6, pre';

// impure — the block text around the selection, and where the selection starts in it
const selectedIn = () => {
  const field = document.activeElement;
  if (field && (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT') && field.selectionStart !== field.selectionEnd) {
    return { text: field.value, at: field.selectionStart, from: field };
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { text: '', at: 0, from: null };
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const from = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const block = from?.closest(BLOCK) || from;
  if (!block) return { text: '', at: 0, from: null };
  const before = document.createRange();
  before.setStart(block, 0);
  before.setEnd(range.startContainer, range.startOffset);
  return { text: block.textContent || '', at: before.toString().length, from };
};

// impure — the message box this chat window drafts in; the desk's only one when
// the word was read outside any chat window; null when there is no telling
const composerFor = (from) => {
  const own = from?.closest('[data-window-id]')?.querySelector(COMPOSER);
  if (own) return own;
  const all = document.querySelectorAll(COMPOSER);
  return all.length === 1 ? all[0] : null;
};

/**
 * impure — the sentence and the message box for the word under a right-click.
 * @returns {{ sentence: string, composer: HTMLTextAreaElement|null }}
 */
export const defineContextNow = () => {
  const { text, at, from } = selectedIn();
  return { sentence: sentenceAround(text, at), composer: composerFor(from) };
};
