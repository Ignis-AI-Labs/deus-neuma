// use-stream-draft.js — the composer's draft/text state: kept per CHAT
// (being + sitting) and restored with that chat. Split from StreamInput.jsx
// (size law); bodies moved verbatim.

import { useEffect, useRef, useState } from 'react';
import { draftKeyFor, loadDraft, saveDraft } from '../windowing/window-storage.js';

export const useStreamDraft = ({ wsService, neumaId, draftScope }) => {
  const [value, setValue] = useState('');

  // THE UNSENT DRAFT SURVIVES (Design note, 2026-08-02: […]). Half-typed text is part of where you left off, so it is kept per
  // CHAT — being + sitting — and comes back with that chat.
  //
  // The sitting is read from the socket rather than passed in, because the
  // composer already holds `wsService` and the binding moves under it (resume,
  // new chat, being switch) without this component re-rendering for any other
  // reason.
  const [sessionId, setSessionId] = useState(() => wsService?.getSessionState?.()?.sessionId ?? null);
  useEffect(() => {
    if (!wsService) return undefined;
    setSessionId(wsService.getSessionState?.()?.sessionId ?? null);
    const onState = (st) => setSessionId(st?.sessionId ?? null);
    wsService.on?.('session:state', onState);
    return () => wsService.off?.('session:state', onState);
  }, [wsService]);

  // `draftScope` separates two chats with no minted session yet — else both
  // share one `<being>:__unbound__` bucket and typing in one fresh tab shows
  // in the other. The host passes the tab's identity; absent it, the being
  // alone is the scope (the council's single composer).
  const draftKey = draftKeyFor(sessionId ? neumaId : `${neumaId}#${draftScope || 'solo'}`, sessionId);

  // Arriving at a chat: its own draft comes up. Overwriting is correct even
  // mid-word, because the key only moves when the CHAT moves, and the outgoing
  // chat's text was already saved under its own key.
  //
  // The flag is load-bearing, not decoration. On the commit where the chat
  // changes, `value` is STILL the outgoing chat's text (setValue only schedules
  // the re-render), so the save effect below would otherwise write those words
  // under the ARRIVING chat's key — one chat's draft appearing in another's.
  const arrivingRef = useRef(false);
  useEffect(() => {
    if (!draftKey) return;
    arrivingRef.current = true;
    setValue(loadDraft(draftKey));
  }, [draftKey]);

  // Keeping it. Debounced so a fast typist does not write on every keystroke;
  // an empty draft REMOVES its entry, so sending leaves nothing behind and the
  // clear costs no special case at any of the send paths.
  useEffect(() => {
    if (!draftKey) return undefined;
    if (arrivingRef.current) {
      arrivingRef.current = false; // this commit's `value` belongs to the chat we LEFT
      return undefined;
    }
    const timer = setTimeout(() => saveDraft(draftKey, value), 250);
    return () => clearTimeout(timer);
  }, [draftKey, value]);

  return { value, setValue };
};
