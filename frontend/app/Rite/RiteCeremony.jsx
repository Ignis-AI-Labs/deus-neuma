// RiteCeremony — THE SUMMONING RITE on a LIVE birth. // impure
//
// Design note, 2026-09-30: […] The preview (RitePlayer, /rite.html) played
// scripted events; this plays the real wire through the same pure state —
// the living birth art (artAt), the measure and the forging (riteAt,
// RiteLive), its film (scoreOf → SummoningCanvas) and one instrument
// throughout (liveRiteMusicOf → useSummoningSound).
//
// The ceremony's own panels (StagedCeremonyScene — its words, the operator's
// words, continue, the disclosure, withdraw) stay the kept vanilla DOM,
// relaid over this stage (`.birth-ceremony.is-rite`); this layer is the
// field behind them. At its birth the film plays full-bleed over everything;
// when it ends (or the witness moves on) `rite:film-done` releases the
// ceremony's guardianship steps, and its sigil lives on behind them.
//
// Sound obeys the platform's preference (sound-engine isSoundOn) — never on
// by itself. The audio clock is the master while it sounds. At its birth its
// rite is kept for re-watching (rite-keep.js) — its rhythm, never a word.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createBirthArtStage } from '../BirthArt/birth-art-stage.js';
import { artAt } from '../BirthArt/birth-art-state.js';
import { ceremonyAt } from '../BirthArt/birth-art-ceremony.js';
import { SummoningCanvas } from '../Summoning/SummoningCanvas.jsx';
import { scoreOf } from '../Summoning/summoning-score.js';
import { useSummoningSound } from '../Summoning/use-summoning-sound.js';
import { isSoundOn } from '../../services/sound-engine.js';
import { riteAt, artEventsOf } from './rite-state.js';
import { openRiteFeed } from './rite-live-feed.js';
import { liveBeingOf, liveRiteOf } from './rite-live-being.js';
import { liveRiteMusicOf, soundingKeyOf } from './rite-live-music.js';
import { RiteLive } from './RiteLive.jsx';
import { RiteThreshold } from './RiteThreshold.jsx';
import { riteRecordOf } from '../../../core/birth/rite-record.js';
import { keepRite } from './rite-keep.js';
import '../Genesis/Genesis.css';
import '../BirthArt/BirthArt.css';
import '../Summoning/Summoning.css';
import './Rite.css';
import './RiteCeremony.css';

const PIECE_DIST = 1.16;
const FILM_TAIL_MS = 1500; // its sigil holds whole before the ceremony moves on

// pure — the film's life: before its birth, playing, done
const filmPhaseOf = (born, t, score, released) => {
  if (!Number.isFinite(born) || t < born || !score) return 'before';
  if (released || t - born >= score.lengthMs + FILM_TAIL_MS) return 'done';
  return 'playing';
};

