// portal-voice-handlers.js — the portal's voice frames: the VOX toggle
// (voice:pref), the live voice sitting (voice:mic_* / flush / speech_start /
// cancel), and the forge's audition (voice:audition — voice/voice-audition.js). Extracted from backend/routes/portal-message-handlers.js (ONE VOICE
// WP3) so the dispatcher never grows; case bodies kept, plus the person's side
// of the speech-context ring: while the mic is open, each finalized utterance
// carries the person's own audio into connection.speechContext
// (voice/utterance-capture.js), and the ring is cleared when the mic closes or
// the desk disconnects (closeVoiceSitting).
//
// The sitting lives and dies with its socket (token-expiry law in
// stream-session.js): a reconnect re-auths and re-opens. voice:utterance is
// internal-only (sidecar→bridge) — the client can never send it.
import { createLogger } from './logger.js';
import { cancelIntentSweeps } from './intents/intent-context.js';
import { VoiceStreamSession, canOpenVoiceSession } from './voice/stream-session.js';
import { emptyCapture, withPcm, withSpeechStarted, takeUtterance } from './voice/utterance-capture.js';
import { withSegment } from './voice/speech-context.js';
import { abortAudition, runAudition } from './voice/voice-audition.js';

const log = createLogger('Portal');

/** The frame types this module owns. */
export const VOICE_FRAME_TYPES = Object.freeze(new Set([
  'voice:pref', 'voice:mic_open', 'voice:mic_close', 'voice:mic_pcm',
  'voice:flush', 'voice:speech_start', 'voice:cancel', 'voice:audition',
]));

// impure — the person's side of the ring: the sidecar's frames on their way to
// the desk mark where a line starts and close it with its words.
const noteSpeechFrame = (connection, frame) => {
  if (frame.type === 'voice:speech_started') {
    connection.utteranceCapture = withSpeechStarted(connection.utteranceCapture ?? emptyCapture());
  } else if (frame.type === 'voice:utterance') {
    const { capture, segment } = takeUtterance(connection.utteranceCapture ?? emptyCapture(), frame.text);
    connection.utteranceCapture = capture;
    if (segment) connection.speechContext = withSegment(connection.speechContext, segment);
  }
};

/**
 * impure — end the voice sitting: the sidecar link closes, an audition still
 * speaking is cut, and the speech context (the being's and the person's recent
 * audio) is forgotten. Idempotent; called on mic close and when the socket closes.
 * @param {object} connection
 */
export const closeVoiceSitting = (connection) => {
  if (!connection) return;
  abortAudition(connection);
  if (connection.voiceSession) {
    connection.voiceSession.close();
    connection.voiceSession = null;
  }
  connection.speechContext = null;
  connection.utteranceCapture = null;
};

// impure — voice:mic_open. Fail-closed purpose gate (threat control #1 + #4):
// only a declared conversation sitting may open the mic.
const micOpen = async (connection, message) => {
  const { ws } = connection;
  if (!canOpenVoiceSession(connection.purpose)) {
    ws.send(JSON.stringify({ type: 'voice:error', code: 'purpose_not_conversation', degrade: 'text' }));
    return;
  }
  // WHO ENDS AN UTTERANCE. Under push-to-talk the key does, and the sidecar
  // must be told or its own VAD ends the line at 400 ms of quiet. Absent
  // means the open mic's VAD.
  const holdMode = message.pushToTalk === true;
  if (connection.voiceSession && !connection.voiceSession.closed) {
    connection.voiceSession.setHold(holdMode);
    ws.send(JSON.stringify({ type: 'voice:mic_open', gen: connection.voiceSession.generation }));
    return;
  }
  const session = new VoiceStreamSession({
    send: (frame) => {
      noteSpeechFrame(connection, frame);
      ws.send(JSON.stringify(frame));
    },
    onWedge: () => { connection.voiceSession = null; },
  });
  connection.voiceSession = session;
  connection.utteranceCapture = emptyCapture();
  session.setHold(holdMode); // latched — open() carries it to the sidecar
  try {
    await session.open();
    ws.send(JSON.stringify({ type: 'voice:mic_open', gen: session.generation }));
  } catch (err) {
    // Wedge → text, NEVER cloud (control #7).
    log.warn('voice session open failed — degrading to text', { err: err?.message });
    session.close();
    connection.voiceSession = null;
    ws.send(JSON.stringify({ type: 'voice:error', code: 'stt_unavailable', degrade: 'text' }));
  }
};

/**
 * impure — handle one voice frame for a connection. The caller routes only
 * VOICE_FRAME_TYPES here.
 * @param {object} connection - the portal connection (owns ws)
 * @param {object} message - the parsed client frame
 */
export const handleVoiceFrame = async (connection, message) => {
  const { ws } = connection;
  const session = connection.voiceSession && !connection.voiceSession.closed ? connection.voiceSession : null;
  switch (message.type) {
    case 'voice:pref':
      // The operator's VOX toggle as a wire fact: with voice off the portal
      // skips synthesis entirely. Ack carries the server truth back.
      connection.voiceEnabled = message.enabled !== false;
      if (!connection.voiceEnabled) abortAudition(connection);
      ws.send(JSON.stringify({ type: 'voice:pref', enabled: connection.voiceEnabled }));
      break;
    case 'voice:mic_open':
      await micOpen(connection, message);
      break;
    case 'voice:mic_close':
      closeVoiceSitting(connection);
      ws.send(JSON.stringify({ type: 'voice:mic_close' }));
      break;
    case 'voice:mic_pcm': {
      // Accepted only with an open session OWNED by this connection — else
      // dropped silently (a stray PCM frame is not an error worth a frame).
      if (!session || typeof message.pcm !== 'string' || message.pcm.length === 0) break;
      const pcm = Buffer.from(message.pcm, 'base64');
      session.sendPcm(pcm);
      connection.utteranceCapture = withPcm(connection.utteranceCapture ?? emptyCapture(), pcm);
      break;
    }
    case 'voice:flush':
      // PUSH-TO-TALK release: the utterance is over. Carries no generation:
      // a flush KEEPS what was said.
      session?.flush();
      break;
    case 'voice:speech_start':
      // Local barge-in: the operator started speaking — cut the in-flight
      // turn through the same path as consciousness:interrupt, and bump the
      // sitting's generation so stale TTS/STT output drops on mismatch.
      cancelIntentSweeps(connection);
      abortAudition(connection);
      if (connection.activeTurn) connection.activeTurn.abort();
      else if (connection.turnPromise) connection.interruptRequested = true;
      session?.cancel(message.gen);
      break;
    case 'voice:cancel':
      // Generation-tagged cancel without a speech event. Monotonic inside the session.
      session?.cancel(message.gen);
      break;
    case 'voice:audition':
      // The forge's HEAR step: the being speaks in the pinned voice through
      // the chat's speech path, to this socket only, never into history.
      await runAudition(connection, message);
      break;
    default:
      break;
  }
};
