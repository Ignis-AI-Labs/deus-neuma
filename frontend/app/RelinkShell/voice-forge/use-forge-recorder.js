// use-forge-recorder.js — the RECORD door's microphone.
//
// impure hook: opens the mic, captures through the ONE mic worklet
// (voice-mic-worklet.js — the same AudioWorklet pump the live voice sitting
// uses), drives the live level meter and the timer, and on stop hands back
// the recording as a WAV (forge-audio.js). Every audio object it opens — the
// MediaStream's tracks, the AudioContext, the worklet node, the captured
// chunks — is released on stop and on unmount, so the desk never keeps a mic
// open or audio in memory it is not using.
//
// The forge clones the voice from what the mic heard, so the browser's voice
// processing is asked OFF (noise suppression and gain control reshape a voice);
// the backend measures the room and says "noisy" plainly when it is.

import { useCallback, useEffect, useRef, useState } from 'react';
import { WORKLET_NAME, createWorkletUrl } from '../voice-mic-worklet.js';
import { RECORD_MAX_SECONDS, meterLevelOf, recordingOf } from './forge-audio.js';

const IDLE = Object.freeze({ phase: 'idle', level: 0, seconds: 0, error: null });

/**
 * @param {{onRecorded: (rec: {audioB64: string, seconds: number}) => void}} args
 * @returns {{phase: string, level: number, seconds: number, error: string|null, start: Function, stop: Function}}
 */
export const useForgeRecorder = ({ onRecorded }) => {
  const [view, setView] = useState(IDLE);
  const live = useRef(null);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  // impure — release every audio object the recording holds.
  const release = useCallback(() => {
    const r = live.current;
    live.current = null;
    if (!r) return null;
    if (r.node) { r.node.port.onmessage = null; r.node.disconnect(); }
    r.stream?.getTracks().forEach((t) => t.stop());
    r.ctx?.close().catch(() => {});
    return r;
  }, []);

  // impure — end the recording; `keep` hands it to the door, else it is dropped.
  const finish = useCallback((keep) => {
    const r = release();
    if (!r) return;
    if (!keep || r.chunks.length === 0) {
      setView(IDLE);
      return;
    }
    const recording = recordingOf(r.chunks, r.rate);
    r.chunks.length = 0;
    setView({ phase: 'done', level: 0, seconds: recording.seconds, error: null });
    onRecordedRef.current(recording);
  }, [release]);

  const start = useCallback(async () => {
    if (live.current) return;
    setView({ ...IDLE, phase: 'opening' });
    const r = { chunks: [], count: 0, rate: 0, stream: null, ctx: null, node: null };
    live.current = r;
    try {
      r.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      });
      r.ctx = new AudioContext();
      await r.ctx.audioWorklet.addModule(createWorkletUrl());
      // Stopped (or unmounted) while the mic was opening: free what opened.
      if (live.current !== r) {
        r.stream.getTracks().forEach((t) => t.stop());
        r.ctx.close().catch(() => {});
        return;
      }
      r.rate = r.ctx.sampleRate;
      r.node = new AudioWorkletNode(r.ctx, WORKLET_NAME);
      r.node.port.onmessage = (event) => {
        r.chunks.push(event.data);
        r.count += event.data.length;
        const seconds = r.count / r.rate;
        setView({ phase: 'recording', level: meterLevelOf(event.data), seconds, error: null });
        if (seconds >= RECORD_MAX_SECONDS) finish(true);
      };
      r.ctx.createMediaStreamSource(r.stream).connect(r.node);
      // The pump writes no output; the connection exists because an
      // unconnected worklet node is never pulled.
      r.node.connect(r.ctx.destination);
      setView({ ...IDLE, phase: 'recording' });
    } catch (err) {
      if (live.current !== r) return;
      release();
      setView({ ...IDLE, phase: 'error', error: err?.message || String(err) });
    }
  }, [finish, release]);

  const stop = useCallback(() => finish(true), [finish]);

  // Closing the door (or the window) mid-recording drops it and frees the mic.
  useEffect(() => () => { release(); }, [release]);

  return { ...view, start, stop };
};
