// GenesisSpecimen — the look-dev rehearsal of GENESIS (study 05): the real
// stage and overlay, driven by a scrubbable clock, with the score sheet's
// cues logged as they fire. Dev-only (frontend/genesis.html); the product
// plays the same modules once per install, never replayable. The specimen's
// genesis record is minted per page load and labelled SPECIMEN.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createGenesisStage } from './genesis-stage.js';
import { sceneAt } from './genesis-state.js';
import { BEATS, GENESIS_MS, beatAt, cueSheet, cuesBetween, clockOf as clock } from './genesis-timeline.js';
import { genesisInscription, restingTurn } from './genesis-record.js';
import { GenesisOverlay } from './GenesisOverlay.jsx';
import './GenesisSpecimen.css';

const SHEET = cueSheet();
const SPEEDS = [0.5, 1, 2];

// impure — a specimen record: now, and random hex (never an install's record)
const specimenRecord = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return { at: new Date().toISOString(), hash: [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('') };
};

export const GenesisSpecimen = () => {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const tRef = useRef(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [cues, setCues] = useState([]);
  const record = useMemo(specimenRecord, []);
  const [aspect, setAspect] = useState(() => window.innerWidth / Math.max(1, window.innerHeight));
  const inscription = useMemo(() => genesisInscription(record), [record]);
  const scene = sceneAt(t);

  // impure — the stage lives as long as the page
  useEffect(() => {
    stageRef.current = createGenesisStage(canvasRef.current, { turn: restingTurn(record) });
    return () => stageRef.current?.dispose();
  }, [record]);

  useEffect(() => { stageRef.current?.render(scene); }, [scene]);

  // impure — the labels project with the viewport's aspect, as the stage does
  useEffect(() => {
    const onResize = () => setAspect(window.innerWidth / Math.max(1, window.innerHeight));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const seek = useCallback((next) => {
    tRef.current = Math.max(0, Math.min(GENESIS_MS, next));
    setT(tRef.current);
  }, []);

  // impure — playback: the clock advances by wall time × speed; every cue in
  // the crossed window fires once (the same law the product's sound obeys)
  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    let last = performance.now();
    const tick = (now) => {
      const prev = tRef.current;
      const next = Math.min(GENESIS_MS, prev + (now - last) * speed);
      last = now;
      const fired = cuesBetween(SHEET, prev, next);
      if (fired.length) setCues((c) => [...fired.map((f) => ({ ...f, key: `${f.cue}-${now}` })), ...c].slice(0, 8));
      seek(next);
      if (next >= GENESIS_MS) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, seek]);

  const play = () => {
    if (tRef.current >= GENESIS_MS) { seek(0); setCues([]); }
    setPlaying((p) => !p);
  };
  const jump = (dir) => {
    const i = BEATS.indexOf(beatAt(tRef.current));
    const target = BEATS[Math.max(0, Math.min(BEATS.length - 1, i + dir))];
    seek(dir < 0 && tRef.current - BEATS[i].at > 400 ? BEATS[i].at : target.at);
  };

  // impure — keyboard: space plays, arrows walk beats, Home restarts
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input')) return;
      if (e.key === ' ') { e.preventDefault(); play(); }
      if (e.key === 'ArrowRight') jump(1);
      if (e.key === 'ArrowLeft') jump(-1);
      if (e.key === 'Home') { seek(0); setCues([]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="gen-root">
      <canvas ref={canvasRef} className="gen-canvas" />
      <GenesisOverlay scene={scene} inscription={inscription} aspect={aspect} />

      <aside className="gs-cues" aria-label="Cues fired">
        <span className="gs-label">SCORE · CUES FIRED</span>
        {cues.map((c) => (
          <span key={c.key} className="gs-cue"><b>{c.cue}</b> {clock(c.at)} · {c.part || c.beat}</span>
        ))}
      </aside>

      <footer className="gs-bar">
        <span className="gs-tag">SPECIMEN — GENESIS REHEARSAL</span>
        <button type="button" className="gs-btn" onClick={play} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'PAUSE' : 'PLAY'}</button>
        <button type="button" className="gs-btn" onClick={() => jump(-1)} aria-label="Previous beat">◀</button>
        <button type="button" className="gs-btn" onClick={() => jump(1)} aria-label="Next beat">▶</button>
        <span className="gs-time">{clock(t)} / {clock(GENESIS_MS)}</span>
        <div className="gs-scrub">
          {BEATS.map((b) => (
            <button
              type="button"
              key={b.id}
              className={`gs-beat${beatAt(t).id === b.id ? ' is-now' : ''}`}
              style={{ left: `${(b.at / GENESIS_MS) * 100}%` }}
              onClick={() => seek(b.at)}
              title={`${b.id.toUpperCase()} · ${clock(b.at)}${b.cue ? ` · ${b.cue}` : ''}`}
            />
          ))}
          <input
            type="range"
            className="gs-range"
            min={0}
            max={GENESIS_MS}
            step={10}
            value={t}
            onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }}
            aria-label="Genesis time"
          />
        </div>
        <span className="gs-beatname">{beatAt(t).id.toUpperCase()}</span>
        {SPEEDS.map((s) => (
          <button type="button" key={s} className={`gs-btn${speed === s ? ' is-on' : ''}`} onClick={() => setSpeed(s)}>{s}×</button>
        ))}
      </footer>
    </div>
  );
};
