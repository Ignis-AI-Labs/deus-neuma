// use-summoning-sound — plays a being's music (summoning-music.js through
// summoning-sound.js) in step with a playing summoning. // impure (audio)
// Scheduled from the clock's present moment whenever playback starts; any
// pause (a seek pauses too) silences it, and the next play picks it up
// exactly where the picture is.
//
// THE AUDIO CLOCK IS THE MASTER. While it sounds, the picture reads its time
// from the sound card (`now()`), never from its own frame clock — two clocks
// drift apart over ninety seconds; one clock cannot.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { musicOf } from './summoning-music.js';
import { scheduleMusic } from './summoning-sound.js';

/**
 * @param {{ score?: object|null, music?: object|null, playing: boolean, clock: { current: number }, enabled: boolean, cue: number }} args
 *   score — a film, played as its own music; or `music` — any score of the
 *   same shape (THE SUMMONING RITE's, threshold to homecoming)
 *   cue — bumped whenever the clock jumps while playing (from the top), so the music follows
 */
export const useSummoningSound = ({ score = null, music: given = null, playing, clock, enabled, cue }) => {
  const ctxRef = useRef(null);
  const anchor = useRef(null); // { ctxTime, scoreMs } — where the music was cued
  const music = useMemo(() => given ?? (score ? musicOf(score) : null), [given, score]);

  useEffect(() => {
    if (!enabled || !playing || !music) return undefined;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return undefined;
    if (!ctxRef.current) ctxRef.current = new Ctx();
    const ctx = ctxRef.current;
    ctx.resume();
    const startAt = ctx.currentTime + 0.06;
    anchor.current = { ctxTime: startAt, scoreMs: clock.current };
    const handle = scheduleMusic(ctx, music, { fromMs: clock.current, startAt });
    return () => { anchor.current = null; handle.stop(); };
  }, [enabled, playing, music, clock, cue]);

  // impure — the context closes with the page's summoning
  useEffect(() => () => { ctxRef.current?.close(); ctxRef.current = null; }, []);

  /** The score time the music is sounding now, or null when it is silent. */
  return useCallback(() => {
    const a = anchor.current;
    const ctx = ctxRef.current;
    if (!a || !ctx || ctx.state !== 'running') return null;
    return a.scoreMs + Math.max(0, ctx.currentTime - a.ctxTime) * 1000;
  }, []);
};
