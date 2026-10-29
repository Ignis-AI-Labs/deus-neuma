// use-desk-tabs — the impure shell around the pure tab model.
//
// Session tabs, slice 3. Everything that DECIDES lives in core/runtime
// (tabs-model, tab-budget); this holds the state, the persistence, and the one
// thing a window cannot know on its own — what the MACHINE is holding.
//
// THE MACHINE IS THE UNIT (ruling, 2026-07-30): […] So the counts that feed the
// budget come from the server's `tabs:counts` broadcast, never from this
// window's own strip. Two windows with 2 local tabs each is 4 against the rig's
// ceiling, and only the server can say so.
//
// Until the first broadcast lands we fall back to THIS window's counts. That is
// an undercount, never an overcount — the honest direction to be wrong in,
// because it can only refuse a tab that might have been allowed, and never
// allow one that should have been refused.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  openTab, closeTab, focusTab, renameTab, bindSession, retargetTab, moveTab,
  setTabFocus, countsByKind, focusedTab, houseTab, isHouseTab,
} from '../../../core/runtime/tabs-model.js';
import { TAB_KIND } from '../../../core/runtime/tab-budget.js';
import { loadTabs, saveTabs } from '../windowing/window-storage.js';
import { initialStreamTabs } from './initial-stream-tabs.js';

/** Impure — a tab id. Not in the pure model on purpose: ids are minted here so
 *  the model stays reproducible without a clock or a random source. */
