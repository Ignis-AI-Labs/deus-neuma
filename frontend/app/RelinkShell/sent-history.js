// sent-history.js — CLI-style recall over the witness's sent messages.
//
// Pure stepper: ArrowUp in the composer walks BACK through what was sent
// (newest first), ArrowDown walks forward again and past the newest returns
// to the empty field — readline muscle memory, the same the CLI has. The
// component owns when stepping is allowed (empty field, or a draft that IS
// the recalled entry — an edited draft is never clobbered); this module
// owns only the arithmetic, so it is provable without a DOM.

/**
 * One step through the sent history.
 * @param {string[]} history - sent texts, oldest → newest
 * @param {number|null} cursor - current recall index (null = not navigating)
 * @param {'back'|'forward'} dir
 * @returns {{cursor: number|null, text: string}|null} the step taken, or
 *   null when there is nowhere to go (empty history; back past the oldest;
 *   forward while not navigating)
 */
export const stepRecall = (history, cursor, dir) => {
  const len = Array.isArray(history) ? history.length : 0;
  if (len === 0) return null;
  if (dir === 'back') {
    const idx = cursor === null ? len - 1 : cursor - 1;
    if (idx < 0) return null; // already at the oldest — stay
    return { cursor: idx, text: history[idx] };
  }
  if (cursor === null) return null; // not navigating — Down means nothing
  const idx = cursor + 1;
  if (idx >= len) return { cursor: null, text: '' }; // past the newest — back to empty
  return { cursor: idx, text: history[idx] };
};

/**
 * May the composer step away from the current draft? Only when the field is
 * empty or still holds exactly the entry the cursor recalled — typed words
 * are never overwritten by navigation. Pure.
 * @param {string} value - the current draft
 * @param {string[]} history
 * @param {number|null} cursor
 */
export const mayStep = (value, history, cursor) =>
  value === '' || (cursor !== null && value === history[cursor]);
