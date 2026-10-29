// GenesisFilm — GENESIS in the product: the install's once-ever opening.
// // impure
//
// Design note, 2026-09-29: the first-ever animation is unique — skippable, recorded,
// NEVER replayable. On mount it claims the install's genesis (genesis-gate.js
// → backend/services/genesis-store.js): minted now, it plays — the same stage
// and overlay as the specimen (study 05), its record inscribed near its end;
// already standing, it is never played again and the launch goes on at once.
// SKIP ends it; its record stands either way. It rides where the ignition
// would (AppShell), above the destination mounting beneath it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createGenesisStage } from './genesis-stage.js';
import { sceneAt } from './genesis-state.js';
import { GENESIS_MS } from './genesis-timeline.js';
import { genesisInscription, restingTurn } from './genesis-record.js';
import { GenesisOverlay } from './GenesisOverlay.jsx';
import { claimGenesis, rememberGenesis } from './genesis-gate.js';
import './Genesis.css';

const HOLD_MS = 1500; // its last frame holds before the launch goes on
const SKIP_AFTER_MS = 2500; // SKIP appears once the void has begun to stir

export const GenesisFilm = ({ onDone }) => {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const doneRef = useRef(false);
  const [record, setRecord] = useState(null);
  const [t, setT] = useState(0);
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: Math.max(1, window.innerHeight) }));
  const finish = () => { if (!doneRef.current) { doneRef.current = true; onDone(); } };

  // impure — claim the install's genesis: play it only when minted now. The
  // first-paint veil is the void it begins from: lifted at its first frame.
  useEffect(() => {
    document.getElementById('first-paint-veil')?.remove();
    let live = true;
    claimGenesis().then((claim) => {
      if (!live) return;
      if (claim) rememberGenesis(claim.record);
      if (claim?.minted) setRecord(claim.record);
      else finish();
    });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // impure — its stage, once its record is known (the record turns its construct)
  useEffect(() => {
    if (!record) return undefined;
    stageRef.current = createGenesisStage(canvasRef.current, { turn: restingTurn(record) });
    return () => { stageRef.current?.dispose(); stageRef.current = null; };
  }, [record]);

  // impure — its clock: wall time, once, to its end
  useEffect(() => {
    if (!record) return undefined;
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      const next = now - t0;
      setT(Math.min(GENESIS_MS, next));
      if (next >= GENESIS_MS + HOLD_MS) { finish(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [record]); // eslint-disable-line react-hooks/exhaustive-deps

  const scene = sceneAt(t, size.w / size.h);
  useEffect(() => { stageRef.current?.render(scene); }, [scene]);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: Math.max(1, window.innerHeight) });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const inscription = useMemo(() => (record ? genesisInscription(record) : null), [record]);
  return (
    <div className="gen-root gen-film" data-genesis={record ? 'playing' : 'claiming'}>
      <canvas ref={canvasRef} className="gen-canvas" />
      {record ? <GenesisOverlay scene={scene} inscription={inscription} size={size} /> : null}
      {record && t >= SKIP_AFTER_MS ? (
        <button type="button" className="gen-skip" onClick={finish}>SKIP</button>
      ) : null}
    </div>
  );
};
