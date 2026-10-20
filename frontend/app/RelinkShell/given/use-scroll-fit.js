// use-scroll-fit — how tall a column may stand and still be seen whole: the
// visible height of the panel that scrolls it, less the strip that sticks over
// it. Set as `--gv-fit` on the node, so a long list (the sky's atlas) scrolls
// in its own frame instead of stretching the page — measured from the window
// the sheet really has, never a fixed vh that is wrong in a desk window.
import { useCallback, useEffect, useRef } from 'react';

const scrollerOf = (node) => {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === 'auto' || overflowY === 'scroll') return el;
  }
  return null;
};

/**
 * @param {number} stick the px the column sticks below the scroller's top (the tab strip)
 * @param {number} floor the px the column never shrinks under
 * @returns {(node: ?HTMLElement) => void} a ref for the element that carries `--gv-fit`
 */
export const useScrollFit = (stick, floor = 320) => {
  const observer = useRef(null);
  const attach = useCallback((node) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const scroller = scrollerOf(node);
    if (!scroller) return;
    const measure = () => {
      const pad = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
      node.style.setProperty('--gv-fit', `${Math.max(floor, scroller.clientHeight - stick - pad)}px`);
    };
    observer.current = new ResizeObserver(measure);
    observer.current.observe(scroller);
    measure();
  }, [stick, floor]);
  useEffect(() => () => observer.current?.disconnect(), []);
  return attach;
};
