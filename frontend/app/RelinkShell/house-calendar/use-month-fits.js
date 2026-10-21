// use-month-fits — how many entries a month day can show whole, from the size
// the grid actually has. The month's rows share the window's height, so a
// tall window shows more of each day and a short one fewer, the rest folded
// into "+N" — never a fixed count that clips on one screen and wastes another.
import { useCallback, useEffect, useRef, useState } from 'react';

const LINE = 18;  // one entry: 12px words at 1.3, and the 2px between entries
const MORE = 16;  // the "+N" line kept free beneath the entries

/** The entries that fit one day, given its height and its date line. Pure. */
export const fitsIn = (rowHeight, headHeight) => Math.max(1, Math.min(8, Math.floor((rowHeight - headHeight - MORE) / LINE)));

/** @returns {[(node: ?HTMLElement) => void, number]} a ref for the month's wrapper, and the count */
export const useMonthFits = (initial = 2) => {
  const [fits, setFits] = useState(initial);
  const observer = useRef(null);
  const attach = useCallback((node) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const cell = node.querySelector('.qcal-cell:not(.is-pad)');
      const head = cell?.querySelector('.qcal-day');
      if (!cell || !head) return;
      const style = getComputedStyle(cell);
      const inner = cell.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      setFits(fitsIn(inner, head.offsetHeight + parseFloat(style.rowGap || 0)));
    };
    observer.current = new ResizeObserver(measure);
    observer.current.observe(node);
    measure();
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [attach, fits];
};
