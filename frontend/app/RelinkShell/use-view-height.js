// use-view-height — how tall the desk window holding a node is (FloatingWindow's
// [data-window-id] frame), or the browser window's when the node sits in no desk
// window. Never the node's own content height: a "short window" rule that measured
// content folded a head because the page below it happened to be short (#595 —
// hiding the queue composer folded the account head's four weeks).
//
// impure (DOM, ResizeObserver)

import { useCallback, useEffect, useState } from 'react';

/**
 * @returns {[(node: ?Element) => void, number]} a ref callback for the node, and its window's height in px (0 until read)
 */
export const useViewHeight = () => {
  const [node, setNode] = useState(null);
  const [h, setH] = useState(0);
  const ref = useCallback((el) => setNode(el), []);
  useEffect(() => {
    if (!node) return undefined;
    const frame = node.closest('[data-window-id]');
    const read = () => setH(frame ? frame.getBoundingClientRect().height : window.innerHeight);
    read();
    window.addEventListener('resize', read);
    const ro = frame && typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    ro?.observe(frame);
    return () => { window.removeEventListener('resize', read); ro?.disconnect(); };
  }, [node]);
  return [ref, h];
};
