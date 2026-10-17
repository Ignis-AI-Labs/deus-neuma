// use-voice-enabled.js — the neuma's spoken voice, as React state.
//
// impure hook: owns the operator's VOX preference (persisted), the live
// sink application (muting cuts audio already playing), and the voice:pref
// wire fact (synthesis stops at the source, not at the speaker). Side
// effects stay in the effect so StrictMode's double-invoke can't double-fire
// them. Extracted from use-consciousness-stream.js (size law) — behavior
// unchanged; the VoxChip reads the same state through the context.

import { useCallback, useEffect, useRef, useState } from 'react';
import { readVoicePref, writeVoicePref } from './stream-preferences.js';

/**
 * @param {object} args
 * @param {object} args.wsService - the portal this stream speaks through
 * @param {object} args.sinkRef - ref holding the voice sink (lazy-created)
 * @returns {{ voiceEnabled: boolean, setVoiceEnabled: Function, toggleVoice: Function, voiceEnabledRef: object }}
 */
export const useVoiceEnabled = ({ wsService, sinkRef }) => {
  const [voiceEnabled, setVoiceEnabled] = useState(readVoicePref);
  // Single source of truth: React state (seeded once from localStorage). The
  // ref mirrors it so the stable ensureSink can read the current value without
  // re-reading storage or re-creating on every toggle.
  const voiceEnabledRef = useRef(voiceEnabled);
  voiceEnabledRef.current = voiceEnabled;

  // Mute / unmute the neuma's spoken voice — just flips state; the effect
  // below persists it and applies it to a live sink.
  const toggleVoice = useCallback(() => setVoiceEnabled((prev) => !prev), []);

  useEffect(() => {
    writeVoicePref(voiceEnabled);
    // Apply to a live sink only — one not yet created will pick up the current
    // value (via the ref) when its first frame arrives.
    const sink = sinkRef.current;
    if (sink) {
      sink.setEnabled(voiceEnabled);
      if (voiceEnabled) sink.resume();
    }
    // Tell the portal too: synthesis stops at the source, not at the speaker.
    wsService.send('voice:pref', { enabled: voiceEnabled });
  }, [voiceEnabled, wsService, sinkRef]);

  return { voiceEnabled, setVoiceEnabled, toggleVoice, voiceEnabledRef };
};
