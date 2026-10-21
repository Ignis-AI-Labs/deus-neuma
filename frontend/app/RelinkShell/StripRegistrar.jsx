// StripRegistrar — publishes THIS stream window's tab strip to the desk.
//
// It exists because of where the two halves of the problem live. The desk owns
// the focus lens (RelinkShell provides FocusContext) but renders WindowManager,
// so it sits ABOVE the window context and cannot ask which window is focused. A
// stream window is INSIDE that context and can — but it is a sibling of the
// Explorer, not its parent, so no provider it mounts can reach the surface that
// picks the folder.
//
// So the stream window reports upward, into the module registry
// (stream-strips.js), and the desk reads the answer from there.
//
// Mounted inside chatApp's Provider, BELOW StreamWindowHost — that ordering is
// load-bearing. Instance 1 passes straight through to the desk's own
// TabsContext and instances 2+ get their own; reading useTabs() from below the
// host is what makes one component correct for both.

import { createContext, useContext, useEffect } from 'react';
import { useTabs } from './tabs-context.js';
import { useWindows } from '../windowing/use-windows.js';
import { registerStrip, markStripFocused, STREAM_APP } from './stream-strips.js';

/** WHICH stream window a surface is inside. The strip needs it to stamp its
 *  drags, and only this component knows it — StreamTabs is rendered deep in the
 *  window body and takes no props of its own. */
const StripWindowContext = createContext(null);

/** The stream window id this surface belongs to, or null off a stream window. */
export const useStripWindowId = () => useContext(StripWindowContext);

/**
 * @param {{windowId: string, children: any}} p
 */
export const StripRegistrar = ({ windowId, children }) => {
  const tabs = useTabs();
  const windows = useWindows();
  const focusedWindowId = windows?.state?.focusedId ?? null;

  const { focusedId, focusedGround, setTabGround, close, adopt, move, isHouse } = tabs || {};
  const tabList = tabs?.tabs;

  // Republish whenever anything the desk reads about this strip changes — the
  // focused tab or its ground. A stale entry here is a stale folder in the
  // Explorer, which is the whole bug this fixes.
  //
  // ⚠️ `tabs` ITSELF IS NOT A DEPENDENCY, and must never become one.
  // useDeskTabs returns a fresh object literal on every render, so depending on
  // it re-runs this effect every render: register → notify → the desk
  // re-renders → this window re-renders → a new `tabs` object → register…
  // React kills that with error #185 (maximum update depth). Depend only on the
  // VALUES published — the ids and arrays out of tab state, and the callbacks,
  // which useDeskTabs already holds stable with useCallback.
  useEffect(() => {
    if (!windowId || !setTabGround) return undefined;
    return registerStrip(windowId, {
      focusedId: focusedId ?? null,
      ground: focusedGround ?? null,
      setGround: setTabGround,
      tabs: tabList || [],
      adopt,
      close,
      move,
      isHouse,
      // THE CLOSE DOOR (ruling, 2026-09-15): a POPPED-OUT stream window that
      // drains to zero closes — docking its last sitting back into the stream
      // it was torn from is the tear-out undone. The desk's own strip never
      // carries the door: closing the desk is never a side effect of a tab
      // drag. Deliberately NOT in the dependency list — the closure is rebuilt
      // every render, and registerStrip's moved-check ignores it (the loop the
      // warning below describes).
      closeWindow: windowId !== STREAM_APP
        ? () => windows.dispatch({ type: 'CLOSE', id: windowId })
        : undefined,
    });
  }, [windowId, focusedId, focusedGround, setTabGround, tabList, adopt, close, move, isHouse]);

  // The one thing only this side of the tree can see: that this window is the
  // one the operator is in. Ordered after the registration effect so the strip
  // exists to be stamped.
  useEffect(() => {
    if (windowId && focusedWindowId === windowId) markStripFocused(windowId);
  }, [windowId, focusedWindowId]);

  return (
    <StripWindowContext.Provider value={windowId ?? null}>
      {children}
    </StripWindowContext.Provider>
  );
};
