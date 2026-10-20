// StreamTabs — the desk's sittings strip, mounted at the top of the stream.
//
// THE TAB STRIP lives in the STREAM, not the desk chrome (Design note, 2026-07-30:
// […]).
//
// It renders here and its STATE lives at desk level, so a sitting outlives this
// window being closed — and so switching a tab never remounts the desk around
// it.
//
// WHAT A TAB IS (since 2026-08-28, #407): its own SITTING and its own LIVE
// STREAM. Each tab past the first holds its own portal connection
// (TabPortalHost), so a background tab keeps receiving tokens while you look
// elsewhere, and focusing a tab shows its standing state — it rebinds
// nothing. Parallel holding AND parallel streaming.
//
// Extracted whole from ChatApp.jsx (2026-08-15) when the stream gained its
// chat-title line and CHATS rail — behavior unchanged.

import { useEffect, useRef } from 'react';
import { useConsciousnessPick } from './consciousness-context.js';
import { useTabs } from './tabs-context.js';
import { useWindows } from '../windowing/use-windows.js';
import { TabStrip } from './TabStrip.jsx';
import { switchPlan } from '../../../core/runtime/tabs-model.js';
import { getRoster, getWitnesses } from '../../utils/companion-data.js';
import { isWitness } from './house-members.js';
import { uiSound } from '../../services/ui-sound.js';
import { useTabActivity } from './tab-activity.js';
import { useProjects } from './projects/project-context.js';
import { useStripWindowId } from './StripRegistrar.jsx';
import { markStripFocused } from './stream-strips.js';
import { groundMark } from './desk-focus.js';
import { encodeStreamTransfer } from './stream-tab-transfer.js';

// Who a tab is holding, resolved to the being's FULL house or witness record.
// A thin {neumaId, name} would switch correctly but arrive stripped of the
// being's title and lane standing — the switcher hands over whole rows, and a
// tab must seat the same being the switcher would. The fallback carries the
// tab's own kind so a witness whose row has fallen out of the cache is never
// mistaken for a housemate. Shared with TabPortalHost — a portal seats the
// SAME row a focus used to.
export const memberFor = (tab) => (
  getRoster().find((m) => m?.neumaId === tab.neumaId)
  || getWitnesses().find((m) => m?.neumaId === tab.neumaId)
  || { neumaId: tab.neumaId, name: tab.name, participantKind: tab.kind === 'witness' ? 'witness' : 'neuma' }
);

