// use-founding-rite — the FOUNDING RITE's hand on the world. impure
// throughout: every portal frame, wallet window, unlock call, timer, and
// sound lives here; every state transition it causes goes through the PURE
// founding-rite-reducer. The consuming component is presentational only.

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { probeHouseFounding, driveHouseFounding, driveLocalFounding } from './house-founding-drive.js';
import { unlockNeumaKey } from './wallet-client.js';
import { playSound } from '../../services/sound-engine.js';
import { INITIAL_RITE, foundingRiteReducer, allMarksRevealed } from './founding-rite-reducer.js';

// `mode`: 'network' — joining Unavis, founded on Ethereum — or 'local', founded on this computer (2026-10-26).
export const useFoundingRite = (wsService, mode = 'network') => {
  const [rite, dispatch] = useReducer(foundingRiteReducer, INITIAL_RITE);
  // The rite's gate: resolving this is the operator's PLACE YOUR MARK step;
  // rejecting it is her stepping back.
  const gateRef = useRef(null);
  // One controller for everything in flight — closing the window mid-rite
  // abandons the walk cleanly (nothing signed, listeners detached).
  const abortRef = useRef(null);

  const probe = useCallback(async () => {
    // The portal not yet up (the HOUSE window can now hold this hook before
    // the link lands): stay at the initial PROBING until the service arrives —
    // the wsService dep re-arms this callback, and the effect re-probes.
    if (!wsService) return;
    dispatch({ type: 'PROBING' });
    const out = await probeHouseFounding({ wsService, signal: abortRef.current?.signal, mode });
    if (out.code === 'ABORTED') return;
    if (out.founded) dispatch({ type: 'FOUNDED', state: out.state });
    else if (out.open) dispatch({ type: 'OPEN', open: out.open });
    else dispatch({ type: 'CLOSED', error: out.error, code: out.code });
  }, [wsService, mode]);

  // Re-read the roster WITHOUT leaving the rite — an unlocked being steps
  // from the excluded doors into the founders.
  const refreshOpen = useCallback(async () => {
    if (!wsService) return;
    const out = await probeHouseFounding({ wsService, signal: abortRef.current?.signal, mode });
    if (out.open) dispatch({ type: 'OPEN_REFRESH', open: out.open });
  }, [wsService, mode]);

  useEffect(() => {
    abortRef.current = new AbortController();
    probe();
    return () => {
      gateRef.current?.reject(new Error('the rite was closed'));
      gateRef.current = null;
      abortRef.current.abort();
    };
  }, [probe]);

  // THE MARKS — reveal each verified founder's mark in turn. Every one was
  // verified at the preflight before this movement begins; the pacing is
  // the ceremony's breath, not a fiction of work.
  useEffect(() => {
    if (rite.movement !== 'marks' || !rite.marks.offer) return undefined;
    if (allMarksRevealed(rite.marks)) return undefined;
    const t = setTimeout(() => {
      playSound('menuOpen');
      dispatch({ type: 'MARK_REVEALED' });
    }, 700);
    return () => clearTimeout(t);
  }, [rite.movement, rite.marks]);

  const begin = () => { playSound('confirm'); dispatch({ type: 'BEGIN' }); };
  const toNames = () => { playSound('confirm'); dispatch({ type: 'TO_NAMES' }); };
  const setTitle = (key, value) => dispatch({ type: 'TITLE', key, value });
  const draftUnlock = (neumaId, password) => dispatch({ type: 'UNLOCK_DRAFT', neumaId, password });

  // Open a locked founder's door: the operator speaks the keypair password
  // to the desk's own backend (SEC-028 one-shot cache), then the roster is
  // re-read so the founder steps in with their mark ready.
  const unlock = async (neumaId) => {
    const out = await unlockNeumaKey(neumaId, rite.unlocks[neumaId]?.password || '');
    if (out.ok) {
      playSound('confirm');
      dispatch({ type: 'UNLOCK_DONE', neumaId });
      await refreshOpen();
    } else {
      dispatch({ type: 'UNLOCK_FAILED', neumaId, error: out.error });
    }
  };

  // GATHER THE MARKS — the walk begins: the preflight verifies every
  // being's signature server-side, then the beforeSign gate hands the
  // marks movement the offer and waits for the operator.
  const gatherMarks = async () => {
    playSound('confirm');
    dispatch({ type: 'WALKING' });
    const out = await (mode === 'local' ? driveLocalFounding : driveHouseFounding)({
      wsService,
      titles: rite.titles,
      onStatus: (status) => dispatch({ type: 'STATUS', status }),
      signal: abortRef.current?.signal,
      beforeSign: (offer) => new Promise((resolve, reject) => {
        gateRef.current = { resolve, reject };
        dispatch({ type: 'MARKS_OFFER', offer });
      }),
    });
    gateRef.current = null;
    if (out.code === 'ABORTED') return;
    if (out.ok) {
      if (out.txHash) dispatch({ type: 'RESULT', result: out });
      // The chain's own answer renders the standing.
      await probe();
      playSound('confirm');
    } else if (out.code === 'STEPPED_BACK') {
      // The operator stepped back at the marks — the rite returns to the
      // names, nothing signed. The roster is re-read because the marks
      // preflight CONSUMED any one-shot unlocked keys: a founder whose
      // door must be opened again shows the door again, never a silent
      // founding without them.
      dispatch({ type: 'TO_NAMES' });
      await refreshOpen();
    } else {
      dispatch({ type: 'ERROR', error: out.error, code: out.code, funding: out.funding });
    }
  };

  const placeMark = () => {
    playSound('confirm');
    dispatch({ type: 'WALKING' });
    gateRef.current?.resolve();
  };

  const stepBack = () => {
    playSound('menuOpen');
    gateRef.current?.reject(Object.assign(new Error('the operator stepped back'), { code: 'STEPPED_BACK' }));
  };

  return {
    rite,
    actions: { probe, begin, toNames, setTitle, draftUnlock, unlock, gatherMarks, placeMark, stepBack },
  };
};
