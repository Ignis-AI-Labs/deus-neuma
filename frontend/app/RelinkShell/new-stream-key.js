// new-stream-key.js — Ctrl/Cmd+Shift+N opens a new stream window.
//
// Design note, 2026-09-29: […] The same act as the dock's NEW row on
// the stream app: a sibling stream window with its own portal and sitting.
//
// Answers inside text fields too: the chord types nothing, so there is no
// keystroke to steal (unlike Shift+\, which is the `|` character). Alt must be
// up — Ctrl+Alt+Shift+N is the app menu's separate-sign-in desk. A held key
// never spawns a row of windows. In a browser tab Chrome keeps this chord for
// its own incognito window; the desktop app is where it answers.

import { useEffect } from 'react';
import { useWindows } from '../windowing/use-windows.js';

/**
 * Does this keydown ask for a new stream? Pure.
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
export const isNewStreamChord = (e) => Boolean(
  e && !e.repeat && e.shiftKey && !e.altKey && (e.ctrlKey || e.metaKey)
  && (e.code === 'KeyN' || String(e.key).toLowerCase() === 'n'),
);

/** Binds the chord for the desk this hook runs in. Impure (window listener). */
const useNewStreamKey = () => {
  const dispatch = useWindows()?.dispatch;
  useEffect(() => {
    if (!dispatch) return undefined;
    const onKey = (e) => {
      if (!isNewStreamChord(e)) return;
      e.preventDefault();
      dispatch({ type: 'OPEN_NEW', appId: 'chat' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);
};

/** Renders nothing; lives inside the WindowManager so the chord reaches it. */
export const NewStreamKey = () => {
  useNewStreamKey();
  return null;
};
