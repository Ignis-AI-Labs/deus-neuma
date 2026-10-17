// use-voice-forge — the Voice Forge ceremony state machine extracted verbatim
// from VoiceApp.jsx (size-law breakdown, 2026-08-26): existing-DNA refresh,
// the FR-4 pre-warm poll loop, mode pick, offering submit, candidate adjust,
// seal, and the clone-seed WAV re-render. Owns the ceremony + form state and
// returns its setters explicitly — VoiceApp composes them with the preview
// lane (use-voice-preview.js), which shares the candidate through the
// setCandidate handed on from here. This module never imports VoiceApp.jsx.

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  hasVoice, getVoiceDNA, getForgeEngines, getForgePresets,
  startForge, submitOffering, adjustCandidate, sealVoice,
  prewarmEngine, getEngineStatus,
  bumpDesignSeed,
  DESIGN_PROBE_TEXT, DESIGN_FULL_TEXT,
} from './voice-client.js';
import { uiSound } from '../../services/ui-sound.js';
import { normalizeSeedAudio } from './audio-normalize.js';

export const useVoiceForge = ({ neumaId, witnessWallet }) => {
  const [voice, setVoice] = useState(null);          // existing sealed DNA
  const [hasExisting, setHasExisting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [engines, setEngines] = useState([]);
  const [presets, setPresets] = useState([]);
  const [error, setError] = useState(null);

  // Ceremony state
  const [mode, setMode] = useState(null);             // 'clone' | 'design' | 'preset'
  const [, setEngine] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [stage, setStage] = useState('idle');         // 'idle' | 'pick' | 'offering' | 'iterate' | 'sealing' | 'sealed'
  const [candidate, setCandidate] = useState(null);
  const [sealing, setSealing] = useState(false);
  const [warming, setWarming] = useState(null);               // { engineId, state } while a pre-warm launch is in flight
  const warmupCancelRef = useRef(null);                       // cancels the warm-up poll loop

  // Form fields
  const [description, setDescription] = useState('A female speaker with a warm, calm voice and clear delivery.');
  const [voiceSeed, setVoiceSeed] = useState(1337);
  const [voiceId, setVoiceId] = useState('af_heart');
  const [refAudioB64, setRefAudioB64] = useState(null);
  const [refAudioName, setRefAudioName] = useState('');
  const [consent, setConsent] = useState(false);
  const [previewText, setPreviewText] = useState(DESIGN_FULL_TEXT);
  const [baseRate, setBaseRate] = useState(1.0);
  const [stability, setStability] = useState(0.5);
  const [firstUtterance, setFirstUtterance] = useState('');

  // Initial load — fetch existing voice + supported engines + the preset gallery
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [exists, dna, engs, presetList] = await Promise.all([
      hasVoice(neumaId),
      getVoiceDNA(neumaId),
      getForgeEngines(),
      getForgePresets(),
    ]);
    setHasExisting(exists);
    setVoice(dna);
    setEngines(engs);
    setPresets(presetList);
    setLoading(false);
  }, [neumaId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Stop the warm-up poll loop on unmount
  useEffect(() => () => warmupCancelRef.current?.(), []);

  // impure — FR-4: fire-and-forget pre-warm the moment a mode card is picked.
  // The launch POST settles when the engine is READY (or refuses), and while
  // it is in flight the panel's stage line rides getEngineStatus polls — the
  // real engine-manager states, never invented labels. A null status is the
  // launch surface's own 404: not a local sidecar, nothing to warm.
  const beginWarmup = (engineId) => {
    warmupCancelRef.current?.();
    let cancelled = false;
    let dwell;
    setWarming({ engineId, state: null });
    const poll = async () => {
      const status = await getEngineStatus(engineId);
      if (cancelled) return;
      if (!status) {
        clearInterval(timer);
        setWarming(null);
        return;
      }
      setWarming({ engineId, state: status.state });
    };
    const timer = setInterval(poll, 2000);
    warmupCancelRef.current = () => { cancelled = true; clearInterval(timer); clearTimeout(dwell); };
    poll();
    // The launch POST settles at READY/refusal — show the terminal state for a
    // short dwell before the panel clears, so the honest end label is actually
    // seen instead of the panel simply vanishing mid-poll.
    prewarmEngine(engineId)
      .catch(() => {})
      .then(async () => {
        if (cancelled) return;
        clearInterval(timer);
        const status = await getEngineStatus(engineId);
        if (cancelled) return;
        if (!status) { setWarming(null); return; }
        setWarming({ engineId, state: status.state });
        dwell = setTimeout(() => { if (!cancelled) setWarming(null); }, 1600);
      });
  };

  const pickMode = async (pickedMode, pickedEngine) => {
    uiSound('activate');
    setError(null);
    try {
      const r = await startForge({ neumaId, witnessWallet, engine: pickedEngine, mode: pickedMode });
      setSessionId(r.sessionId);
      setMode(pickedMode);
      setEngine(pickedEngine);
      setStage('offering');
      // DESIGN card: a design ceremony opens on the short probe text so the
      // first listen lands fast; the operator edits or loads the full line.
      if (pickedMode === 'design') setPreviewText(DESIGN_PROBE_TEXT);
      beginWarmup(pickedEngine);
    } catch (err) {
      setError(err.message);
    }
  };

  const submitOfferingForm = async () => {
    uiSound('activate');
    setError(null);
    try {
      const offering = mode === 'clone'
        ? { refAudioB64, consent, refText: '' }
        : mode === 'design'
        ? { description, voiceSeed }
        : { voiceId };
      const r = await submitOffering(sessionId, offering);
      setCandidate(r.candidateDNA);
      setStage('iterate');
    } catch (err) {
      setError(err.message);
    }
  };

  const applyAdjust = async () => {
    uiSound('activate');
    setError(null);
    try {
      const patch = { style: { baseRate, stability } };
      if (mode === 'design') patch.engine = { description, voiceSeed: Number(voiceSeed) };
      else if (mode === 'preset') patch.engine = { voiceId };
      const r = await adjustCandidate(sessionId, patch);
      setCandidate(r.candidateDNA);
    } catch (err) {
      setError(err.message);
    }
  };

  const seal = async () => {
    uiSound('activate');
    setSealing(true);
    setError(null);
    try {
      // Seal sends no seed bytes — the clone seed already traveled once, as
      // the consent-gated offering; the server persists that validated audio.
      await sealVoice(sessionId, {
        firstUtterance: firstUtterance || undefined,
      });
      setStage('sealed');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSealing(false);
    }
  };

  // impure — REROLL chip: bump the seed (wraps at the sidecar's contract
  // bound) so the operator re-rolls the voice honestly; the current seed stays
  // visible in the field next to the chip. Determinism is proven — bitwise-
  // identical renders on the qwen3 sidecar (Wave-3's formal two-render proof).
  const rerollSeed = () => { uiSound('toggle'); setVoiceSeed((s) => bumpDesignSeed(s)); };

  // impure — swap the preview text between the short probe and the full line
  const toggleProbeText = () => {
    uiSound('toggle');
    setPreviewText((t) => (t === DESIGN_PROBE_TEXT ? DESIGN_FULL_TEXT : DESIGN_PROBE_TEXT));
  };

  // File → normalized seed for clone mode. Whatever the operator picked
  // (MP3/WAV/OGG…) is decoded in-browser and re-rendered as mono 24 kHz
  // 16-bit WAV — the engines never see a compressed container.
  const onFilePicked = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uiSound('activate');
    setError(null);
    try {
      const { b64 } = await normalizeSeedAudio(file);
      setRefAudioName(file.name);
      setRefAudioB64(b64);
    } catch {
      setRefAudioName('');
      setRefAudioB64(null);
      setError(`Could not read "${file.name}" as audio — offer a WAV or MP3 recording.`);
    }
  };

  return {
    voice, hasExisting, loading, engines, presets, error, setError,
    mode, setMode, setEngine, sessionId, setSessionId, stage, setStage,
    candidate, setCandidate, sealing, warming, setWarming, warmupCancelRef,
    description, setDescription, voiceSeed, setVoiceSeed, voiceId, setVoiceId,
    refAudioB64, refAudioName, consent, setConsent,
    previewText, setPreviewText, baseRate, setBaseRate, stability, setStability,
    firstUtterance, setFirstUtterance,
    pickMode, submitOfferingForm, applyAdjust, seal,
    rerollSeed, toggleProbeText, onFilePicked,
  };
};
