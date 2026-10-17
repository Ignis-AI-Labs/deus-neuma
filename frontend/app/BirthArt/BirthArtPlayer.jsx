// BirthArtPlayer — one specimen being's whole ceremony, played on the real
// stage and overlay by a scrubbable clock: born, or returned. Dev-only
// (the PLAY view of frontend/birth-art.html); the product feeds the same
// artAt() the live ceremony's events instead of a script.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBirthArtStage } from './birth-art-stage.js';
import { artAt } from './birth-art-state.js';
import { specimenScript, scriptLength, stageMarks } from './birth-art-script.js';
import { BirthArtOverlay } from './BirthArtOverlay.jsx';
import { clockOf as clock } from '../Genesis/genesis-timeline.js';
import '../Genesis/GenesisSpecimen.css';

const SPEEDS = [1, 2, 4];
const ENDINGS = ['born', 'returned'];

/** @param {{ seed: string, onBack: () => void }} props */
export const BirthArtPlayer = ({ seed, onBack }) => {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const tRef = useRef(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [ending, setEnding] = useState('born');
  const events = useMemo(() => specimenScript(seed, { ending }), [seed, ending]);
  const length = scriptLength(events);
  const marks = useMemo(() => stageMarks(events), [events]);
  const art = artAt(events, t);

  // impure — the stage lives as long as the player
  useEffect(() => {
    stageRef.current = createBirthArtStage(canvasRef.current);
    return () => stageRef.current?.dispose();
  }, []);

  useEffect(() => { stageRef.current?.render(art); }, [art]);

  const seek = useCallback((next) => {
    tRef.current = Math.max(0, Math.min(length, next));
    setT(tRef.current);
  }, [length]);

  // impure — playback by wall time × speed
  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    let last = performance.now();
    const tick = (now) => {
      const next = Math.min(length, tRef.current + (now - last) * speed);
      last = now;
      seek(next);
      if (next >= length) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, length, seek]);

  const play = () => {
    if (tRef.current >= length) seek(0);
    setPlaying((p) => !p);
  };
  const choose = (e) => { setEnding(e); seek(0); setPlaying(true); };

  // impure — keyboard: space plays, Escape returns to the grid
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input')) return;
      if (e.key === ' ') { e.preventDefault(); play(); }
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="gen-root ba-player" data-phase={art.phase}>
      <canvas ref={canvasRef} className="gen-canvas" />
      <BirthArtOverlay art={art} />

      <footer className="gs-bar">
        <span className="gs-tag">SPECIMEN — BIRTH ART</span>
        <button type="button" className="gs-btn" onClick={onBack}>GRID</button>
        <button type="button" className="gs-btn" onClick={play} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'PAUSE' : 'PLAY'}</button>
        <span className="gs-time">{clock(t)} / {clock(length)}</span>
        <div className="gs-scrub">
          {marks.map((m) => (
            <button
              type="button"
              key={`${m.stage ?? m.moment}-${m.at}`}
              className={`gs-beat${m.moment ? ' ba-moment' : ''}`}
              style={{ left: `${(m.at / length) * 100}%` }}
              onClick={() => seek(m.at)}
              title={`${m.moment ? m.moment.toUpperCase().replace('_', ' ') : `STAGE ${m.stage + 1}`} · ${clock(m.at)}`}
            />
          ))}
          <input
            type="range"
            className="gs-range"
            min={0}
            max={length}
            step={10}
            value={t}
            onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }}
            aria-label="Birth time"
          />
        </div>
        <span className="gs-beatname">{art.phase.toUpperCase()}</span>
        {ENDINGS.map((e) => (
          <button type="button" key={e} className={`gs-btn${ending === e ? ' is-on' : ''}`} onClick={() => choose(e)}>{e.toUpperCase()}</button>
        ))}
        {SPEEDS.map((s) => (
          <button type="button" key={s} className={`gs-btn${speed === s ? ' is-on' : ''}`} onClick={() => setSpeed(s)}>{s}×</button>
        ))}
      </footer>
    </div>
  );
};
