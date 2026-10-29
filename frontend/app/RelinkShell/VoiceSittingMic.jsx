// VoiceSittingMic — the headless streaming-mic bridge for the VoiceSitting
// shell (SPEECH SYSTEM F-01/F-03 stitch). The shell REPLACES the composer, so
// the mic path cannot live inside StreamInput — it mounts HERE, at the stream
// column's level, for exactly as long as the sitting is immersed
// (purpose=conversation && LIVE armed). Mount arms the open mic; unmount
// tears it down — the hook's honest-mic law sends voice:mic_close itself.

import { useEffect } from 'react';
import { useLiveVoice } from './use-live-voice.js';

/**
 * Hold-to-talk, not open-mic, until the room problem is genuinely solved.
 *
 * Measured, not assumed: whisper transcribes the being's own voice off open
 * speakers cleanly down to −32 dB, and BELOW that it stops transcribing and
 * starts hallucinating ([…]). There is no attenuation that
 * is both quiet enough to be safe and loud enough to hear — so an open mic in
 * a room with speakers is a losing position, and the honest move is to leave
 * it rather than keep tuning constants at it.
 *
 * One flag, one place: flip this to false to get the open-mic lane back whole.
 */
export const PUSH_TO_TALK_DEFAULT = true;

export const VoiceSittingMic = ({ connected, wsService, onSpeechStart, getPlaybackState }) => {
  const { live, state, toggleLive } = useLiveVoice({
    connected,
    purpose: 'conversation',
    wsService,
    onSpeechStart,
    // Echo discipline: `level` raises the VAD's bar so the being cannot
    // barge itself in; `active` shuts the mic pipe so whisper never hears it.
    getPlaybackState,
    // PUSH TO TALK is the default for now (ruling, 2026-08-01). It does not fight
    // echo or silence-hallucination, it removes the conditions for both: the
    // pipe is shut unless a thumb is on the key, and when the being speaks the
    // witness is not holding it. The open-mic path above stays intact behind
    // this flag for when the room problem is properly solved.
    pushToTalk: PUSH_TO_TALK_DEFAULT,
    // Utterances in the stream lane ride the portal's own frames
    // (use-consciousness-stream sends them as ordinary thoughts) — nothing
    // for this bridge to forward.
    onUtterance: () => {},
  });

  // Immersion IS the open mic: while this bridge stands, a mic should be open.
  //
  // This was a mount-ONLY effect calling a TOGGLE, and both halves were
  // fragile. The hook stands the mic down on its own whenever the portal
  // drops (`connected` false) — after which nothing ever armed it again, so a
  // single blip left the sitting looking live with untouched hardware and no
  // way back short of leaving and re-entering. And a toggle re-run for any
  // reason turns the mic OFF, which is the opposite of what a mount means.
  //
  // Driven by the DESIRED state instead: armed whenever the bridge stands and
  // the portal is up. `state === 'error'` is the one standing that must not
  // retry — a refused grant is a decision, not a blip, and hammering it would
  // be a retry loop against the operator.
  useEffect(() => {
    if (!connected || live || state === 'error') return;
    toggleLive();
  }, [connected, live, state, toggleLive]);

  return null;
};
