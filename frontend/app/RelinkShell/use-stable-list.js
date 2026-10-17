// use-stable-list.js — hold a derived list's identity while its contents hold.
//
// A list rebuilt from the transcript is a NEW array every streamed frame even
// when nothing in it moved; handed to a memoized child, it re-renders that
// child every frame (2026-09-28 smoothness pass). Same members, same order →
// the previous array comes back.

import { useRef } from 'react';

export const useStableList = (list) => {
  const ref = useRef(list);
  const prev = ref.current;
  if (prev !== list && (prev.length !== list.length || prev.some((x, i) => x !== list[i]))) ref.current = list;
  return ref.current;
};
