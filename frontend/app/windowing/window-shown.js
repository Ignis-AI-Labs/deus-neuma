// window-shown — does the window this body lives in show its body right now?
//
// Minimize is an in-place window-shade (FloatingWindow): the body stays
// MOUNTED under a collapsed frame, so every poll and animation inside it kept
// running with nobody looking. The frame publishes its own truth here; the
// visible-interval gate and the aura loop read it. Outside any window (a
// docked panel, a torn-out tab, a test) the answer is true — only a frame
// that knows it is shaded may say no.

import { createContext, useContext } from 'react';

export const WindowShownContext = createContext(true);

/** @returns {boolean} false only while the enclosing window is window-shaded */
export const useWindowShown = () => useContext(WindowShownContext);
