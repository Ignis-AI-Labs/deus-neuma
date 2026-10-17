// delete-set — the Explorer's bulk-delete grammar, proven pure (RULE 0:
// real inputs, real outputs, no mock anywhere in the path).

import { describe, expect, it } from 'vitest';
import { deleteSetFor, isUnder } from '../../frontend/app/RelinkShell/files/delete-set.js';

describe('isUnder', () => {
  it('true strictly under a dir; false for the dir itself and prefix-sibling traps', () => {
    expect(isUnder('/a/b/c.txt', '/a/b')).toBe(true);
    expect(isUnder('/a/b', '/a/b')).toBe(false);
    expect(isUnder('/a/bc/x', '/a/b')).toBe(false);
    expect(isUnder('/a/b/c', '/a/b/')).toBe(true);
  });
});

describe('deleteSetFor', () => {
  const sel = (...p) => new Set(p);

  it('a click outside the selection takes only that row', () => {
    expect(deleteSetFor(sel('/r/a', '/r/b'), '/r/c', ['/r'])).toEqual(['/r/c']);
  });

  it('a click inside a multi-selection takes the whole selection, sorted', () => {
    expect(deleteSetFor(sel('/r/b', '/r/a'), '/r/a', ['/r'])).toEqual(['/r/a', '/r/b']);
  });

  it('a single-row selection behaves like a plain click', () => {
    expect(deleteSetFor(sel('/r/a'), '/r/a', ['/r'])).toEqual(['/r/a']);
  });

  it('open roots refuse — inside the selection and clicked directly', () => {
    expect(deleteSetFor(sel('/r', '/r/a'), '/r/a', ['/r'])).toEqual(['/r/a']);
    expect(deleteSetFor(sel(), '/r', ['/r'])).toEqual([]);
  });

  it('descendants fold into their selected ancestor', () => {
    expect(deleteSetFor(sel('/r/d', '/r/d/kid.txt', '/r/a'), '/r/a', ['/r'])).toEqual(['/r/a', '/r/d']);
  });

  it('an empty selection is tolerated', () => {
    expect(deleteSetFor(new Set(), '/r/a', ['/r'])).toEqual(['/r/a']);
  });
});
