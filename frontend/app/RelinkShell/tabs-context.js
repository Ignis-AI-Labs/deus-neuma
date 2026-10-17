// tabs-context — the desk's tab strip, reachable from the STREAM window.
//
// The tabs LIVE at desk level (beside the consciousness stream, so a sitting
// outlives the chat window being closed), but the STRIP renders inside the
// stream — Design note, 2026-07-30: […] Tabs are a property of the conversation surface, not
// of the desk chrome, and putting the strip where the sittings are is also what
// keeps the desk mounted when one is switched.

import { createContext, useContext } from 'react';

export const TabsContext = createContext(null);

/** The desk's tabs, or null on a surface mounted outside the provider. */
export const useTabs = () => useContext(TabsContext);