const mintTabId = () => `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * @param {object} wsService - this window's portal link (for tabs:counts)
 * @param {{capacity?: object|null, activeSubstrate?: string|null, witnessCap?: number,
 *   capacityKnown?: boolean}} budgetCtx
 * @param {{scope?: string, initialPayload?: object|null}} [options] - WHICH stream window's strip this is. Every stream
 *   window runs its own sitting, so every one owns its own strip: with a single
 *   shared set, two windows holding different beings each retargeted the other's
 *   tab and the strip fought itself in front of the operator. Absent = the
 *   desk's own strip, on the key it has always used.
 */
export const useDeskTabs = (wsService, budgetCtx = {}, { scope, initialPayload = null } = {}) => {
  const [state, setState] = useState(() => initialStreamTabs(loadTabs(scope), initialPayload, mintTabId()));
  // WHICH tab rides this window's OWN portal (the anchor). Lifted out of
  // TabPortalHost (2026-09-01, the anchor leak): the desk must KNOW the
  // anchor's ground so the window's own stream can stamp it — when the id
  // lived below the stream's creation, the anchor's portal rode the bare
  // window lens and the sitting's ground never reached its frames. Session-
  // only by design: a socket reality, re-adopted on mount, never persisted.
  const [anchorTabId, setAnchorTabId] = useState(() => initialPayload?.neumaId ? state.focusedId : null);
  // The MACHINE's counts. null until the server tells us — see the fallback law
  // in the header comment.
  const [machineCounts, setMachineCounts] = useState(null);

  // Persist the full strip; restoring identity alone never activates a portal.
  useEffect(() => { saveTabs(state, scope); }, [state, scope]);

  useEffect(() => {
    if (!wsService?.on) return undefined;
    const onCounts = (data) => {
      if (typeof data?.local !== 'number' || typeof data?.witness !== 'number') return;
      setMachineCounts({ local: data.local, witness: data.witness });
    };
    wsService.on('tabs:counts', onCounts);
    return () => wsService.off?.('tabs:counts', onCounts);
  }, [wsService]);

  const stateRef = useRef(state);
  stateRef.current = state;

  // NO TAB IS EVER HELD BACK (ruling, 2026-10-15): […] A live
  // portal is a VIEW of a sitting; generation is what the rig runs out of, and
  // every turn waits its place in the house's line at the measured width
  // (substrate-lease.js), told its place and who is ahead.

  /**
   * Open a sitting on the strip. ALWAYS ALLOWED.
   *
   * Design note, 2026-08-29: […] A tab
   * is a row of state — a name, a being, a session id. It spends nothing the
   * machine can run out of, and the server's own count
   * (`machineTabCounts`, which walks bound sockets) does not move when one
   * appears. The budget is asked at ACTIVATION instead, where the portal that
   * costs a slot is actually opened. The strip's own hard cap still applies, in
   * the model.
   */
  const open = useCallback(({ kind, neumaId, name }, { focus = true } = {}) => {
    const tab = {
      id: mintTabId(),
      kind,
      neumaId,
      name: name || neumaId,
      createdAt: new Date().toISOString(),
    };
    setState((s) => openTab(s, tab, { focus }));
    return { tab, refusal: null };
  }, []);

  /**
   * TAKE IN a sitting that already exists — the receiving half of a transfer
   * between two stream windows (Design note, 2026-08-30: […]).
   *
   * Deliberately NOT `open`. That mints a fresh id and a fresh createdAt and
   * carries no session, which is right for a NEW sitting and wrong for a moving
   * one: the tab would arrive as a different conversation with the same being's
   * name on it, and the thread the operator was reading would be gone. The pure
   * model already adopts a whole tab verbatim — id, sessionId, createdAt and
   * its working ground — so this hands it straight through.
   */
  const adopt = useCallback((tab) => {
    if (!tab?.id || !tab?.neumaId) return { tab: null, refusal: { reason: 'that is not a sitting this strip can take' } };
    if (stateRef.current.tabs.some((t) => t.id === tab.id)) {
      return { tab, refusal: { reason: 'that sitting is already in this stream' } };
    }
    setState((s) => openTab(s, tab, { focus: true }));
    return { tab, refusal: null };
  }, []);

  const close = useCallback((id) => setState((s) => closeTab(s, id)), []);
  const focus = useCallback((id) => setState((s) => focusTab(s, id)), []);
  const rename = useCallback((id, name) => setState((s) => renameTab(s, id, name)), []);
  const bind = useCallback((id, sessionId) => setState((s) => bindSession(s, id, sessionId)), []);

  /**
   * Point a tab at a different being — a switch adjusts THIS tab only.
   *
   * The budget is deliberately NOT consulted. A switch is the operator acting on
   * a sitting that already exists, and refusing it would put a new gate on an
   * older gesture; the door that MINTS sittings is where the budget belongs.
   * Only the focused tab holds a live session today, so a strip switched wholly
   * to local costs the GPU one sitting — when per-tab streams land (the next
   * slice) this is the line that has to answer for itself.
   */
  const retarget = useCallback(
    (id, who) => setState((s) => retargetTab(s, id, who)),
    [],
  );

  /** Rearrange the strip. Presentation only — focus and the house tab both
   *  stay exactly where they were (see `moveTab` / `houseTab`). */
  const move = useCallback((id, toIndex) => setState((s) => moveTab(s, id, toIndex)), []);

  /**
   * Point a sitting at its own working ground — the folder or project its
   * Explorer, its portal frames and its reach all answer to.
   *
   * Design note, 2026-08-29: […]
   *
   * `null` hands the tab back to the window's own lens, which is what every
   * tab starts as — so a desk nobody has focused per-tab behaves exactly as it
   * always did.
   */
  const setTabGround = useCallback((id, focus) => {
    setState((s) => setTabFocus(s, id, focus));
  }, []);

  /** The ground of the sitting on screen, or null when it rides the window's
   *  lens. Read by the desk to decide what the Explorer is looking at. */
  const focusedGround = focusedTab(state)?.focus ?? null;

  /** The ANCHOR sitting's own ground — what this window's own portal must
   *  stamp. Null when no tab has been adopted yet or the anchor rides the
   *  window's lens (law 1). */
  const anchorGround = state.tabs.find((t) => t.id === anchorTabId)?.focus ?? null;

  const isHouse = useCallback((id) => isHouseTab(stateRef.current, id), []);
  // ONE value per real change (2026-09-28 smoothness pass): the desk re-renders
  // every streamed frame, and a fresh object here re-rendered every tab
  // consumer with it.
  return useMemo(() => ({
    state,
    // The machine-wide budget inputs, passed along so a stream window's own
    // strip asks the SAME question the desk does — the ceiling is a rig fact,
    // not a window's.
    budget: budgetCtx,
    tabs: state.tabs,
    focused: focusedTab(state),
    focusedId: state.focusedId,
    house: houseTab(state),
    isHouse,
    counts: countsByKind(state),
    machineCounts,
    anchorTabId,
    setAnchorTab: setAnchorTabId,
    anchorGround,
    open,
    adopt,
    close,
    focus,
    rename,
    bind,
    retarget,
    move,
    setTabGround,
    focusedGround,
    KIND: TAB_KIND,
  }), [state, budgetCtx, isHouse, machineCounts, anchorTabId, anchorGround, open, adopt, close,
    focus, rename, bind, retarget, move, setTabGround, focusedGround]);
};
