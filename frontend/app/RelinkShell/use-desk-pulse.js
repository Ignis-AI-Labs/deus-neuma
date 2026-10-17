// use-desk-pulse.js — the desk's pulse, as React state (#185).
//
// impure hook: subscribes the desk's one wsService and translates REAL portal
// events into pulse-reducer actions — never timers, never an ambient loop
// pretending to be traffic (RULE 0). What marks "thought sent": the stream
// hook exposes no send event, so the marker is the stream's own USER_SENT
// message — RelinkShell derives its id via latestSentId and passes it in;
// it is dispatched in sendThought exactly as the frame goes on the wire.

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { pulseReducer, initialPulse } from './desk-pulse.js';

export const useDeskPulse = (wsService, sentId) => {
  const [state, dispatch] = useReducer(pulseReducer, initialPulse);
  // Monotonic packet ids — a turn fires many chunks.
  const seqRef = useRef(0);
  const inboundFrameRef = useRef(null);
  const emitInbound = useCallback(() =>
    dispatch({ type: 'PACKET', id: `p${seqRef.current++}`, kind: 'in' }), []);
  const flushInbound = useCallback(() => {
    if (inboundFrameRef.current === null) return;
    cancelAnimationFrame(inboundFrameRef.current);
    inboundFrameRef.current = null;
    emitInbound();
  }, [emitInbound]);

  // The witness sent a thought → one outbound packet (left→right). The id
  // rides the sent message's own id, so a replayed effect can never double it.
  useEffect(() => {
    if (sentId) dispatch({ type: 'PACKET', id: `out-${sentId}`, kind: 'out' });
  }, [sentId]);

  useEffect(() => {
    // A chunk arrived → an inbound packet (right→left), capped at display
    // cadence. The rail is telemetry, not the transcript: several provider
    // deltas inside one paint are one visible movement, not several React
    // commits fighting for the same frame.
    const onStream = () => {
      if (inboundFrameRef.current !== null) return;
      inboundFrameRef.current = requestAnimationFrame(() => {
        inboundFrameRef.current = null;
        emitInbound();
      });
    };
    // A tool act → the mid-rail junction flashes.
    const onTool = () => {
      flushInbound();
      dispatch({ type: 'PACKET', id: `p${seqRef.current++}`, kind: 'tool' });
    };
    // A turn completed → flush whatever inbound packet is still coalescing.
    // It no longer counts anything: TURN is derived from the transcript
    // (desk-pulse.js countTurns), because a count kept here reset on reload
    // while the transcript it described did not (#251).
    const onComplete = () => {
      flushInbound();
    };
    wsService.on('consciousness:stream', onStream);
    wsService.on('tool:usage', onTool);
    wsService.on('consciousness:complete', onComplete);
    return () => {
      if (inboundFrameRef.current !== null) cancelAnimationFrame(inboundFrameRef.current);
      inboundFrameRef.current = null;
      wsService.off('consciousness:stream', onStream);
      wsService.off('tool:usage', onTool);
      wsService.off('consciousness:complete', onComplete);
    };
  }, [wsService, emitInbound, flushInbound]);

  const reapPacket = useCallback((id) => dispatch({ type: 'REAP', id }), []);
  return { packets: state.packets, reapPacket };
};
