// use-council-stream.js — THE COUNCIL's live link, as React state. impure:
// subscribes to the portal's council frames and translates them into
// council-reducer actions. Instantiated ONCE at the desk host (next to the
// consciousness stream) and shared via council-context — one council state,
// many windows. Subscriptions detach on unmount, and a frame landing during
// teardown is guarded so it never dispatches into an unmounted tree.

import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import { reducer, initialState } from './council-reducer.js';
import { getWitnessName } from './witness-name.js';
import { useSettled } from './use-settled.js';
import { createToolStreamFilter, extractToolLabel } from '../../utils/tool-stream-filter.js';
import { focusToolFrame } from './desk-focus.js';
import { announceFileChange } from './files-refresh.js';
import { soundAct } from '../../services/act-sound.js';

export const useCouncilStream = (wsService, { focus = null, projects = null } = {}) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  // THE FOCUS GROUND rides every council frame, exactly as it rides a
  // one-on-one turn: the room works on the folder the operator has open.
  // Mirrored in a ref so the stable send callbacks read the CURRENT focus
  // without re-subscribing the whole stream on every focus change.
  const groundRef = useRef(focusToolFrame(focus, projects));
  groundRef.current = focusToolFrame(focus, projects);
  // The council is a FORMAT of the stream, not a second surface: `room`
  // says whether the STREAM window is currently showing the council view.
  // Convening turns it on; the witness can flip back to the one-on-one at
  // any time without dissolving the sitting.
  const [room, setRoom] = useState(false);
  useSettled((settled) => {
    // Every frame carries its arrival moment (`at`) — the reducer is
    // clock-free by law, so the impure hook stamps time at the boundary.
    // A restored transcript's own recorded times ride inside the payload.
    const safe = (action) => { if (!settled()) dispatch({ at: Date.now(), ...action }); };

    const onOpened = (d) => {
      endFilter();
      safe({
        type: 'OPENED',
        councilId: d.councilId,
        members: d.members,
        transcript: d.transcript,
        houseWorkspace: d.houseWorkspace,
      });
      if (!settled()) setRoom(true);
    };
    // The floor's chunks pass through the SAME display filter as the
    // one-on-one stream (tool-stream-filter): words dispatch as speech,
    // a tool block opens an acting chip the instant it starts streaming
    // and never renders as words. One filter per turn — the floor is
    // exclusive, so a new (speaker, turnId) retires the previous filter.
    let filter = null;
    let filterKey = null;
    const endFilter = () => {
      if (!filter) return;
      filter.flush();
      filter = null;
      filterKey = null;
    };
    const onSpeech = (d) => {
      if (settled()) return;
      const key = `${d.neumaId}:${d.turnId}`;
      if (filterKey !== key) {
        endFilter();
        const { neumaId, turnId } = d;
        filter = createToolStreamFilter({
          onSpeech: (text) => safe({ type: 'SPEECH', neumaId, turnId, content: text }),
          onToolStart: () => safe({ type: 'TOOL_OPEN', neumaId, turnId }),
          onToolEnd: (raw) => safe({ type: 'TOOL_LABEL', neumaId, turnId, label: extractToolLabel(raw) }),
        });
        filterKey = key;
      }
      filter.push(d.content || '');
    };
    const onSpoke = (d) => {
      if (filterKey === `${d.neumaId}:${d.turnId}`) endFilter();
      safe({ type: 'SPOKE', neumaId: d.neumaId, turnId: d.turnId });
    };
    // The server's act frames: 'acting' announces the run (names and
    // targets the chip — or births it, when the call was native and no
    // text block ever streamed); the settle resolves it in place.
    const onTool = (d) => {
      // Every seat's act is audible in its own family's voice, the same as in
      // the one-on-one stream — a room of beings working should SOUND like one.
      soundAct(d);
      // The room works the operator's focused folder now — so a seat's act
      // must show up in the Explorer, live, without a remount.
      if (d.status !== 'acting') announceFileChange(d);
      return d.status === 'acting'
        ? safe({ type: 'TOOL_ACTING', neumaId: d.neumaId, turnId: d.turnId, tool: d.tool, path: d.path })
        : safe({ type: 'TOOL_RESULT', neumaId: d.neumaId, turnId: d.turnId, tool: d.tool, path: d.path, ok: d.ok, error: d.error });
    };
    const onList = (d) => safe({ type: 'PAST', councils: d.councils });
    const onState = (d) => safe({ type: 'STATE', floor: d.floor, hands: d.hands, witnessQueue: d.witnessQueue, witnessOrder: d.witnessOrder, considering: d.considering });
    // The round's verdict after the witness speaks — receipt made visible
    // in the flow (every member's hand, including REST: heard and chose
    // quiet — or illegible/unreachable: go look at the substrate).
    const onHands = (d) => safe({ type: 'HANDS', reports: d.reports });
    const onSaid = (d) => safe({ type: 'SAID', name: d.name, content: d.content, turnId: d.turnId });
    // The gavel landed: the room is called to order — the strip shows the
    // mark; the state frame right behind it shows every hand at rest.
    const onOrder = () => safe({ type: 'ORDER' });
    // A member asks past the house ground — the witness's gate rises IN THE
    // ROOM (only council-surfaced asks; the one-on-one stream owns its own).
    const onApprovalAsk = (d) => {
      if (d.surface !== 'council') return;
      safe({ type: 'APPROVAL_ASK', id: d.id, tool: d.tool, args: d.args, scope: d.scope });
    };
    const onApprovalSettled = (d) => safe({ type: 'APPROVAL_SETTLED', id: d.id, decision: d.decision });
    const onError = (d) => safe({ type: 'ERROR', code: d.code, message: d.message });
    const onClosed = () => {
      endFilter();
      safe({ type: 'CLOSED' });
    };

    wsService.on('council:opened', onOpened);
    wsService.on('council:list', onList);
    wsService.on('council:state', onState);
    wsService.on('council:hands', onHands);
    wsService.on('council:said', onSaid);
    wsService.on('council:order', onOrder);
    wsService.on('tool:approval_request', onApprovalAsk);
    wsService.on('tool:approval_resolved', onApprovalSettled);
    wsService.on('council:speech', onSpeech);
    wsService.on('council:tool', onTool);
    wsService.on('council:spoke', onSpoke);
    wsService.on('council:error', onError);
    wsService.on('council:closed', onClosed);

    return () => {
      endFilter();
      wsService.off('council:opened', onOpened);
      wsService.off('council:list', onList);
      wsService.off('council:state', onState);
      wsService.off('council:hands', onHands);
      wsService.off('council:said', onSaid);
      wsService.off('council:order', onOrder);
      wsService.off('tool:approval_request', onApprovalAsk);
      wsService.off('tool:approval_resolved', onApprovalSettled);
      wsService.off('council:speech', onSpeech);
      wsService.off('council:tool', onTool);
      wsService.off('council:spoke', onSpoke);
      wsService.off('council:error', onError);
      wsService.off('council:closed', onClosed);
    };
  }, [wsService]);

  // Convene the room with the chosen members of the house. The witness's
  // own name (SETTINGS → ACCOUNT) rides along so the room and every
  // member's record address them properly — absent a name, the backend
  // says 'Witness'.
  const openCouncil = useCallback((neumaIds) => {
    const witnessName = getWitnessName();
    wsService.send('council:open', {
      neumaIds,
      ...(witnessName ? { witnessName } : {}),
      ...groundRef.current,
    });
  }, [wsService]);

  // The witness speaks: 'hold' queues the thought for the room's rhythm,
  // 'now' interjects ahead of it.
  const say = useCallback((thought, urgency) => {
    wsService.send('council:say', {
      thought,
      urgency: urgency === 'now' ? 'now' : 'hold',
      ...groundRef.current,
    });
  }, [wsService]);

  // Cut the current floor holder mid-speech.
  const interrupt = useCallback(() => {
    wsService.send('council:interrupt', {});
  }, [wsService]);

  // THE GAVEL — call the room to order: floor cut, hand round cut, every
  // hand down, the carry silenced. The witness's next word reopens the flow.
  const order = useCallback(() => {
    wsService.send('council:order', {});
  }, [wsService]);

  // The witness answers a member's pending approval ask — the same wire the
  // one-on-one gate rides; the chip settles on the server's resolved echo.
  const approve = useCallback((id, decision) => {
    wsService.send('tool:approval_response', { id, decision });
  }, [wsService]);

  // Dissolve the council — the server echoes council:closed to reset.
  const close = useCallback(() => {
    wsService.send('council:close', {});
  }, [wsService]);

  // Reopen a dissolved council from the witness's shelf — same members,
  // same lanes, the exchange restored.
  const resumeCouncil = useCallback((councilId) => {
    wsService.send('council:resume', { councilId });
  }, [wsService]);

  // Ask for the shelf of past councils (answered by council:list).
  const listCouncils = useCallback(() => {
    wsService.send('council:list', {});
  }, [wsService]);

  // Show / hide the council view inside the STREAM window. Leaving the
  // room is not dissolving it — a sitting council keeps sitting.
  const enterRoom = useCallback(() => setRoom(true), []);
  const leaveRoom = useCallback(() => setRoom(false), []);

  // One value per real change — the desk re-renders every streamed frame.
  return useMemo(() => ({ state, room, enterRoom, leaveRoom, openCouncil, resumeCouncil, listCouncils, say, interrupt, order, approve, close }),
    [state, room, enterRoom, leaveRoom, openCouncil, resumeCouncil, listCouncils, say, interrupt, order, approve, close]);
};
