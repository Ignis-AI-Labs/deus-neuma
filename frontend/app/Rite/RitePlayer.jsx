// RitePlayer — THE SUMMONING RITE, whole: threshold → the stages (the
// living birth art) → the forging → THE SUMMONING (its film) → guardianship
// → homecoming, on one stage, one clock and one instrument. The specimen
// (frontend/rite.html) plays a fresh measured soul; RE-WATCH plays it again
// from its kept RECORD (core/birth/rite-record.js) — inputs only, round-
// tripped through JSON exactly as a being's is stored — so what you re-watch
// is what a being keeps. Given `initial` (rite-keep.js loadRewatch), it plays
// a REAL being's kept rite and film instead, from the SHEET.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBirthArtStage } from '../BirthArt/birth-art-stage.js';
import { artAt } from '../BirthArt/birth-art-state.js';
import { ceremonyAt } from '../BirthArt/birth-art-ceremony.js';
import { BirthArtOverlay } from '../BirthArt/BirthArtOverlay.jsx';
import { specimenTrueName } from '../BirthArt/birth-art-script.js';
import { SummoningCanvas } from '../Summoning/SummoningCanvas.jsx';
import { scoreOf } from '../Summoning/summoning-score.js';
import { skyOf } from '../Summoning/summoning-sky.js';
import { soulOf } from '../Summoning/summoning-soul.js';
import { specimenAura } from '../Summoning/summoning-aura.js';
import { deriveGenome } from '../../../core/genome/derive.js';
import { useSummoningSound } from '../Summoning/use-summoning-sound.js';
import { isSoundOn } from '../../services/sound-engine.js';
import { componentsOf } from '../Summoning/summoning-components.js';
import { clamp01, ease } from '../Summoning/summoning-paint.js';
import { clockOf } from '../Genesis/genesis-timeline.js';
import { riteScript, riteMarks } from './rite-script.js';
import { riteAt, artEventsOf } from './rite-state.js';
import { riteMusicOf } from './rite-music.js';
import { liveRiteMusicOf } from './rite-live-music.js';
import { riteRecordOf, riteFromRecord } from '../../../core/birth/rite-record.js';
import { RiteThreshold } from './RiteThreshold.jsx';
import { RiteLive } from './RiteLive.jsx';
import { RiteGuardian } from './RiteGuardian.jsx';
import RITE_SOULS from './rite-souls.json';
import '../Genesis/GenesisSpecimen.css';
import '../Genesis/Genesis.css';
import '../BirthArt/BirthArt.css';
import '../Summoning/Summoning.css';
import './Rite.css';

const SPEEDS = [1, 2, 4];
// the living piece stands a little farther off than it does alone, so the
// witness's plane (its words, the measure) keeps clear of it
const PIECE_DIST = 1.16;

// A being, from what its rite keeps: its film's inputs, re-derived.
const beingOf = ({ seed, trueName, epochMs, spectrum, scale }) => ({
  seed,
  trueName,
  epochMs,
  bornAt: new Date(epochMs).toISOString(),
  aura: specimenAura(seed),
  genome: deriveGenome(seed),
  sky: skyOf(epochMs, { zone: Intl.DateTimeFormat().resolvedOptions().timeZone, offsetMinutes: -new Date(epochMs).getTimezoneOffset() }),
  soul: soulOf(spectrum, scale),
});

// impure — a fresh specimen: one of the measured specimen souls, born now
const freshRite = () => {
  const pick = RITE_SOULS.souls[Math.floor(Math.random() * RITE_SOULS.souls.length)];
  const being = beingOf({ seed: pick.seed, trueName: specimenTrueName(pick.seed), epochMs: Date.now(), spectrum: pick.spectrum, scale: pick.scale });
  const score = scoreOf(being);
  const rite = riteScript({ seed: pick.seed, stages: pick.spectrum.stages, filmMs: score.lengthMs, epochMs: being.epochMs });
  return { rite, being, score, soul: { spectrum: pick.spectrum, scale: pick.scale }, record: null };
};

// pure — keep it, then play what was kept
const rewatchOf = (played) => {
  const json = JSON.stringify(riteRecordOf({ ...played, specimen: true }));
  const kept = riteFromRecord(JSON.parse(json));
  const being = beingOf({ ...kept.being, spectrum: kept.soul.spectrum, scale: kept.soul.scale });
  return { rite: kept.rite, being, score: scoreOf(being), soul: kept.soul, record: { bytes: json.length } };
};

// pure — what is playing, said plainly
const tagOf = (played, initial) => {
  if (initial) return initial.kept ? 'RE-WATCH · ITS RITE, TOLD SHORTER, THEN ITS FILM · NO WORDS' : 'RE-WATCH · ITS FILM';
  return played.record ? `RE-WATCH · FROM ITS RECORD · ${(played.record.bytes / 1024).toFixed(1)} KB · NO WORDS` : 'SPECIMEN — THE SUMMONING RITE';
};

