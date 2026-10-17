// PocketDreams — DREAMS: say the dream before it fades, read it later.
//
// One button: tap to start, tap to stop. The take is kept on the phone first
// (dream-outbox.js) and handed to the desk second; it leaves the phone only
// when the desk has it, and the desk writes the words down on its own
// speech engine. The journal is the witness's own — no being reads it
// (backend/services/user-dreams.js). The screen stays awake while recording.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDreamRecorder } from './use-dream-recorder.js';
import { usePocketWake } from './use-pocket-wake.js';
import { clockOf, whenOf, wordsOf } from './dream-format.js';
import { takesOf, releaseTake } from '../../services/dream-outbox.js';
import { listDreams, sendDream, transcribeDream, dreamRecording, deleteDream } from '../../services/dream-client.js';
import { uiSound } from '../../services/ui-sound.js';
import './PocketDreams.css';

const POLL_MS = 4_000;
const CONFIRM_MS = 3_000;

const walletNow = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('walletAddress') : null);

/**
 * @param {{ autoRecord?: boolean }} props — true when opened from the app icon's "Record a dream"
 */
export const PocketDreams = ({ autoRecord = false }) => {
  const wallet = walletNow();
  const [dreams, setDreams] = useState([]);
  const [waiting, setWaiting] = useState([]); // takes still on this phone
  const [problem, setProblem] = useState(null);
  const [playing, setPlaying] = useState(null); // { id, audio, url }
  const [confirming, setConfirming] = useState(null);
  const sending = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setDreams(await listDreams());
      setProblem(null);
    } catch (err) {
      setProblem(err.message);
    }
  }, []);

  const recorder = useDreamRecorder({ wallet, onKept: () => { sendWaiting(); } });
  const { liveId } = recorder;
  usePocketWake(recorder.state === 'recording');

  // impure — hand every finished (or orphaned) take to the desk, oldest first.
  const sendWaiting = useCallback(async () => {
    if (!wallet || sending.current) return;
    sending.current = true;
    try {
      for (const take of await takesOf(wallet)) {
        if (take.id === liveId()) continue; // still being spoken
        await sendDream(take);
        await transcribeDream(take.id).catch(() => { /* the journal offers a retry */ });
        await releaseTake(take.id);
      }
      await refresh();
    } catch (err) {
      // Said instead of the journal's own error: what matters is that the dream is safe.
      setProblem(`Kept on this phone — the desk did not answer (${err.message}). It sends when the link is back.`);
    } finally {
      sending.current = false;
      setWaiting(await takesOf(wallet).catch(() => []));
    }
  }, [wallet, liveId, refresh]);

  useEffect(() => { sendWaiting(); }, [sendWaiting]);
  useEffect(() => {
    const again = () => sendWaiting();
    window.addEventListener('online', again);
    return () => window.removeEventListener('online', again);
  }, [sendWaiting]);

  // While the desk is writing words down, look again until they land.
  const writing = dreams.some((d) => d.transcript?.state === 'working');
  useEffect(() => {
    if (!writing) return undefined;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [writing, refresh]);

  // Opened from the app icon's shortcut: start at once, then forget the ask.
  const autoDone = useRef(false);
  useEffect(() => {
    if (!autoRecord || autoDone.current || !wallet) return;
    autoDone.current = true;
    recorder.start();
  }, [autoRecord, wallet, recorder]);

  const toggle = () => {
    uiSound('activate');
    if (recorder.state === 'recording') recorder.stop();
    else recorder.start();
  };

  const stopPlaying = () => {
    if (!playing) return;
    playing.audio.pause();
    URL.revokeObjectURL(playing.url);
    setPlaying(null);
  };

  const play = async (id) => {
    if (playing?.id === id) { stopPlaying(); return; }
    stopPlaying();
    try {
      const url = URL.createObjectURL(await dreamRecording(id));
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); setPlaying(null); };
      setPlaying({ id, audio, url });
      await audio.play();
    } catch (err) {
      setProblem(err.message);
    }
  };

  const retry = async (id) => {
    try {
      await transcribeDream(id);
      refresh();
    } catch (err) {
      setProblem(err.message);
    }
  };

  // Deliberate: the first tap asks, the second (within a breath) deletes.
  const remove = async (id) => {
    if (confirming !== id) {
      setConfirming(id);
      setTimeout(() => setConfirming((c) => (c === id ? null : c)), CONFIRM_MS);
      return;
    }
    setConfirming(null);
    if (playing?.id === id) stopPlaying();
    try {
      await deleteDream(id);
      refresh();
    } catch (err) {
      setProblem(err.message);
    }
  };

  const recording = recorder.state === 'recording';
  return (
    <section className="pocket-dreams">
      <div className="dream-record">
        <button
          type="button"
          className="dream-record-btn"
          data-recording={String(recording)}
          disabled={!wallet || recorder.state === 'starting'}
          onClick={toggle}
          aria-label={recording ? 'Stop recording the dream' : 'Record a dream'}
        >
          <span className="dream-record-mark" aria-hidden="true" />
          <span className="label-data">{recording ? `STOP · ${clockOf(recorder.elapsedMs)}` : 'RECORD A DREAM'}</span>
        </button>
        {recorder.state === 'refused' ? (
          <p className="dream-note" role="alert">The microphone was refused. Allow it for this site in the browser, then try again.</p>
        ) : null}
        {!wallet ? <p className="dream-note">Sign in on this phone to keep dreams.</p> : null}
      </div>
      {problem ? <p className="dream-note" role="status">{problem}</p> : null}
      <ol className="dream-list">
        {waiting.filter((t) => t.id !== recorder.takeId && !dreams.some((d) => d.id === t.id)).map((t) => (
          <li key={t.id} className="dream-item" data-waiting="true">
            <div className="dream-meta label-data">
              <span>{whenOf(t.recordedAt)}</span>
              <span>{clockOf(t.durationMs)}</span>
            </div>
            <p className="dream-words dream-faint">On this phone — sending to the desk.</p>
          </li>
        ))}
        {dreams.map((d) => {
          const { words, waiting: wordsWaiting, failed } = wordsOf(d.transcript);
          return (
            <li key={d.id} className="dream-item">
              <div className="dream-meta label-data">
                <span>{whenOf(d.recordedAt)}</span>
                <span>{clockOf(d.durationMs)}</span>
              </div>
              <p className={wordsWaiting || failed ? 'dream-words dream-faint' : 'dream-words'}>{words}</p>
              <div className="dream-actions">
                <button type="button" className="dream-act label-data" onClick={() => play(d.id)}>
                  {playing?.id === d.id ? 'STOP' : 'PLAY'}
                </button>
                {failed || d.transcript?.state === 'none' ? (
                  <button type="button" className="dream-act label-data" onClick={() => retry(d.id)}>WRITE THE WORDS</button>
                ) : null}
                <button type="button" className="dream-act dream-act-delete label-data" onClick={() => remove(d.id)}>
                  {confirming === d.id ? 'DELETE?' : 'DELETE'}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      {dreams.length === 0 && waiting.length === 0 && !problem ? (
        <p className="dream-note">Your dreams stay yours: kept on your desk, read by no being unless you share one.</p>
      ) : null}
    </section>
  );
};