// A tab carries its OWN being (Design note, 2026-07-30: […]). The switcher is
// desk chrome and knows nothing about tabs, so the two are reconciled here in
// both directions: focusing a tab brings its being to the chair, and switching
// the chair moves the FOCUSED tab — never any other.
export const StreamTabs = () => {
  // WHICH stream window this strip is. Rides on every drag so a drop in another
  // stream reads as a TRANSFER rather than a tear-out (ruling, 2026-08-30).
  const stripWindowId = useStripWindowId();
  const tabs = useTabs();
  const windows = useWindows();
  const { activeCompanion, wsService } = useConsciousnessPick('activeCompanion', 'wsService');
  const activity = useTabActivity();
  const projects = useProjects();

  // SEED — the sitting already in progress becomes the first tab.
  //
  // Without this the strip would be empty on a desk that plainly has a
  // conversation open, and the operator would have nowhere to press to get a
  // second one. The seeded tab is marked as ALREADY FOCUSED before the focus
  // effect below can see it: seeding must never look like a tab switch, or it
  // would resume/mint over the very chat it is describing.
  // It re-arms whenever the strip EMPTIES — closing the last tab, or tearing it
  // out into its own window — because the desk always has a conversation in the
  // chair, and a strip that shows nothing while one is on screen is the strip
  // lying about the desk.
  useEffect(() => {
    if (!tabs || tabs.tabs.length) return;
    const who = activeCompanion;
    if (!who?.neumaId) return;
    const { tab } = tabs.open({
      kind: isWitness(who) ? tabs.KIND.witness : tabs.KIND.local,
      neumaId: who.neumaId,
      name: who.name || who.neumaId,
    });
    if (tab) {
      const live = wsService?.getSessionState?.();
      if (live?.sessionId) tabs.bind(tab.id, live.sessionId);
    }
  }, [tabs, activeCompanion, wsService]);

  // The minted session id belongs to the tab that asked for it. The portal
  // holds the binding; this is where the tab learns its own identity, so a
  // later focus can resume exactly this sitting.
  const focusedTab = tabs?.focused ?? null;
  useEffect(() => {
    if (!focusedTab) return undefined;
    const sync = () => {
      const live = wsService?.getSessionState?.();
      if (!live?.sessionId) return;
      // A session belongs to the being it was minted for. Mid-switch the
      // window's binding already names the ARRIVING being while this tab still
      // holds the outgoing one — binding then would staple one being's chat
      // onto another's tab, which is the worst error this strip could make.
      if (live.neumaId !== focusedTab.neumaId) return;
      if (live.sessionId !== focusedTab.sessionId) tabs.bind(focusedTab.id, live.sessionId);
    };
    sync();
    // Two moments a tab can learn which sitting it holds: the window's binding
    // MOVING (a being switch, a resume, a fresh mint — none of which reach a
    // completed turn), and the first COMPLETE of a sitting the server has just
    // minted an id for.
    wsService?.on?.('session:state', sync);
    wsService?.on?.('consciousness:complete', sync);
    return () => {
      wsService?.off?.('session:state', sync);
      wsService?.off?.('consciousness:complete', sync);
    };
  }, [focusedTab, tabs, wsService]);

  // FOCUSING A TAB SENDS NOTHING (#407 — Design note, 2026-08-28: […]). The seat/resume/mint
  // that used to run here — and reset the one shared stream — moved to
  // TabPortalHost: every tab holds its own portal (the first rides the
  // window's own), so focus only decides which sitting the frame shows.

  // THE SWITCH ADJUSTS THIS TAB, AND ONLY THIS TAB. The other half of the
  // reconciliation: the operator changes who is in the chair, and the focused
  // tab moves with them — taking its kind, and therefore its budget, along.
  //
  // THE SETTLE GUARD replaces the old in-flight marker: a freshly focused
  // tab's provider (its portal, or a just-adopted anchor) may still hold the
  // PREVIOUS binding for a commit or two before it seats this tab's own
  // being. Retargeting on that stale reading would write the outgoing being
  // onto the incoming tab — so no retarget fires until this provider has been
  // seen holding the tab's own being once. An operator's real switch always
  // happens after that moment, so it is never suppressed.
  const settleRef = useRef({ tabId: null, settled: false });
  useEffect(() => {
    const t = tabs?.focused;
    const who = activeCompanion;
    if (!t) return;
    if (settleRef.current.tabId !== t.id) settleRef.current = { tabId: t.id, settled: false };
    if (who?.neumaId === t.neumaId) { settleRef.current.settled = true; return; }
    if (!settleRef.current.settled) return; // a seat in flight, not the operator
    const plan = switchPlan(t, who?.neumaId ?? null, null);
    if (!plan.retarget) return;
    tabs.retarget(t.id, {
      neumaId: who.neumaId,
      name: who.name || who.neumaId,
      kind: isWitness(who) ? tabs.KIND.witness : tabs.KIND.local,
    });
  }, [tabs, activeCompanion]);

  if (!tabs) return null;

  // ONE DOOR: the kind is inherited from whoever is in the chair, so the budget
  // the strip reports is the one this press would actually spend.
  const nextKind = isWitness(activeCompanion) ? tabs.KIND.witness : tabs.KIND.local;

  // WHERE EACH SITTING IS WORKING, in one word — and only for the sittings
  // that chose a ground of their own. A tab riding the window's lens gets no
  // entry at all, which is what keeps the strip as clean as it was (Founder,
  // 2026-08-29: […]).
  const grounds = tabs.tabs.reduce((acc, t) => {
    const mark = t.focus ? groundMark(t.focus, projects?.projects ?? null) : null;
    return mark ? { ...acc, [t.id]: mark } : acc;
  }, {});

  return (
    <TabStrip
      windowId={stripWindowId}
      tabs={tabs.tabs}
      focusedId={tabs.focusedId}
      activity={activity?.byTab ?? null}
      grounds={grounds}
      nextKind={nextKind}
      nextName={activeCompanion?.name || activeCompanion?.neumaId || null}
      // THE CLICK IS THE ANSWER (Design note, 2026-09-02: […]). The Explorer's lens used to wait on the
      // window MANAGER's focus stamp — a click could focus the tab while the
      // registry still pointed at another stream, and the folder landed on the
      // wrong sitting. Clicking a tab IS being in its stream, so the gesture
      // stamps the strip itself, in the same tick — no race, no lag.
      onFocus={(id) => {
        uiSound('toggle');
        if (stripWindowId) markStripFocused(stripWindowId);
        tabs.focus(id);
      }}
      onClose={(id) => { uiSound('toggle'); tabs.close(id); }}
      onMove={(id, toIndex) => { uiSound('toggle'); tabs.move(id, toIndex); }}
      // TEAR-OUT: the sitting leaves this strip for a STREAM WINDOW of its own.
      //
      // Design note, 2026-07-31: […]
      //
      // The desk IS the operating system, so the window opens in it. Each
      // stream window past the first runs its own portal and its own sitting
      // (StreamWindowHost) — which is what makes this a second conversation
      // rather than a second view of this one.
      //
      // It MOVES: the tab closes here. A sitting in two places at once is the
      // one thing a strip must never show.
      onTearOut={(id) => {
        const t = tabs.tabs.find((x) => x.id === id);
        if (!t) return null;
        const payload = encodeStreamTransfer(t);
        if (!payload) return { reason: 'This sitting exceeds the window transfer limit. It stays in this stream.' };
        if (!windows?.dispatch) {
          return {
            reason: 'This surface has no window layer to open a stream in.',
            alternative: 'The sitting stays here, on the strip.',
          };
        }
        uiSound('activate');
        windows.dispatch({
          type: 'OPEN_NEW',
          appId: 'chat',
          // Everything the new window needs to be THIS sitting — the pure
          // model owns the shape (who, which conversation, WHICH GROUND): a
          // tear-out that dropped the focus landed the sitting on the DESK's
          // focused tab's lens, a different sitting's ground (2026-09-01).
          payload,
        });
        tabs.close(id);
        return null;
      }}
      // ALWAYS OPENS. `focus` is the strip's read of whether the machine has a
      // slot to RUN this one in: false means it lands dormant on the strip
      // rather than seizing the frame, because looking at a tab is what starts
      // it (Design note, 2026-08-29 — opening is free, running is what is bounded).
      onOpen={({ focus = true } = {}) => {
        uiSound('activate');
        // A new tab that seizes the frame also seizes the lens — same law as
        // the tab click above.
        if (focus && stripWindowId) markStripFocused(stripWindowId);
        // A new tab opens on the being already in the chair — the operator is
        // asking for another conversation, not another being.
        const who = activeCompanion;
        if (!who?.neumaId) return;
        tabs.open(
          { kind: nextKind, neumaId: who.neumaId, name: who.name || who.neumaId },
          { focus },
        );
      }}
    />
  );
};
