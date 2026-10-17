// use-voice-preview — the streamed-preview lane extracted verbatim from
// VoiceApp.jsx (size-law breakdown, 2026-08-26): wrapPreviewBlob, the
// scheduler/generation refs, stopPreviewAudio, runPreview, and both preset
// auditions (iterate-stage session preview + offering-stage one-off). The
// gen-counter staleness protocol lives here WHOLE — every preview reset bumps
// the generation and every in-flight resolve checks it against its own; the
// counter and its checkers are never split apart. Candidate state stays owned
// by the forge lane: this hook receives setCandidate / setVoiceId / setError
// explicitly and never imports VoiceApp.jsx.

import { useEffect, useState, useRef } from 'react';
import {
  streamPreview, adjustCandidate, auditionEngineVoice,
  pcmToWavBlob, buildDesignPreviewRequest,
} from './voice-client.js';
import { uiSound } from '../../services/ui-sound.js';

// Wrap raw response bytes in a WAV blob the <audio> element can play.
// PCM responses need wrapping; MP3 (cloud) responses are already playable.
// Async because pcmToWavBlob operates on raw bytes — the response carries a
// Blob, so its ArrayBuffer must be read out before wrapping (a Blob has no
// .byteLength, so passing it straight in throws DataView out-of-bounds).
const wrapPreviewBlob = async (response) => {
  if (!response) return null;
  if (response.contentType.includes('mpeg') || response.contentType.includes('mp3')) {
    return response.blob;
  }
  // Raw PCM — wrap in WAV
  const bytesPerSample = response.format === 'pcm_f32le' ? 4 : 2;
  const pcmBytes = await response.blob.arrayBuffer();
  return pcmToWavBlob(pcmBytes, {
    sampleRate: response.sampleRate,
    channels: response.channels,
    bytesPerSample,
  });
};

export const useVoicePreview = ({
  sessionId, mode, description, voiceSeed, previewText, presets,
  setCandidate, setVoiceId, setError,
}) => {
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [auditioningId, setAuditioningId] = useState(null);   // preset id mid-audition
  const [previewHeardLive, setPreviewHeardLive] = useState(false); // streamed take already played live — player mounts paused
  const previewSchedulerRef = useRef(null);                   // live preview scheduler (streamed takes)
  const previewGenRef = useRef(0);                            // bumps on every preview reset — stale resolves die

  // Clean up blob URLs on unmount / new preview
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  // impure — stop any live preview stream: bump the generation so an in-flight
  // streamPreview resolve lands as stale, then silence the scheduler it owned.
  const stopPreviewAudio = () => {
    previewGenRef.current += 1;
    const s = previewSchedulerRef.current;
    previewSchedulerRef.current = null;
    if (s) { s.interrupt(); s.dispose(); }
  };

  // Stop live preview audio on unmount
  useEffect(() => () => stopPreviewAudio(), []);

  const runPreview = async () => {
    uiSound('activate');
    stopPreviewAudio();
    const gen = previewGenRef.current;
    setPreviewing(true);
    setError(null);
    try {
      const response = await streamPreview(sessionId, {
        text: previewText,
        recordSnapshot: true,
        // Design sessions carry the design triple {text, description, seed} —
        // never a ref field (the sidecar 400s description+ref together).
        design: mode === 'design'
          ? buildDesignPreviewRequest({ text: previewText, description, seed: voiceSeed })
          : undefined,
        // Published at creation — stopPreviewAudio can silence mid-stream;
        // shouldAbort covers a cancel that landed before the scheduler existed.
        onScheduler: (s) => { previewSchedulerRef.current = s; },
        shouldAbort: () => gen !== previewGenRef.current,
      });
      if (gen !== previewGenRef.current) {
        // Reset landed while the take resolved — already silenced, either by
        // stopPreviewAudio (post-publish) or the terminal dispose (pre-publish).
        return;
      }
      const blob = await wrapPreviewBlob(response);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewHeardLive(response.streamed);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      // Streamed takes already played live through the scheduler, so the
      // player mounts paused (autoPlay off); the take stays re-hearable.
    } catch (err) {
      setError(err.message);
    } finally {
      setPreviewing(false);
    }
  };

  // One-click audition (iterate stage only): select the preset, apply it as
  // the candidate's voiceId, then stream the preview for it.
  const auditionPreset = async (id) => {
    uiSound('activate');
    stopPreviewAudio();
    const gen = previewGenRef.current;
    setAuditioningId(id);
    setError(null);
    try {
      setVoiceId(id);
      const r = await adjustCandidate(sessionId, { engine: { voiceId: id } });
      setCandidate(r.candidateDNA);
      const response = await streamPreview(sessionId, {
        text: previewText,
        recordSnapshot: true,
        onScheduler: (s) => { previewSchedulerRef.current = s; },
        shouldAbort: () => gen !== previewGenRef.current,
      });
      if (gen !== previewGenRef.current) return;
      const blob = await wrapPreviewBlob(response);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewHeardLive(response.streamed);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError(err.message);
    } finally {
      setAuditioningId(null);
    }
  };

  // Offering-stage audition (one-off): the preset speaks through its OWN
  // engine — no session or candidate involved, nothing is recorded. The same
  // streaming reader plays it live; a new click or cancel silences it.
  // PresetGallery hands us the preset's id string — the handler resolves the
  // manifest entry (engine + id) itself.
  const auditionOffering = async (id) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    uiSound('activate');
    stopPreviewAudio();
    const gen = previewGenRef.current;
    setAuditioningId(p.id);
    setError(null);
    try {
      await auditionEngineVoice(p.engine, {
        voiceId: p.id,
        onScheduler: (s) => { previewSchedulerRef.current = s; },
        shouldAbort: () => gen !== previewGenRef.current,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setAuditioningId(null);
    }
  };

  return {
    previewing, previewUrl, setPreviewUrl, previewHeardLive, setPreviewHeardLive,
    auditioningId, stopPreviewAudio, runPreview, auditionPreset, auditionOffering,
  };
};