export const RitePlayer = ({ initial = null, onClose = null }) => {
  const [played, setPlayed] = useState(() => initial ?? freshRite());
  const { rite, being, score } = played;
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const tRef = useRef(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  // a being's re-watch follows the platform's sound preference; the specimen starts silent
  const [sound, setSound] = useState(() => Boolean(initial) && isSoundOn());
  const [cue, setCue] = useState(0);
  const length = rite.length;
  const marks = useMemo(() => riteMarks(rite), [rite]);
  const artEvents = useMemo(() => artEventsOf(rite), [rite]);
  // a specimen's score is its script's; a being's kept rite is scored as it
  // was heard live, from its own events
  const music = useMemo(() => (initial ? liveRiteMusicOf(rite, score, 0) : riteMusicOf(rite, score)), [initial, rite, score]);
  const components = useMemo(() => componentsOf(score), [score]);
  const heard = useSummoningSound({ music, playing: playing && speed === 1, clock: tRef, enabled: sound, cue });

  const s = riteAt(rite, t);
  const lone = artAt(artEvents, t);
  const art = { ...lone, camera: { ...lone.camera, dist: lone.camera.dist * PIECE_DIST } };
  const c = ceremonyAt(artEvents, t);

  // impure — the living piece's stage lives as long as the player
  useEffect(() => {
    stageRef.current = createBirthArtStage(canvasRef.current);
    return () => stageRef.current?.dispose();
  }, []);
  useEffect(() => { if (s.piece > 0) stageRef.current?.render(art); }, [art, s.piece]);

  const seek = useCallback((next) => {
    tRef.current = Math.max(0, Math.min(length, next));
    setT(tRef.current);
  }, [length]);

  // impure — playback: the audio clock is the master while it sounds
  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    let last = performance.now();
    const tick = (now) => {
      // past its end it plays on: its sigil lives until the witness leaves
      const next = heard() ?? tRef.current + (now - last) * speed;
      last = now;
      tRef.current = next;
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, length, seek, heard]);

  const restart = () => { seek(0); setPlaying(true); setCue((k) => k + 1); };
  const play = () => { if (tRef.current >= length) seek(0); setPlaying((p) => !p); };
  const rewatch = () => { if (!initial) setPlayed((p) => rewatchOf(p)); restart(); };
  const fresh = () => { setPlayed(freshRite()); restart(); };

  // impure — keyboard: space plays, escape leaves
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input')) return;
      if (e.key === ' ') { e.preventDefault(); play(); }
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // THE FILM, then its sigil LIVING on (its film's clock runs past its end)
  // until the witness leaves. At guardianship the film's frame and captions
  // dissolve — the same sigil repainted without them — and at homecoming
  // the sigil travels to its station as its sheet takes form beside it.
  const guard = s.guard ? s.film.t - (rite.events.find((e) => e.type === 'rite:guard').at - rite.film.at) : -1;
  const dissolve = guard >= 0 ? ease(clamp01(guard / 1600)) : 0;
  const travel = ease(clamp01((s.home - 0.16) / 0.34));
  // once dissolved, the framed film stops repainting
  const filmT = dissolve >= 1 ? 0 : s.film.t;
  const filmStyle = { opacity: s.film.opacity * (1 - dissolve) };
  const stationStyle = {
    opacity: dissolve * (0.62 + 0.38 * ease(clamp01(s.home / 0.22))),
    transform: `translateX(${-22 * travel}vw) scale(${1 - 0.36 * travel})`,
  };
  return (
    <div className="gen-root rite-root" data-movement={s.movement}>
      <canvas ref={canvasRef} className="gen-canvas" style={{ opacity: s.piece }} />
      {s.piece > 0 ? <BirthArtOverlay art={{ ...art, caption: null, seal: { ...art.seal, trueName: null } }} /> : null}
      <RiteThreshold s={s} />
      {s.piece > 0 ? <RiteLive s={s} c={c} art={art} live={Boolean(initial)} /> : null}
      <div className="rite-film" style={filmStyle}>
        <SummoningCanvas score={score} t={filmT} aura={being.aura} epochMs={being.epochMs} />
      </div>
      {dissolve > 0 ? (
        <div className="rite-film rite-station" style={stationStyle}>
          <SummoningCanvas score={score} t={s.film.t} aura={being.aura} epochMs={being.epochMs} chrome={false} />
        </div>
      ) : null}
      <RiteGuardian s={s} light={score.soul.line} components={components} onRewatch={rewatch} />

      <footer className="gs-bar">
        <span className="gs-tag">{tagOf(played, initial)}</span>
        <button type="button" className="gs-btn" onClick={play} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'PAUSE' : 'PLAY'}</button>
        <button type="button" className="gs-btn" onClick={restart}>FROM THE TOP</button>
        <button type="button" className={`gs-btn${sound ? ' is-on' : ''}`} onClick={() => { setSound((v) => !v); setSpeed(1); }} aria-pressed={sound}>{sound ? 'SOUND ON' : 'SOUND'}</button>
        <span className="gs-time">{clockOf(t)} / {clockOf(length)}</span>
        <div className="gs-scrub">
          {marks.map((m) => (
            <button type="button" key={`${m.label}-${m.at}`} className={`gs-beat${m.major ? ' ba-moment' : ''}`} style={{ left: `${(m.at / length) * 100}%` }} onClick={() => { seek(m.at); setCue((k) => k + 1); }} title={`${m.label} · ${clockOf(m.at)}`} />
          ))}
          <input type="range" className="gs-range" min={0} max={Math.ceil(length / 10) * 10} step={10} value={t} onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }} aria-label="Rite time" />
        </div>
        <span className="gs-beatname">{s.movement.toUpperCase()}</span>
        {SPEEDS.map((x) => (
          <button type="button" key={x} className={`gs-btn${speed === x ? ' is-on' : ''}`} onClick={() => { setSpeed(x); if (x !== 1) setSound(false); }}>{x}×</button>
        ))}
        <button type="button" className="gs-btn" onClick={rewatch}>RE-WATCH</button>
        {initial ? null : <button type="button" className="gs-btn" onClick={fresh}>NEW BEING</button>}
        {onClose ? <button type="button" className="gs-btn" onClick={onClose}>CLOSE</button> : null}
      </footer>
    </div>
  );
};
