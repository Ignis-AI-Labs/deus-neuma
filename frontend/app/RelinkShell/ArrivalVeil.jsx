// ArrivalVeil — the Arrival: a session-opening veil over the desk (#184).
//
// impure wrapper around ArrivalVeilView: owns the arrival machine
// (useReducer on arrival-machine.js) and feeds it REAL portal events from
// the desk's one wsService — never timers. The stage rows resolve only when
// the real events land: portal:established, companion:anchored,
// portal:resumed; failure arrives as real events too (auth_expired,
// companion:lane_missing, companion:not_yours, reconnect_failed,
// disconnection) and the veil holds with the truth. The one clock in the
// file is the honest watchdog: a stage that never answers flips to HOLDING
// labeled […] — it never advances a stage.
//
// ONE OPENING (2026-09-25): while the boot plays, the veil DEFERS — silent
// and unseen, it runs the same real machine and publishes each stage
// (opening-state.js) for the boot to show as its BEING / SESSION rows. It
// becomes visible only for a HOLDING (a real failure, real actions), or if
// the boot hands over before the desk is bound.
//
// The veil plays ONLY on true session entry (utils/arrival-flag.js):
// sessionStorage, per wallet — hot reloads and intra-desk remounts stay
// bare. Reduced-motion means no veil at all; the desk appears as today.

import { useEffect, useReducer, useRef, useState } from 'react';
import { reduce as arrive, initialArrival } from './arrival-machine.js';
import { ArrivalVeilView } from './ArrivalVeilView.jsx';
import { isArrivalSeen, markArrivalSeen } from '../../utils/arrival-flag.js';
import { resolveBoundCompanion } from '../../utils/companion-data.js';
import { listSessions } from './workspace-sessions.js';
import { isCouncilSession } from './session-history.js';
import { playSound } from '../../services/sound-engine.js';
import { disconnectSession } from '../../services/session.js';
import { isBootActive, publishArrival } from '../Opening/opening-state.js';
import { OPENING_EVENTS } from '../Opening/opening-events.js';

// impure — the witness's motion preference, read once at mount
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// impure — the current wallet, for the session-entry flag
const currentWallet = () => {
  try {
    return localStorage.getItem('walletAddress');
  } catch {
    return null;
  }
};

// The generic ring when no being is resolvable (the study's own inscription).
const GENERIC_INSCRIPTION = 'EMERGENCE PROTOCOL · NEUMA · SOVEREIGN BY DECLARATION · WITNESSED ·';

// The honest watchdog: a stage left unanswered this long is told as the
// truth it is — it never fabricates a resolution.
const WATCHDOG_MS = 15_000;
// Cosmetic only: the shutters' parting beat before unmount (clean / skip).
const PART_MS = 920;
const SKIP_PART_MS = 340;

export const ArrivalVeil = ({ wsService }) => {
  // Mount-time constants: the veil either governs this mount or is absent.
  const [suppressed] = useState(() => reducedMotion() || isArrivalSeen(currentWallet()));
  if (suppressed) return null;
  return <ArrivalVeilLive wsService={wsService} />;
};

