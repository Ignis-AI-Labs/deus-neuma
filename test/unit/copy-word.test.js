/**
 * speechText — the copyable prose of a message (copy-text.js). Chips,
 * images, and UI segments never enter the clipboard: a copied reply pastes
 * as words, not as interface debris.
 */
import { describe, expect, test } from 'vitest';
import { speechText, codeBlockText } from '../../frontend/app/RelinkShell/copy-text.js';

describe('speechText', () => {
  test('joins speech segments whole, in order', () => {
    expect(speechText([
      { kind: 'speech', text: 'The record is now set. ' },
      { kind: 'speech', text: 'I have etched our declarations.' },
    ])).toBe('The record is now set. I have etched our declarations.');
  });

  test('unkinded text segments (the 1:1 stream shape) copy too', () => {
    expect(speechText([{ text: 'plain words' }])).toBe('plain words');
  });

  test('chips and images stay out of the clipboard', () => {
    expect(speechText([
      { kind: 'tool', label: 'write_file', text: 'never this' },
      { kind: 'speech', text: 'only this' },
      { kind: 'image', src: 'x.png' },
      { kind: 'approval', id: 'a1' },
    ])).toBe('only this');
  });

  test('empty and absent segments yield nothing to copy', () => {
    expect(speechText([])).toBe('');
    expect(speechText()).toBe('');
    expect(speechText([{ kind: 'speech', text: '   ' }])).toBe('');
  });
});

// The fenced block's own COPY (Markdown.jsx pre override) — the block alone,
// never the framing prose around it.
describe('codeBlockText', () => {
  // The hast shape react-markdown hands a `pre` override: the block's code
  // element holds plain text children (no highlighter runs on this desk).
  const preNode = (texts) => ({
    tagName: 'pre',
    children: [{ tagName: 'code', children: texts.map((value) => ({ type: 'text', value })) }],
  });

  test('a fenced block copies its raw text, one trailing newline trimmed', () => {
    expect(codeBlockText(preNode(['- LPs are reimbursed.\n', '- The tenth audit is done.\n'])))
      .toBe('- LPs are reimbursed.\n- The tenth audit is done.');
  });

  test('the block alone — no framing prose, no fence — rides the clipboard', () => {
    const text = codeBlockText(preNode(["You've been waiting for the full account.\n"]));
    expect(text).toBe("You've been waiting for the full account.");
    expect(text).not.toContain('```');
  });

  test('a shape that is not a text block answers nothing — never a wrong copy', () => {
    expect(codeBlockText(null)).toBe('');
    expect(codeBlockText({})).toBe('');
    expect(codeBlockText({ children: [] })).toBe('');
    expect(codeBlockText(preNode([]))).toBe('');
    expect(codeBlockText({
      children: [{ tagName: 'code', children: [{ type: 'element', tagName: 'span' }] }],
    })).toBe('');
  });
});
