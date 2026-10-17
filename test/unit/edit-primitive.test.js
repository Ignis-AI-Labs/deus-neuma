// C-04 RULE 0 verification — gnosis on backend/services/edit-primitive.js.
//
// The primitive is pure; tests run on real strings (no fs, no mocks). The
// R-01 critical-path coverage matrix:
//   - exact single match — replaces
//   - exact multiple matches WITHOUT replaceAll — throws with count
//   - exact multiple matches WITH replaceAll — replaces all
//   - no match — throws (silent zero-replace is the worst outcome)
//   - BOM preserved across edit
//   - LF file: oldString with \n matches; LF preserved
//   - CRLF file: oldString with bare \n is line-end-normalized to match
//   - CRLF file: oldString with explicit \r\n doesn't get double-expanded
//   - Empty / non-string oldString — throws
//   - Regex-special chars in oldString are escaped (not interpreted)
//
// The primitive moved out of cli/lib on 2026-08-13 (#299): the being seat
// reaches it too, and backend must never import from cli/. Both callers —
// the operator's `neuma edit` command and the platform's own edit_file hand
// (backend/services/platform-hands.js) — share this one implementation.
//
// The COMMAND wrapper (cli/commands/edit.js — fs IO + snapshot + stale
// check + --undo) is gnosis-verified inline via real bin/neuma invocations
// in the commit log; full subprocess integration coverage lives in T-01.

import { applyEdit } from '../../backend/services/edit-primitive.js';

