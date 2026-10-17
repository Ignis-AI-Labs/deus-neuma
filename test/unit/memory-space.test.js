/**
 * Space descriptor tests (CORE-005 / #125, slice B1).
 *
 * normalizeSpace is the single source of truth for the episodic scope tag: it
 * runs on untrusted client payloads at ingestion AND as the read-side migration
 * default for untagged observations. Pure — no IO, no mocks.
 */

import { describe, test, expect } from 'vitest';
import { normalizeSpace, DEFAULT_SPACE, GENERAL_SPACE_ID } from '../../core/memory/space.js';

describe('normalizeSpace — defaults & migration', () => {
  test('GENERAL_SPACE_ID is the canonical general slug', () => {
    expect(GENERAL_SPACE_ID).toBe('general');
    expect(DEFAULT_SPACE).toEqual({ id: 'general', kind: 'workspace', label: 'General' });
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['a string (not an object)', 'lighthouse'],
    ['a number', 42],
    ['an empty object', {}],
    ['an object with no usable id', { kind: 'project', label: 'No Id' }],
  ])('%s collapses to the general space', (_label, input) => {
    expect(normalizeSpace(input)).toEqual(DEFAULT_SPACE);
  });

  test("the reserved id 'general' always returns the canonical space (no client re-label)", () => {
    expect(normalizeSpace({ id: 'general', kind: 'project', label: 'Hijacked' })).toEqual(DEFAULT_SPACE);
    expect(normalizeSpace({ id: 'GENERAL', label: 'still general' })).toEqual(DEFAULT_SPACE);
  });
});

describe('normalizeSpace — a real space', () => {
  test('keeps a clean descriptor and freezes the output', () => {
    const space = normalizeSpace({ id: 'lighthouse', kind: 'project', label: 'The Lighthouse' });
    expect(space).toEqual({ id: 'lighthouse', kind: 'project', label: 'The Lighthouse' });
    expect(Object.isFrozen(space)).toBe(true);
  });

  test('slugifies the id: lowercased, non-slug runs → single dash, edges trimmed', () => {
    expect(normalizeSpace({ id: '  My Project!! ' }).id).toBe('my-project');
    expect(normalizeSpace({ id: 'a//b\\c' }).id).toBe('a-b-c');
    expect(normalizeSpace({ id: '___keep_underscores___' }).id).toBe('keep_underscores');
  });

  test('caps the id length at 64 chars', () => {
    expect(normalizeSpace({ id: 'x'.repeat(200) }).id).toHaveLength(64);
  });

  test('an id that sanitizes away entirely falls back to general', () => {
    expect(normalizeSpace({ id: '!!!@@@###' })).toEqual(DEFAULT_SPACE);
    expect(normalizeSpace({ id: '   ' })).toEqual(DEFAULT_SPACE);
  });

  test('invalid kind defaults to workspace; only project|workspace allowed', () => {
    expect(normalizeSpace({ id: 'x', kind: 'galaxy' }).kind).toBe('workspace');
    expect(normalizeSpace({ id: 'x', kind: 'project' }).kind).toBe('project');
    expect(normalizeSpace({ id: 'x', kind: 'workspace' }).kind).toBe('workspace');
    expect(normalizeSpace({ id: 'x' }).kind).toBe('workspace');
  });

  test('kind is case-folded (lenient, like the id path); non-string → workspace', () => {
    expect(normalizeSpace({ id: 'x', kind: 'Project' }).kind).toBe('project');
    expect(normalizeSpace({ id: 'x', kind: 'WORKSPACE' }).kind).toBe('workspace');
    expect(normalizeSpace({ id: 'x', kind: 42 }).kind).toBe('workspace');
  });

  test('missing/blank label falls back to the slug id', () => {
    expect(normalizeSpace({ id: 'harbor' }).label).toBe('harbor');
    expect(normalizeSpace({ id: 'harbor', label: '   ' }).label).toBe('harbor');
    expect(normalizeSpace({ id: 'harbor', label: 42 }).label).toBe('harbor');
  });

  test('label strips control chars and folds whitespace (input built via fromCharCode)', () => {
    // TAB (0x09) + NUL (0x00) + newline (0x0A) — never typed as literals (the
    // harness mangles them); assembled numerically here.
    const dirty = `Deep${String.fromCharCode(9)}${String.fromCharCode(0)}  Work${String.fromCharCode(10)}Space`;
    expect(normalizeSpace({ id: 'deep', label: dirty }).label).toBe('Deep Work Space');
  });

  test('label also folds DEL (0x7F) and C1 controls (0x80–0x9F), honoring control-char-free', () => {
    // DEL + a C1 control — assembled numerically, never literal.
    const dirty = `A${String.fromCharCode(0x7f)}B${String.fromCharCode(0x90)}C`;
    expect(normalizeSpace({ id: 'x', label: dirty }).label).toBe('A B C');
  });

  test('caps the label length at 80 chars', () => {
    expect(normalizeSpace({ id: 'x', label: 'L'.repeat(200) }).label).toHaveLength(80);
  });

  test('bounds work on a hostile oversized id/label without losing the cap', () => {
    // A flood-sized payload must still cap correctly (and cheaply — the leading
    // slices stop us scanning the whole thing).
    expect(normalizeSpace({ id: 'a'.repeat(100000) }).id).toHaveLength(64);
    expect([...normalizeSpace({ id: 'x', label: 'L'.repeat(100000) }).label].length).toBe(80);
  });

  test('caps the label by code point — never splits an astral surrogate pair', () => {
    // 79 ASCII + one astral char (built via fromCodePoint, no literal/\\u in src):
    // the old UTF-16 slice would cut the emoji at unit 80 into a lone surrogate.
    const grin = String.fromCodePoint(0x1f600);
    const label = normalizeSpace({ id: 'x', label: 'a'.repeat(79) + grin }).label;
    expect([...label]).toHaveLength(80);
    expect(label.endsWith(grin)).toBe(true);
  });

  test('the id length cap does not leave a trailing separator', () => {
    // 63 'a' + space + 20 'b' → slug "a*63-b*20"; slice(0,64) lands on the dash,
    // which the post-cap re-trim removes.
    const id = normalizeSpace({ id: 'a'.repeat(63) + ' ' + 'b'.repeat(20) }).id;
    expect(id).toBe('a'.repeat(63));
    expect(id.endsWith('-')).toBe(false);
  });
});

describe('normalizeSpace — idempotence', () => {
  test('normalizing a normalized space is a no-op', () => {
    for (const input of [undefined, { id: 'x', kind: 'project', label: 'X' }, { id: 'general' }]) {
      const once = normalizeSpace(input);
      expect(normalizeSpace(once)).toEqual(once);
    }
  });
});
