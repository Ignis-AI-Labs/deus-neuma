// SubstrateApp — the SUBSTRATE HUD: a single pane of glass over the engine room.
//
// A rig-level lens (owned by no one neuma): polls /substrate/telemetry (1.5 s)
// and /substrate/machine (5 s, use-machine.js) and hands each read to the
// console (SubstrateConsole.jsx), which lays the machine's state out — one
// health strip first, then the panels.
//
// The calm rule (calm-gate.js): live values land on every poll, in place;
// what would re-lay the console — a reading newly found not believable moves
// out of its row — is held while the operator is at the window and lands
// when they leave.

import { useEffect, useRef, useState } from 'react';
import { loadTelemetry } from './substrate-client.js';
import { useVisibleInterval } from './use-visible-interval.js';
import { useMachine } from './use-machine.js';
import { useCalmGate } from './use-calm-gate.js';
import { NO_SENSE } from './machine-sense.js';
import { pushSample, sampleOf } from './sample-history.js';
import { AppTitle } from './app-title.jsx';
import { POLL_MS, SubstrateConsole } from './SubstrateConsole.jsx';

const SubstrateIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
    <rect x="2.5" y="2.5" width="9" height="9" />
    <rect x="5.5" y="5.5" width="3" height="3" fill="currentColor" stroke="none" />
    <path d="M7 0.5 V2.5 M7 11.5 V13.5 M0.5 7 H2.5 M11.5 7 H13.5" />
  </svg>
);

const SubstrateBody = () => {
  const [tel, setTel] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [acting, setActing] = useState(false);
  const [history, setHistory] = useState([]);
  const [machine, watchMachine, sense] = useMachine();
  const [shownSense, setShownSense] = useState(NO_SENSE);
  const calm = useCalmGate();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  // A new doubt moves a reading out of its row: a background re-lay, so it
  // waits while the operator is at the window.
  useEffect(() => { calm.offer('sense', () => setShownSense(sense)); }, [calm, sense]);
  // Polls only while this lens is on screen (use-visible-interval.js): a
  // window-shaded or hidden SUBSTRATE window spent 40 reads a minute.
  const watch = useVisibleInterval(async () => {
    const t = await loadTelemetry();
    if (!alive.current) return;
    // A 429 / transport miss is not […] — keep the last
    // snapshot. First poll still lands null → UNAVAILABLE.
    setTel((prev) => (t == null && prev != null ? prev : t));
    if (t) setHistory((h) => pushSample(h, sampleOf(t)));
    setLoaded(true);
  }, POLL_MS);

  // Run a control action, then refresh once so the HUD reflects the new state
  // without waiting for the next poll tick. The client fns resolve {ok,error}
  // rather than rejecting, but the finally guarantees the button can never
  // wedge disabled even if that contract ever slips.
  const act = async (fn) => {
    if (acting) return;
    setActing(true);
    try {
      await fn();
      const t = await loadTelemetry();
      if (alive.current) setTel(t);
    } finally {
      if (alive.current) setActing(false);
    }
  };

  return (
    <SubstrateConsole tel={tel} loaded={loaded} machine={machine} sense={shownSense} history={history}
      acting={acting} act={act} watch={watch} watchMachine={watchMachine} calm={calm.handlers} />
  );
};

export const substrateApp = {
  label: 'SUBSTRATE',
  labelKey: 'apps.substrate',
  icon: <SubstrateIcon />,
  title: <AppTitle label="SUBSTRATE" labelKey="apps.substrate" />,
  Body: SubstrateBody,
  storageKey: 'substrate',
};
