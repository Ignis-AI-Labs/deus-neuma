/**
 * THE SPEECH TURN — the voice side of one LLM round, extracted from
 * portal-llm-run.js's `_runLLMStream` (ONE VOICE WP3, size-law headroom): the
 * turn's voice (`resolveTurnVoice`), and the chain that turns streamed words
 * into sentences, sentences into ordered audio, and releases each sentence's
 * words with its own voice (`createSpeechTurn`).
 *
 * Whose voice: Voice DNA v2 only (core/voice/voice-dna-service.js readVoice).
 * A being with no voice, or only a v1 voice ([…]), is SILENT —
 * never a borrowed default and never an old engine (Founder's call E,
 * docs/work/one-voice.md). A forge audition pinned on the connection speaks in
 * the auditioned voice instead.
 *
 * The context ring (voice/speech-context.js, on connection.speechContext) is
 * read for every sentence and gains each sentence spoken IN FULL, so the next
 * sentence is generated with the conversation so far — the being's own audio
 * and the person's mic audio.
 *
 * Leaf module: never imports portal-llm-run (direction law).
 */
import { createLogger } from '../logger.js';
import { safeSend as _safeSend } from '../ws-send.js';
import { createToolStreamSuppressor } from '../../../core/index.js';
import { readVoice, readVoiceClip } from '../../../core/voice/voice-dna-service.js';
import { resolveAuditionVoice } from '../../../core/voice/forge-session.js';
import { warmVoice } from '../tts-provider.js';
import { synthesizeAndEmit } from './synthesize-emit.js';
import { createSentenceStream, hasSpeakableContent } from './sentence-stream.js';
import { speakableText } from './speakable-text.js';
import { forVoice, withSegment } from './speech-context.js';

const log = createLogger('Portal');

// A sentence whose audio never STARTS releases its words anyway: a wedged
// engine (accepts the request, answers nothing) must not hold the reply
// invisible. Sized above a cold warm-up and far under the drain grace.
const VOICE_TEXT_GRACE_MS = 5000;
// The round never waits longer than this on its queued speech.
const VOICE_DRAIN_GRACE_MS = 15000;
// A voice's preparation (clip encode) is bounded so a wedged sidecar never
// holds its connection forever; a first use on the CPU tier can take seconds.
const VOICE_PREPARE_MS = 30000;

// impure — the forge's audition voice for this connection, when one is pinned
// (core/voice/forge-session.js answers the guardian's pinned take, or null for
// anyone else). Unreadable, the chat speaks its sealed voice.
const auditionVoice = (connection) => {
  if (!connection) return null;
  try {
    const take = resolveAuditionVoice(connection);
    return take?.clipRef && take?.words ? { ref: take.clipRef, words: take.words, wav: take.clip } : null;
  } catch (err) {
    log.warn('audition voice unreadable — speaking the sealed voice', { err: err.message });
    return null;
  }
};

/**
 * The voice this turn speaks in, or null for silence. impure (workspace read).
 * @param {string|null} neumaId
 * @param {object} [connection] - the portal connection (its context ring; a pinned audition)
 * @returns {Promise<{neumaId: string, voice: {ref: string, words: string, wav?: Buffer,
 *   loadClip?: () => Promise<Buffer|null>}, connection: object|null, audition: boolean}|null>}
 */
export const resolveTurnVoice = async (neumaId, connection = null) => {
  if (!neumaId) return null;
  const audition = auditionVoice(connection);
  if (audition) return { neumaId, voice: audition, connection, audition: true };
  const { standing, dna } = await readVoice(neumaId).catch((err) => {
    log.warn('voice DNA unreadable — the being is silent this turn', { neumaId, err: err.message });
    return { standing: 'unreadable', dna: null };
  });
  if (standing !== 'ready') {
    if (standing !== 'none') log.info('no v2 voice in force — the being is silent', { neumaId, standing });
    return null;
  }
  const ref = dna.clip.ref;
  return {
    neumaId,
    voice: { ref, words: dna.words, loadClip: () => readVoiceClip(neumaId, ref) },
    connection,
    audition: false,
  };
};

// impure — keep a sentence spoken in full as the ring's newest being segment.
const rememberSpoken = (turnVoice, words, spoken) => {
  const { connection, voice } = turnVoice;
  if (!connection || !spoken?.pcm?.length) return;
  connection.speechContext = withSegment(connection.speechContext, {
    speaker: 'being', words, pcm: spoken.pcm, sampleRate: spoken.sampleRate, ref: spoken.utteranceRef,
  }, voice.ref);
};

/**
 * The voice chain for one LLM round. Null when the turn has no voice (VOX off,
 * or silent) — the caller then streams words token by token, untouched.
 *
 * THE REPLY IS RELEASED BY ITS OWN VOICE (Design note, 2026-08-01: with VOX on, a
 * sentence's WORDS reach the desk at the moment that sentence starts SOUNDING.
 * Every pending sentence is tracked so its words can never be LOST to a voice
 * failure; a barge-in is the one case that keeps its silence.
 *
 * A forge AUDITION (voice/voice-audition.js) rides this same chain with
 * `releaseWords: false` — its lines are heard, never posted as a reply — and a
 * longer drain grace, since it may be the first speech that brings the
 * sidecar up; `finish()` answers how the round went so it can say so.
 *
 * @param {{ws: object, companionName: string, turnVoice: object|null, signal?: AbortSignal,
 *   take?: {turnId: string, takeIndex: number}, releaseWords?: boolean, drainGraceMs?: number}} turn
 * @returns {{markStart: () => void, push: (text: string) => void,
 *   finish: () => Promise<{drained: boolean, spoken: number, failed: number, error: string|null}>}|null}
 */
