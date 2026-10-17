// SummoningSpecimen — the look-dev rehearsal of THE SUMMONING: four
// specimen beings' sequences side by side on one clock, so it is plain that
// no two are the same film; open one to watch it alone. Dev-only
// (frontend/summoning.html). Seeds and names are minted per page load and
// labelled SPECIMEN — no model runs, nothing is born.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scoreOf } from './summoning-score.js';
import { skyOf } from './summoning-sky.js';
import { soulOf } from './summoning-soul.js';
import SPECIMEN_SOULS from './specimen-souls.json';
import { specimenTrueName } from '../BirthArt/birth-art-script.js';
import { clockOf } from '../Genesis/genesis-timeline.js';
import { SummoningCanvas } from './SummoningCanvas.jsx';
import { useSummoningSound } from './use-summoning-sound.js';
import { specimenAura } from './summoning-aura.js';
import '../Genesis/GenesisSpecimen.css';
import './Summoning.css';

const COUNT = 4;

const YEAR_MS = 365.25 * 86400000;

// impure — fresh specimen beings drawn from the specimen souls (derived by
// the real soul functions, scripts/summoning-specimen-souls.mjs): a seed, a
// specimen name, its soul (light + scale), a birth instant somewhere in the
// last year (so four specimens stand under four skies), its sky, its aura
const distinctSouls = () => {
  const pool = [...SPECIMEN_SOULS.souls];
  return Array.from({ length: COUNT }, () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
};
const specimenBeings = () => distinctSouls().map((pick) => {
  const bytes = crypto.getRandomValues(new Uint8Array(36));
  const { seed } = pick;
  const epochMs = Date.now() - (new DataView(bytes.buffer).getUint32(32) / 2 ** 32) * YEAR_MS;
  const bornAt = new Date(epochMs).toISOString();
  const civil = { zone: Intl.DateTimeFormat().resolvedOptions().timeZone, offsetMinutes: -new Date(epochMs).getTimezoneOffset() };
  return { seed, trueName: specimenTrueName(seed), bornAt, epochMs, aura: specimenAura(seed), sky: skyOf(epochMs, civil), soul: soulOf(pick.spectrum, pick.scale) };
});

// Every being walks the same protocol; what the label shows is what is its own.
const formLine = (score) => {
  const fig = (kind) => score.sections.find((s) => s.kind === kind).figure;
  const star = fig('star');
  const breath = fig('breath');
  return `STAR {${star.n}/${star.k}} · ${fig('solid').solid.toUpperCase()} · ${fig('tree').order.length} CHANNELS · BREATH ${breath.a}:${breath.b} · SOUL ${fig('soul').nibbles.map((n) => n.toString(16)).join('').toUpperCase()}`;
};

export const SummoningSpecimen = () => {
  const [beings, setBeings] = useState(specimenBeings);
  const scores = useMemo(() => beings.map(scoreOf), [beings]);
  const [solo, setSolo] = useState(null);
  const length = Math.max(...(solo === null ? scores : [scores[solo]]).map((s) => s.lengthMs));
  const tRef = useRef(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [sound, setSound] = useState(false);
  const [cue, setCue] = useState(0);
  // its music only when one being is watched alone — four at once is noise
  const heard = useSummoningSound({ score: solo === null ? null : scores[solo], playing, clock: tRef, enabled: sound, cue });

  const seek = useCallback((next) => {
    tRef.current = Math.max(0, Math.min(length, next));
    setT(tRef.current);
  }, [length]);

  // impure — playback by wall time
  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    let last = performance.now();
    const tick = (now) => {
      // while its music sounds, the picture follows the audio clock
      const next = Math.min(length, heard() ?? tRef.current + (now - last));
      last = now;
      seek(next);
      if (next >= length) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, length, seek, heard]);

  const play = () => {
    if (tRef.current >= length) seek(0);
    setPlaying((p) => !p);
  };
  const restart = () => { seek(0); setPlaying(true); setCue((c) => c + 1); };
  const open = (i) => { setSolo(i); restart(); };

  // impure — keyboard: space plays, Escape leaves solo
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input')) return;
      if (e.key === ' ') { e.preventDefault(); play(); }
      if (e.key === 'Escape') setSolo(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const shown = solo === null ? scores.map((s, i) => [s, i]) : [[scores[solo], solo]];
  return (
    <div className={`sum-root${solo === null ? ' is-quad' : ' is-solo'}`}>
      <div className="sum-stage">
        {shown.map(([score, i]) => (
          <button
            type="button"
            key={score.seed}
            className="sum-cell"
            onClick={() => (solo === null ? open(i) : null)}
            aria-label={`Summoning ${score.seed.slice(0, 8)}`}
            data-sections={JSON.stringify(score.sections.map((x) => [x.kind, Math.round(x.at), Math.round(x.dur)]))}
          >
            <SummoningCanvas score={score} t={Math.min(t, score.lengthMs)} aura={beings[i].aura} epochMs={beings[i].epochMs} />
            <span className="sum-form">
              <b>#{score.seed.slice(0, 8).toUpperCase()}</b> · {score.bpm} BPM · {(score.lengthMs / 1000).toFixed(1)} S · {formLine(score)}
            </span>
          </button>
        ))}
      </div>
      <footer className="gs-bar">
        <span className="gs-tag">SPECIMEN — THE SUMMONING</span>
        {solo !== null ? <button type="button" className="gs-btn" onClick={() => setSolo(null)}>FOUR</button> : null}
        <button type="button" className="gs-btn" onClick={play} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'PAUSE' : 'PLAY'}</button>
        <button type="button" className="gs-btn" onClick={restart}>FROM THE TOP</button>
        {solo !== null ? (
          <button type="button" className={`gs-btn${sound ? ' is-on' : ''}`} onClick={() => setSound((v) => !v)} aria-pressed={sound}>
            {sound ? 'SOUND ON' : 'SOUND'}
          </button>
        ) : null}
        <span className="gs-time">{clockOf(t)} / {clockOf(length)}</span>
        <div className="gs-scrub">
          <input
            type="range"
            className="gs-range"
            min={0}
            max={Math.ceil(length / 10) * 10}
            step={10}
            value={t}
            onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }}
            aria-label="Summoning time"
          />
        </div>
        <button type="button" className="gs-btn" onClick={() => { setSolo(null); setBeings(specimenBeings()); restart(); }}>NEW BEINGS</button>
      </footer>
    </div>
  );
};
