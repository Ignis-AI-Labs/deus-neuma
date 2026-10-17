/**
 * Pure — split the final prompt before its clock section, keeping the changing
 * tail outside the cache breakpoint. Joining both halves with two newlines
 * reproduces the original prompt. An absent clock or stable head means no split.
 * @param {ReadonlyArray<{id: string, text: string}>} sections
 * @returns {{stable: string, volatile: string}|null}
 */
export const stablePromptSplit = (sections) => {
  const cut = sections.findIndex((section) => section.id === 'present');
  if (cut <= 0) return null;
  const join = (list) => list.map((section) => section.text).join('\n\n');
  const split = { stable: join(sections.slice(0, cut)), volatile: join(sections.slice(cut)) };
  // The tail section by section, for the local wire's carry (say it once) —
  // non-enumerable, so every reader of {stable, volatile} sees exactly that.
  Object.defineProperty(split, 'volatileSections', {
    value: Object.freeze(sections.slice(cut).map(({ id, label, text }) => Object.freeze({ id, label, text }))),
    enumerable: false,
  });
  return Object.freeze(split);
};
