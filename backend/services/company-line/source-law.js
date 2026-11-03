// SHINKEI (true measure) as one law: what counts as a SOURCE for a figure or a
// claim anywhere on the company line — the worksheets, the books, a raise's
// facts sheet. A source is an https link, a path on the house ground
// (repos/…), or first-hand evidence of a kind the caller accepts, written as
// '<kind>: <what, who, when>'. Each caller names its kinds; the rest is shared.
// PURE.

/**
 * A source check for these evidence kinds. pure.
 * @param {ReadonlyArray<string>} kinds - e.g. ['interview', 'email']
 * @returns {{isSource: (v: unknown) => boolean, words: string}}
 */
export const sourceLaw = (kinds) => {
  const evidence = new RegExp(`^(${kinds.join('|')}):\\s*\\S.{4,}`, 'i');
  const isSource = (v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s.startsWith('repos/') && s.length > 8) return true;
    if (evidence.test(s)) return true;
    try {
      return new URL(s).protocol === 'https:';
    } catch {
      return false;
    }
  };
  return { isSource, words: `a source is an https link, a repos/ path on the house ground, or first-hand evidence like "${kinds[0]}: who, when"` };
};