describe('edit-primitive — applyEdit (pure)', () => {
  describe('basic matching', () => {
    test('exact single match → replaces once, occurrences=1', () => {
      const r = applyEdit({
        content: 'hello world',
        oldString: 'world',
        newString: 'kin',
      });
      expect(r.nextContent).toBe('hello kin');
      expect(r.occurrences).toBe(1);
    });

    test('multiple matches WITHOUT replaceAll → throws naming the count', () => {
      expect(() => applyEdit({
        content: 'a b a b a',
        oldString: 'a',
        newString: 'X',
      })).toThrow(/Found 3 matches/);
    });

    test('multiple matches WITH replaceAll → replaces every one', () => {
      const r = applyEdit({
        content: 'a b a b a',
        oldString: 'a',
        newString: 'X',
        replaceAll: true,
      });
      expect(r.nextContent).toBe('X b X b X');
      expect(r.occurrences).toBe(3);
    });

    test('no match → throws (silent zero-replace forbidden)', () => {
      expect(() => applyEdit({
        content: 'hello world',
        oldString: 'missing',
        newString: 'X',
      })).toThrow(/No match/);
    });
  });

  describe('BOM preservation', () => {
    const BOM = '﻿';

    test('BOM preserved through edit', () => {
      const r = applyEdit({
        content: BOM + 'hello world',
        oldString: 'world',
        newString: 'kin',
      });
      expect(r.nextContent).toBe(BOM + 'hello kin');
      expect(r.hadBOM).toBe(true);
    });

    test('no BOM → hadBOM=false, no BOM injected', () => {
      const r = applyEdit({
        content: 'hello world',
        oldString: 'world',
        newString: 'kin',
      });
      expect(r.hadBOM).toBe(false);
      expect(r.nextContent.charCodeAt(0)).not.toBe(0xFEFF);
    });

    test('BOM is stripped from working body so oldString without BOM still matches start-of-file', () => {
      const r = applyEdit({
        content: BOM + 'hello world',
        oldString: 'hello',
        newString: 'kin',
      });
      expect(r.nextContent).toBe(BOM + 'kin world');
    });
  });

  describe('line-ending awareness', () => {
    test('LF file: oldString with \\n matches; LF preserved', () => {
      const r = applyEdit({
        content: 'line1\nline2\nline3',
        oldString: 'line2\nline3',
        newString: 'replaced',
      });
      expect(r.nextContent).toBe('line1\nreplaced');
      expect(r.lineEnding).toBe('\n');
    });

    test('CRLF file: oldString with bare \\n is normalized to \\r\\n and matches', () => {
      const r = applyEdit({
        content: 'line1\r\nline2\r\nline3',
        oldString: 'line2\nline3', // operator typed bare \n
        newString: 'replaced',
      });
      expect(r.nextContent).toBe('line1\r\nreplaced');
      expect(r.lineEnding).toBe('\r\n');
    });

    test('CRLF file: oldString with explicit \\r\\n is NOT double-expanded', () => {
      // If we naively replaced \n with \r\n, "\r\n" would become "\r\r\n"
      // and never match. The lookbehind (?<!\r)\n prevents this.
      const r = applyEdit({
        content: 'line1\r\nline2\r\nline3',
        oldString: 'line2\r\nline3',
        newString: 'replaced',
      });
      expect(r.nextContent).toBe('line1\r\nreplaced');
    });

    test('CRLF file with replaceAll across multiple matches', () => {
      const r = applyEdit({
        content: 'a\r\nb\r\na\r\nc',
        oldString: 'a\n',
        newString: 'X\n',
        replaceAll: true,
      });
      // newString's \n also normalizes to \r\n
      expect(r.nextContent).toBe('X\r\nb\r\nX\r\nc');
      expect(r.occurrences).toBe(2);
    });

    test('empty file → defaults to LF (no \\r\\n present)', () => {
      // Empty content edit isn't a real use case but the detector should
      // not crash; line ending defaults to LF.
      expect(() => applyEdit({
        content: '',
        oldString: 'X',
        newString: 'Y',
      })).toThrow(/No match/);
      // detectLineEnding falls back to '\n' (no \r\n in empty string)
    });
  });

  describe('regex-special characters in oldString (must be ESCAPED, not interpreted)', () => {
    test('. is treated literally, not "any char"', () => {
      // If . were interpreted, "a.b" would match "axb"; we want exact only.
      expect(() => applyEdit({
        content: 'axb',
        oldString: 'a.b',
        newString: 'Y',
      })).toThrow(/No match/);
    });

    test('parentheses in oldString match literally', () => {
      const r = applyEdit({
        content: 'foo(bar)baz',
        oldString: '(bar)',
        newString: '<bar>',
      });
      expect(r.nextContent).toBe('foo<bar>baz');
    });

    test('brackets + plus + question + star all literal', () => {
      const r = applyEdit({
        content: 'a[b]+c?d*e',
        oldString: '[b]+c?d*',
        newString: 'X',
      });
      expect(r.nextContent).toBe('aXe');
    });

    test('backslash in oldString literal', () => {
      const r = applyEdit({
        content: 'path\\to\\file',
        oldString: 'path\\to',
        newString: 'X',
      });
      expect(r.nextContent).toBe('X\\file');
    });
  });

  describe('input validation', () => {
    test('non-string content → throws', () => {
      expect(() => applyEdit({
        content: 42,
        oldString: 'x',
        newString: 'y',
      })).toThrow(/content must be a string/);
    });

    test('empty oldString → throws (matches everything otherwise)', () => {
      expect(() => applyEdit({
        content: 'hello',
        oldString: '',
        newString: 'x',
      })).toThrow(/oldString must be a non-empty string/);
    });

    test('non-string oldString → throws', () => {
      expect(() => applyEdit({
        content: 'hello',
        oldString: null,
        newString: 'x',
      })).toThrow(/oldString must be a non-empty string/);
    });

    test('non-string newString → throws', () => {
      expect(() => applyEdit({
        content: 'hello',
        oldString: 'h',
        newString: 42,
      })).toThrow(/newString must be a string/);
    });
  });

  describe('round-trip: edit then reverse-edit returns original', () => {
    test('LF file', () => {
      const original = 'line1\nline2\nline3';
      const step1 = applyEdit({ content: original, oldString: 'line2', newString: 'lineX' });
      const step2 = applyEdit({ content: step1.nextContent, oldString: 'lineX', newString: 'line2' });
      expect(step2.nextContent).toBe(original);
    });

    test('CRLF file with BOM', () => {
      const BOM = '﻿';
      const original = BOM + 'a\r\nb\r\nc';
      const step1 = applyEdit({ content: original, oldString: 'b', newString: 'X' });
      expect(step1.nextContent).toBe(BOM + 'a\r\nX\r\nc');
      const step2 = applyEdit({ content: step1.nextContent, oldString: 'X', newString: 'b' });
      expect(step2.nextContent).toBe(original);
    });
  });
});