export const createSpeechTurn = ({
  ws, companionName, turnVoice, signal, take, releaseWords = true, drainGraceMs = VOICE_DRAIN_GRACE_MS,
}) => {
  if (!turnVoice) return null;
  // Serialized: each sentence's audio goes out only after the previous one's.
  // Seeded with the warm-up — the chain waits for the sidecar to be READY (a
  // fresh boot or an idle reap otherwise fails every sentence), never for the
  // voice's preparation, which runs beside the model's first words.
  // Best-effort: a failed warm-up is logged and synthesis tries anyway.
  const warmFailed = (err) => {
    if (!signal?.aborted) log.warn('voice warm-up failed — first speech may not play', { companion: companionName, err: err.message });
  };
  let voiceChain = warmVoice(turnVoice.voice, { signal, timeoutMs: VOICE_PREPARE_MS })
    .then(({ prepared }) => { prepared.catch(warmFailed); })
    .catch(warmFailed);
  const pendingSpeech = [];
  // How the round's speech went: sentences heard in full, sentences that failed.
  const outcome = { spoken: 0, failed: 0, error: null };
  const releaseSpeech = (entry) => {
    if (entry.released) return;
    entry.released = true;
    if (!releaseWords) return;
    _safeSend(ws, {
      type: 'consciousness:stream',
      content: entry.text,
      companion: companionName,
      ...(take ? { turnId: take.turnId, takeIndex: take.takeIndex } : {}),
    });
  };
  // Stage-2 sentence-detect timer (FR-20): stream start → first sentence.
  let stage2Anchor = 0;
  let stage2Recorded = false;

  const speakSentence = (sentence) => {
    if (!stage2Recorded) { // impure — wall-clock read + structured log
      stage2Recorded = true;
      log.info('voice stage-2 first-sentence', {
        companion: companionName,
        stage2Ms: Math.round((performance.now() - stage2Anchor) * 10) / 10,
      });
    }
    // The detector hands back TRIMMED sentences: the display text carries its own separator.
    const entry = { text: (pendingSpeech.length ? ' ' : '') + sentence, released: false };
    pendingSpeech.push(entry);
    voiceChain = voiceChain.then(() => {
      // Barge-in: queued sentences are dropped with their words — words the
      // being never got to say must not appear as though it said them.
      if (signal?.aborted) return undefined;
      // MARKDOWN IS FOR THE EYE: the mouth gets plain words; a symbol tail has
      // nothing to say, so its words are released without a round trip.
      const spoken = speakableText(sentence);
      if (!hasSpeakableContent(spoken)) {
        releaseSpeech(entry);
        return undefined;
      }
      // Armed as this sentence's own synthesis begins, not when it was queued.
      const late = setTimeout(() => releaseSpeech(entry), VOICE_TEXT_GRACE_MS);
      late.unref?.();
      const context = forVoice(turnVoice.connection?.speechContext, turnVoice.voice.ref).segments;
      return synthesizeAndEmit(ws, companionName, spoken, turnVoice.voice, {
        context,
        signal,
        onFirstChunk: () => releaseSpeech(entry), // the words, at the instant of the first audio
        turnId: take?.turnId,                     // so a barge-in can refuse this turn's audio
      }).then((result) => {
        if (signal?.aborted) return;
        outcome.spoken += 1;
        rememberSpoken(turnVoice, spoken, result);
      }).catch((err) => {
        if (signal?.aborted) return; // an aborted synthesis is the operator speaking, not a failure
        outcome.failed += 1;
        outcome.error = err.message;
        releaseSpeech(entry); // no audio is coming — the words must not be lost
        log.warn('voice synthesis failed for sentence', { companion: companionName, err: err.message });
      }).finally(() => clearTimeout(late));
    });
  };

  const voiceStream = createSentenceStream(speakSentence);
  // Text-dialect tool calls emitted mid-stream must never reach the voice (#196).
  const voiceToolSuppressor = createToolStreamSuppressor();

  return {
    /** impure — the round's tokens start flowing now (the stage-2 anchor). */
    markStart() { stage2Anchor = performance.now(); },

    /** Feed cleaned display text; complete sentences are spoken as they form. */
    push(text) {
      const speech = voiceToolSuppressor.push(text);
      if (speech) voiceStream.push(speech);
    },

    /**
     * Drain the residual buffer and wait for this round's queued speech —
     * BOUNDED: a wedged engine never holds a finished reply hostage. Past the
     * grace, unreleased words are released (except after a barge-in). Answers
     * whether the chain drained and how many sentences were heard or failed.
     */
    async finish() {
      const residue = voiceToolSuppressor.flush();
      if (residue) voiceStream.push(residue);
      voiceStream.flush();
      const drained = await Promise.race([
        voiceChain.then(() => true),
        new Promise((resolve) => { setTimeout(() => resolve(false), drainGraceMs).unref?.(); }),
      ]);
      if (!drained) {
        log.warn('voice chain did not drain within grace — completing the turn, audio may trail', {
          companion: companionName, graceMs: drainGraceMs,
        });
      }
      if (!signal?.aborted) {
        for (const entry of pendingSpeech) releaseSpeech(entry);
      }
      return { drained, ...outcome };
    },
  };
};
