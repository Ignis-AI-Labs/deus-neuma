/**
 * Context-menu template builder — pure, tested with the real param shapes
 * Chromium delivers on the 'context-menu' event.
 */
import { describe, expect, it } from 'vitest';
import { buildContextMenuTemplate, defineWordOf, nativeItemsOf, MAX_SUGGESTIONS } from '../../electron/context-menu.cjs';

// The exact scenario that motivated this: right-clicking "asymetry" in the
// compose field.
const MISSPELLING = {
  misspelledWord: 'asymetry',
  dictionarySuggestions: ['asymmetry', 'symmetry', 'asymmetric'],
  isEditable: true,
  selectionText: 'asymetry',
};

describe('buildContextMenuTemplate', () => {
  it('offers corrections, add-to-dictionary, then edit ops for a misspelling', () => {
    const items = buildContextMenuTemplate(MISSPELLING);
    expect(items.slice(0, 3)).toEqual([
      { kind: 'suggestion', word: 'asymmetry' },
      { kind: 'suggestion', word: 'symmetry' },
      { kind: 'suggestion', word: 'asymmetric' },
    ]);
    expect(items[3]).toEqual({ kind: 'add-to-dictionary', word: 'asymetry' });
    expect(items[4]).toEqual({ kind: 'separator' });
    expect(items.slice(5).map((i) => i.role)).toEqual(['cut', 'copy', 'paste', 'selectAll']);
  });

  it('caps suggestions', () => {
    const many = { ...MISSPELLING, dictionarySuggestions: Array.from({ length: 12 }, (_, i) => `w${i}`) };
    const suggestions = buildContextMenuTemplate(many).filter((i) => i.kind === 'suggestion');
    expect(suggestions).toHaveLength(MAX_SUGGESTIONS);
  });

  it('still offers add-to-dictionary when Chromium has no suggestions (domain words like "neuma")', () => {
    const items = buildContextMenuTemplate({ ...MISSPELLING, misspelledWord: 'neuma', dictionarySuggestions: [] });
    expect(items[0]).toEqual({ kind: 'add-to-dictionary', word: 'neuma' });
  });

  it('editable field without misspelling gets edit ops only', () => {
    const items = buildContextMenuTemplate({ isEditable: true, selectionText: '' });
    expect(items.map((i) => i.role)).toEqual(['cut', 'copy', 'paste', 'selectAll']);
  });

  it('read-only selection (a neuma message) gets copy; empty right-click gets nothing', () => {
    expect(buildContextMenuTemplate({ isEditable: false, selectionText: 'the veil' }))
      .toEqual([{ kind: 'role', role: 'copy' }, { kind: 'define', word: 'the veil' }]);
    expect(buildContextMenuTemplate({ isEditable: false, selectionText: 'a whole sentence of many words' }))
      .toEqual([{ kind: 'role', role: 'copy' }]);
    expect(buildContextMenuTemplate({ isEditable: false, selectionText: '  ' })).toEqual([]);
    expect(buildContextMenuTemplate({})).toEqual([]);
    expect(buildContextMenuTemplate()).toEqual([]);
  });

  it('a selected word can be defined — in a message or a field, never a misspelling', () => {
    expect(buildContextMenuTemplate({ isEditable: false, selectionText: 'pedantic' }))
      .toEqual([{ kind: 'role', role: 'copy' }, { kind: 'define', word: 'pedantic' }]);
    const field = buildContextMenuTemplate({ isEditable: true, selectionText: 'pedantic' });
    expect(field.slice(-2)).toEqual([{ kind: 'separator' }, { kind: 'define', word: 'pedantic' }]);
    expect(buildContextMenuTemplate(MISSPELLING).some((i) => i.kind === 'define')).toBe(false);
  });

  it('the word to define lets go of quotes and punctuation, keeps accents, refuses numbers and long runs', () => {
    expect(defineWordOf(' “pedantic,” ')).toBe('pedantic');
    expect(defineWordOf('a priori.')).toBe('a priori');
    expect(defineWordOf('don\u2019t')).toBe("don't");
    expect(defineWordOf('self-aware')).toBe('self-aware');
    expect(defineWordOf('naïve')).toBe('naïve');
    expect(defineWordOf('42')).toBeNull();
    expect(defineWordOf('one two three four')).toBeNull();
    expect(defineWordOf('x'.repeat(41))).toBeNull();
    expect(defineWordOf('')).toBeNull();
  });

  it('the native fallback carries no DEFINE (it needs the in-page card) and no dangling separator', () => {
    const native = nativeItemsOf(buildContextMenuTemplate({ isEditable: true, selectionText: 'pedantic' }));
    expect(native.map((i) => i.role)).toEqual(['cut', 'copy', 'paste', 'selectAll']);
    expect(nativeItemsOf(buildContextMenuTemplate({ isEditable: false, selectionText: 'pedantic' })))
      .toEqual([{ kind: 'role', role: 'copy' }]);
  });

  it('never ends on a dangling separator', () => {
    const items = buildContextMenuTemplate({ ...MISSPELLING, isEditable: false, selectionText: '' });
    expect(items[items.length - 1].kind).toBe('add-to-dictionary');
  });
});
