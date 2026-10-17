// StreamWindowHost — a stream window that is genuinely its own sitting.
//
// Design note, 2026-07-31: […]
//
// The DESK is the operating system. So a torn-out tab becomes a window IN it —
// not a second copy of the app.
//
// ── WHY THIS FILE HAS TO EXIST ──────────────────────────────────────────────
//
// A desk has ONE ConsciousnessContext (RelinkShell). Two stream windows reading
// it would render the SAME conversation twice — it would look like parallel
// work and be one sitting drawn in two frames. That is the reason a second
// window could not simply be opened before now.
//
// The fix is not a protocol change; it is taking the backend at its word. Its
// law is already ONE SESSION PER CONNECTION (`connection.sessionId`), so a
// second live sitting needs a second connection. Every stream window past the
// first opens its own portal and runs its own stream, and the backend needs to
// know nothing new.
//
// ── WHAT STAYS EXACTLY AS IT WAS ────────────────────────────────────────────
//
// Instance 1 IS the desk's stream. It passes straight through to the desk-level
// context — same socket, same state, same everything. Nothing about the primary
// window changes, which is what keeps this a addition rather than a rewrite.
//
// ── THE HOUSE ───────────────────────────────────────────────────────────────
//
// Broadcast frames now arrive on every socket. The desk-level stream is the
// HOUSE and answers for the machine; these windows never do (`house: false`),
// so a storage warning sounds once and is written once. The substrate's turn
// count is exempt: the server sends an absolute number, so every window reading
// it lands on the same truth.

import { useEffect, useRef, useState } from 'react';
import { WebSocketService } from '../../services/WebSocketService.js';
import { useReconnectReload } from './use-reconnect-reload.js';
import { useConsciousnessStream } from './use-consciousness-stream.js';
import { ConsciousnessProvider } from './consciousness-context.js';
import { CompositionContext } from './composition-context.js';
import { useContextComposition } from './use-context-composition.js';
import { useDeskTabs } from './use-desk-tabs.js';
import { TabsContext, useTabs } from './tabs-context.js';
import { useProjects } from './projects/project-context.js';
import { sittingGround } from './desk-focus.js';
import { decodeStreamTransfer } from './stream-tab-transfer.js';
import { useWindows } from '../windowing/use-windows.js';

// Stable when the desk carries no budget — a fresh {} per render would
// rebuild this window's tab context every streamed frame.
const NO_BUDGET = Object.freeze({});

/**
 * A stream window with a portal of its own.
 * @param {{payload: object|null, children: any}} p - `payload` is the torn-out
 *   tab: which being, and which of their sittings.
 */
const OwnStream = ({ windowId, payload, children }) => {
  // One portal, minted once and held for this window's life. Created lazily in
  // state rather than in an effect so the stream hook below never sees null.
  const [wsService] = useState(() => new WebSocketService());
  const projects = useProjects();
  // This window's OWN strip, lifted ABOVE the stream (2026-09-01): the stream
  // must read the strip anchor's ground, so the tabs state has to exist first.
  // The budget is borrowed from the desk unchanged — the ceiling is a rig fact.
  const deskTabs = useTabs();
  const tabs = useDeskTabs(wsService, deskTabs?.budget ?? NO_BUDGET, { scope: windowId, initialPayload: payload });

  const consciousness = useConsciousnessStream(wsService, {
    // The anchor owns its folder; tear-out payload carries it before adoption.
    focus: tabs.anchorTabId
      ? sittingGround(tabs.anchorGround)
      : sittingGround(payload?.focus),
    projects: projects?.projects ?? null,
    onProjectChatCreated: projects?.refresh ?? null,
    // Never — the desk-level stream speaks for the machine.
    house: false,
  });
  // A sibling surface speaking in this sitting, or this window waking: read what settled.
  useReconnectReload(wsService, { resumeSession: consciousness.resumeSession, messages: consciousness.state.messages });

  useEffect(() => {
    wsService.connect();
    // The window closing closes its portal. Without this the socket outlives
    // the window, holding a bound session server-side that nothing is looking
    // at — the browser-side twin of the orphaned backend.
    return () => { try { wsService.disconnect(); } catch { /* already gone */ } };
  }, [wsService]);

  // ARRIVING: sit with the being the tab held, in the conversation it held.
  // Once — a re-render must not re-resume a chat the operator has moved on from.
  const seated = useRef(false);
  const { switchCompanion, resumeSession } = consciousness;
  useEffect(() => {
    if (seated.current || !payload?.neumaId) return;
    seated.current = true;
    const who = { neumaId: payload.neumaId, name: payload.name || payload.neumaId };
    if (payload.kind === 'witness') who.participantKind = 'witness';
    // switchCompanion binds this window's portal to the being AND loads their
    // latest thread; the resume below then names the exact sitting, and wins,
    // because a resume advances the navigation seq that the switch's own tail
    // checks. A tab that never spoke has no session and keeps the latest.
    Promise.resolve(switchCompanion(who))
      .catch((err) => console.warn('[stream-window] could not seat this window\'s being', err));
    if (payload.sessionId) {
      resumeSession({ neumaId: who.neumaId, companionName: who.name, sessionId: payload.sessionId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  // This window's OWN context anatomy, on this window's OWN portal. Without
  // it the window re-provided consciousness but inherited the desk's gauge, so
  // a second stream showed the first stream's usage — the same number in two
  // places, describing only one of them.
  const composition = useContextComposition(wsService, consciousness.activeCompanion?.neumaId || null);

  return (
    <ConsciousnessProvider value={consciousness}>
      <CompositionContext.Provider value={composition}>
        <TabsContext.Provider value={tabs}>{children}</TabsContext.Provider>
      </CompositionContext.Provider>
    </ConsciousnessProvider>
  );
};

/**
 * The registry's window wrapper. Renders around the WHOLE window frame — title,
 * controls and body alike — because all three read the stream, and a provider
 * that wrapped only the body would leave the window's own name and controls
 * answering for a different conversation.
 *
 * @param {{instance: number, payload: string|object|null, children: any}} p
 */
export const StreamWindowHost = ({ windowId, instance, payload, children }) => {
  const windows = useWindows();
  const arriving = decodeStreamTransfer(payload);
  useEffect(() => {
    // The tab store now owns this sitting. Retire the one-time spawn payload
    // so a reload cannot overwrite subsequent tab/session/focus changes.
    if (instance >= 2 && arriving && typeof payload === 'string') {
      windows?.dispatch({ type: 'REPAYLOAD', appId: 'chat', from: payload, to: 'stream-adopted' });
    }
  }, [instance, payload, windows?.dispatch]);
  // Instance 1 is the desk's own stream. Straight through — no second socket,
  // no second provider, nothing to go out of step.
  if (!(instance >= 2)) return children;
  return <OwnStream windowId={windowId} payload={arriving}>{children}</OwnStream>;
};