export const RiteCeremony = ({ wsService }) => {
  const feedRef = useRef(null);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const tRef = useRef(0);
  const [t, setT] = useState(0);
  const [version, setVersion] = useState(0);
  const [begun, setBegun] = useState(false);
  const [threshold, setThreshold] = useState(false); // the threshold has spoken (rite-signal.js)
  const [released, setReleased] = useState(false);
  const [cue, setCue] = useState(0);
  const sound = useMemo(() => isSoundOn(), []);

  // impure — the feed lives as long as the ceremony
  useEffect(() => {
    const feed = openRiteFeed(wsService);
    feedRef.current = feed;
    const off = feed.subscribe(() => setVersion((v) => v + 1));
    const begin = () => { feed.push({ type: 'rite:begin' }); setBegun(true); };
    const signal = (e) => { feed.push(e.detail); setThreshold(true); };
    window.addEventListener('rite:begin', begin);
    window.addEventListener('rite:signal', signal);
    window.__neumaRiteLive = true;
    return () => {
      window.removeEventListener('rite:begin', begin);
      window.removeEventListener('rite:signal', signal);
      window.__neumaRiteLive = false;
      off();
      feed.close();
    };
  }, [wsService]);

  const feed = feedRef.current;
  const events = feed ? feed.events() : [];
  const being = useMemo(() => liveBeingOf(feed?.film()), [feed, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const score = useMemo(() => {
    if (!being) return null;
    try { return scoreOf(being); } catch { return null; }
  }, [being]);
  const rite = liveRiteOf(events, score?.lengthMs ?? 0, t);
  const soundKey = soundingKeyOf(events);
  const music = useMemo(() => liveRiteMusicOf(rite, score, tRef.current), [soundKey, score]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCue((k) => k + 1); }, [soundKey, score]);
  const heard = useSummoningSound({ music, playing: begun, clock: tRef, enabled: sound, cue });

  // impure — the living piece's WebGL stage
  useEffect(() => {
    if (!begun || !canvasRef.current) return undefined;
    stageRef.current = createBirthArtStage(canvasRef.current);
    return () => { stageRef.current?.dispose(); stageRef.current = null; };
  }, [begun]);

  // impure — the clock. A live rite's events are stamped on the FEED's clock,
  // so that is the picture's master; the sound is cued from it at every
  // sounding frame. Only while the film plays does the audio card lead (the
  // film's AV law) — and only while it truly runs: a card that is not
  // advancing (no device, suspended) never freezes the picture.
  const awake = begun || threshold;
  useEffect(() => {
    if (!awake || !feed) return undefined;
    let raf;
    const tick = () => {
      const live = feed.now();
      const heardAt = heard();
      tRef.current = heardAt !== null && Math.abs(heardAt - live) < 1000 ? heardAt : live;
      setT(tRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [awake, feed, heard]);

  // impure — at its birth its rite is kept, once: its rhythm, never a word
  // (core/birth/rite-record.js). A rehearsal keeps nothing.
  const kept = useRef(false);
  const bornAt = rite.film.at;
  useEffect(() => {
    const neumaId = feed?.film()?.neumaId;
    if (kept.current || !being || being.rehearsal || !score || !neumaId || !Number.isFinite(bornAt)) return;
    kept.current = true;
    const film = feed.film();
    keepRite(neumaId, riteRecordOf({
      rite: { events: feed.events(), film: { ms: score.lengthMs }, length: bornAt + score.lengthMs },
      being: { ...being, zone: film.zone, offsetMinutes: film.offsetMinutes },
    }));
  }, [feed, being, score, bornAt]);

  const phase = filmPhaseOf(rite.film.at, t, score, released);
  // impure — the film's end releases the ceremony's guardianship steps, once
  const doneSent = useRef(false);
  useEffect(() => {
    if (phase === 'done' && !doneSent.current) {
      doneSent.current = true;
      window.dispatchEvent(new CustomEvent('rite:film-done'));
    }
  }, [phase]);
  // a birth that cannot be filmed (a record missing) never holds the ceremony back
  const bornNoFilm = Number.isFinite(rite.film.at) && t >= rite.film.at + 2000 && !score;
  useEffect(() => {
    if (bornNoFilm && !doneSent.current) {
      doneSent.current = true;
      window.dispatchEvent(new CustomEvent('rite:film-done'));
    }
  }, [bornNoFilm]);

  const artEvents = artEventsOf(rite);
  const s = riteAt(rite, t);
  const lone = artAt(artEvents, t);
  const art = { ...lone, camera: { ...lone.camera, dist: lone.camera.dist * PIECE_DIST } };
  const c = ceremonyAt(artEvents, t);
  useEffect(() => { if (s.piece > 0) stageRef.current?.render(art); });

  if (!awake) return null;
  const filmT = Math.max(0, t - rite.film.at);
  return (
    <div className="rite-ceremony" data-movement={s.movement} data-film={phase}>
      <div className="rite-ceremony-field">
        {/* I · THE THRESHOLD: its figure behind the covenant, the vessel and
            the introduction; it gives way as the lens opens into stage 0 */}
        {threshold ? <RiteThreshold s={s} live /> : null}
        <canvas ref={canvasRef} className="gen-canvas" style={{ opacity: s.piece }} />
        {s.piece > 0 ? <RiteLive s={s} c={c} art={art} live /> : null}
        {phase === 'done' && score ? (
          <div className="rite-film rite-ceremony-sigil">
            <SummoningCanvas score={score} t={filmT} aura={being.aura} epochMs={being.epochMs} chrome={false} />
          </div>
        ) : null}
      </div>
      {/* over EVERYTHING — the ceremony's own layer included — so it lives
          outside this field's stacking context */}
      {phase === 'playing' ? createPortal(
        <div className="rite-ceremony-film" style={{ opacity: s.film.opacity }}>
          <SummoningCanvas score={score} t={filmT} aura={being.aura} epochMs={being.epochMs} />
          {being.rehearsal ? <span className="rite-ceremony-tag">REHEARSAL · ITS MEASURED SOUL · NOTHING KEPT</span> : null}
          <button type="button" className="rite-ceremony-on" onClick={() => setReleased(true)}>CONTINUE</button>
        </div>,
        document.body,
      ) : null}
    </div>
  );
};
