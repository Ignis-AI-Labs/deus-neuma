// use-dream-recorder — one tap starts a dream, one tap ends it.
//
// The take is written to the phone's outbox while it is still being spoken
// (every SNAPSHOT_MS) and once more when it stops, so a tab the phone kills
// mid-dream still leaves the dream behind. Chunks accumulate from the first,
// so every snapshot carries the container header and plays on its own.
// impure (microphone, MediaRecorder, IndexedDB, timers).
import { useCallback, useEffect, useRef, useState } from 'react';
import { keepTake } from '../../services/dream-outbox.js';

const SNAPSHOT_MS = 10_000;
const TICK_MS = 1_000;

const recorderType = () => (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
  ? 'audio/webm;codecs=opus' : undefined);

/**
 * @param {{ wallet: string | null, onKept: (id: string) => void }} opts
 * @returns {{ state: 'idle'|'starting'|'recording'|'refused', elapsedMs: number, takeId: string | null, liveId: () => string | null, start: () => Promise<void>, stop: () => void }}
 *   liveId reads the take being spoken right now, past any render that has not caught up
 */
export const useDreamRecorder = ({ wallet, onKept }) => {
  const [state, setState] = useState('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [takeId, setTakeId] = useState(null);
  const live = useRef(null); // { recorder, stream, chunks, id, recordedAt, startedAt, snapAt, timer }
  const onKeptRef = useRef(onKept);
  onKeptRef.current = onKept;

  const takeOf = (t, done) => ({
    id: t.id,
    wallet,
    blob: new Blob(t.chunks, { type: t.recorder.mimeType || 'audio/webm' }),
    recordedAt: t.recordedAt,
    durationMs: Date.now() - t.startedAt,
    done,
  });

  const start = useCallback(async () => {
    if (live.current || !wallet) return;
    setState('starting');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setState('refused'); // no mic, or the browser said no (it does off https)
      return;
    }
    const mimeType = recorderType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const t = {
      recorder, stream, chunks: [], id: crypto.randomUUID(), recordedAt: new Date().toISOString(),
      startedAt: Date.now(), snapAt: Date.now(), timer: null,
    };
    live.current = t;
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      t.chunks.push(e.data);
      if (recorder.state === 'recording' && Date.now() - t.snapAt >= SNAPSHOT_MS) {
        t.snapAt = Date.now();
        keepTake(takeOf(t, false)).catch(() => { /* the final write still comes */ });
      }
    };
    recorder.onstop = async () => {
      clearInterval(t.timer);
      stream.getTracks().forEach((track) => track.stop());
      live.current = null;
      setTakeId(null);
      setState('idle');
      if (t.chunks.length === 0) return;
      await keepTake(takeOf(t, true));
      onKeptRef.current?.(t.id);
    };
    t.timer = setInterval(() => setElapsedMs(Date.now() - t.startedAt), TICK_MS);
    recorder.start(TICK_MS);
    setElapsedMs(0);
    setTakeId(t.id);
    setState('recording');
  }, [wallet]);

  const stop = useCallback(() => {
    const t = live.current;
    if (t && t.recorder.state !== 'inactive') t.recorder.stop();
  }, []);

  // Leaving the pane mid-dream ends the take; it is kept, not dropped.
  useEffect(() => () => stop(), [stop]);

  const liveId = useCallback(() => live.current?.id ?? null, []);

  return { state, elapsedMs, takeId, liveId, start, stop };
};
