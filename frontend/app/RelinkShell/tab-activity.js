// tab-activity.js — which tab rides which portal, and who is mid-turn.
//
// A leaf on purpose: TabPortalHost provides this context and StreamTabs reads
// it, and each of those two imports the other's file for something else —
// the context living in either one would close an import cycle.

import { createContext, useContext } from 'react';

/**
 * `{ byTab: {tabId: boolean}, anchorTabId: string|null, liveIds: string[] }`
 *
 * - `byTab` — a tab id maps true while its sitting is mid-turn (thinking or
 *   streaming).
 * - `anchorTabId` — the tab riding this window's own portal, or null before any
 *   tab has claimed it.
 * - `liveIds` — every tab that actually HOLDS a portal right now: the anchor
 *   plus each activated tab. This is the set that costs the machine something,
 *   so it is the set the tab budget is asked about (Design note, 2026-08-29: […]). A tab absent from it is open but dormant —
 *   free, and free to stay on the strip.
 *
 * Null where no TabPortalHost is mounted.
 */
export const TabActivityContext = createContext(null);

export const useTabActivity = () => useContext(TabActivityContext);