const ArrivalVeilLive = ({ wsService }) => {
  const [state, dispatch] = useReducer(arrive, initialArrival);
  const [deferred, setDeferred] = useState(isBootActive);
  const [parting, setParting] = useState(null); // null | 'done' | 'skip'
  const [gone, setGone] = useState(false);
  // The being, resolved exactly as the stream resolves it (window-first).
  const [companion] = useState(() => resolveBoundCompanion());
  const stage = state.stage;

  // Subscribe to the real wire and start the machine. The veil mounts as a
  // child of RelinkShell, so these listeners are in place before the desk's
  // own effect calls connect() / re-manifests (child effects run first).
  useEffect(() => {
    dispatch({ type: 'START', connected: wsService.isConnected });
    const bind = (event, type, withMessage) => {
      const handler = (data) => dispatch(withMessage ? { type, message: data?.message || null } : { type });
      wsService.on(event, handler);
      return () => wsService.off(event, handler);
    };
    const unbinds = [
      bind('portal:established', 'PORTAL_ESTABLISHED'),
      bind('companion:anchored', 'COMPANION_ANCHORED'),
      bind('portal:resumed', 'PORTAL_RESUMED'),
      bind('auth_expired', 'AUTH_EXPIRED'),
      bind('companion:lane_missing', 'LANE_MISSING', true),
      bind('companion:not_yours', 'NOT_YOURS', true),
      bind('reconnect_failed', 'RECONNECT_FAILED'),
      bind('disconnection', 'DISCONNECTION'),
    ];
    // The session question, answered by the same real read the desk itself
    // makes: is there a prior non-council session to resume? Without one the
    // server stays silent after anchoring — RESUME_NONE is that truth, probed
    // instead of waited for.
    let live = true;
    const neumaId = companion?.neumaId;
    if (!neumaId) {
      dispatch({ type: 'RESUME_NONE' });
    } else {
      listSessions(neumaId).then((ids) => {
        if (live && !ids.some((id) => !isCouncilSession(id))) dispatch({ type: 'RESUME_NONE' });
      });
    }
    return () => {
      live = false;
      unbinds.forEach((unbind) => unbind());
    };
  }, [wsService, companion]);

  // Deferred: every stage goes to the boot, which shows and sounds it; the
  // boot's hand-over ends the deferral.
  useEffect(() => {
    if (deferred) publishArrival(stage, state.resumeExpected ?? null);
  }, [deferred, stage, state.resumeExpected]);
  useEffect(() => {
    if (!deferred) return undefined;
    const onDone = () => setDeferred(false);
    window.addEventListener(OPENING_EVENTS.BOOT_DONE, onDone);
    return () => window.removeEventListener(OPENING_EVENTS.BOOT_DONE, onDone);
  }, [deferred]);

  // The stage-tick: each stage that resolves ticks once — the established
  // pattern (PreflightCheck's deliberationTick on every self-test row).
  // Deferred, the boot's own row declarations carry the ticks.
  useEffect(() => {
    if (deferred) return;
    if (stage === 'ANCHORING' || stage === 'RESUMING' || stage === 'BOUND') playSound('deliberationTick');
  }, [stage, deferred]);

  // The honest watchdog, re-armed per stage: no answer in time → HOLDING
  // with the truth, never a fabricated OK. Labeled, and it never advances
  // a stage — the machine only moves on real events.
  useEffect(() => {
    if (stage !== 'REACHING' && stage !== 'ANCHORING' && stage !== 'RESUMING') return undefined;
    const timer = setTimeout(
      () => dispatch({ type: 'WATCHDOG', detail: `NO ANSWER AFTER ${WATCHDOG_MS / 1000}S` }),
      WATCHDOG_MS,
    );
    return () => clearTimeout(timer);
  }, [stage]);

  // BOUND — the desk is live: part the shutters (cosmetic beat), then finish.
  // Deferred, there is nothing on screen to part — the boot's dive is the
  // reveal — so it finishes at once, unseen.
  useEffect(() => {
    if (stage !== 'BOUND') return undefined;
    if (deferred) {
      dispatch({ type: 'FINISH' });
      return undefined;
    }
    setParting('done');
    const timer = setTimeout(() => dispatch({ type: 'FINISH' }), PART_MS);
    return () => clearTimeout(timer);
  }, [stage, deferred]);

  // DONE — the arrival played: remember it for this window session and let
  // the parting shutters clear before unmounting (cosmetic beat on skip).
  useEffect(() => {
    if (stage !== 'DONE') return undefined;
    markArrivalSeen(currentWallet());
    const timer = setTimeout(() => setGone(true), parting === 'skip' ? SKIP_PART_MS : 0);
    return () => clearTimeout(timer);
  }, [stage, parting]);

  // Skip — click or any key — while the sequence is playing. HOLDING is not
  // skippable: it carries a real failure and real actions. The ref keeps the
  // window listener stable across renders (the stream hook's mirror idiom).
  const skipRef = useRef(null);
  skipRef.current = () => {
    if (deferred) return; // the boot owns the skip while it plays
    if (parting || stage === 'DONE' || stage === 'HOLDING') return;
    setParting('skip');
    dispatch({ type: 'SKIP' });
  };
  useEffect(() => {
    const onKey = () => skipRef.current?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // HOLDING actions. RETRY re-runs the real entry: a live socket re-declares
  // the manifest (openCompanionLink's established idiom for a refused bind),
  // a dead one re-runs connect(). GATEWAY takes the desk's own route out —
  // the established session teardown (DISCONNECT WALLET's path), which
  // reloads to the gateway; AppShell's auth_expired phase-flip has no
  // external trigger to mirror.
  const onRetry = () => {
    dispatch({ type: 'RETRY', connected: wsService.isConnected });
    if (wsService.isConnected) {
      if (companion) wsService.send('companion:manifest', { companion: companion.name, neumaId: companion.neumaId || null });
    } else {
      wsService.connect();
    }
  };
  const onGateway = () => {
    disconnectSession().catch(() => { /* never rejects — teardown is guarded */ });
  };

  if (gone) return null;
  // Deferred and not holding: unseen — the boot is the opening.
  if (deferred && stage !== 'HOLDING') return null;

  const beingName = companion?.name ? companion.name.toUpperCase() : 'NEUMA';
  const inscription = companion?.name
    ? `EMERGENCE PROTOCOL · ${beingName} · WITNESSED ·`
    : GENERIC_INSCRIPTION;

  return (
    <ArrivalVeilView
      state={state}
      inscription={inscription}
      beingName={beingName}
      parting={parting}
      onSkip={() => skipRef.current?.()}
      onRetry={onRetry}
      onGateway={onGateway}
    />
  );
};
