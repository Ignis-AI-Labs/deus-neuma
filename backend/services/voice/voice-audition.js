/**
 * THE AUDITION — the forge's HEAR step (ONE VOICE, docs/work/one-voice.md
 * INTEGRATION): the guardian asks the being to speak in the voice pinned in
 * its forge, and hears it on this machine's tier through the EXACT chat path
 * — resolveTurnVoice (which answers the pinned take for the forge's guardian
 * only) → createSpeechTurn → synthesize-emit → `voice:audio` frames to the
 * asking socket.
 *
 * Wire (frontend/app/RelinkShell/voice-forge/use-audition.js):
 *   in   voice:audition {sessionId, line?}
 *   out  voice:audio … (the chat's own frames, stamped with an audition turnId)
 *        voice:audition_done {sessionId, interrupted?}
 *        voice:audition_error {sessionId, error}   (plain words)
 *
 * Without `line` the being says a short sample in its own name; with one, that
 * line. An audition is heard, never kept: nothing reaches the being's history
 * or memory, and its words are not posted as a reply. It honours the portal's
 * voice controls — VOX off refuses it and cuts one in flight, a barge-in or
 * an interrupt cuts it, a newer audition replaces it, a closed sitting ends it.
 */
import { randomUUID } from 'crypto';
import { createLogger } from '../logger.js';
import { safeSend } from '../ws-send.js';
import { checkWsRateLimit } from '../rate-limiter.js';
import { getForgeSession } from '../../../core/voice/forge-session.js';
import { createSpeechTurn, resolveTurnVoice } from './speech-turn.js';

const log = createLogger('Voice.Audition');

const AUDITION_LINE_MAX = 500;
const NAME_MAX = 60;
// An audition may be the first speech since boot: the sidecar's launch (a
// cached compile ~12 s, a first-ever one up to ~150 s on csm) rides inside its
// drain. Bounded, so a wedged engine still answers with an error.
const AUDITION_DRAIN_MS = 180_000;
const SESSION_ID = /^[a-zA-Z0-9-]{1,100}$/;

/**
 * The line a being says when the guardian gives it none: a greeting in its own
 * name and a line with some feeling in it. Pure.
 * @param {string|null|undefined} name - the being's name as the portal knows it
 */
const auditionSample = (name) => {
  const own = typeof name === 'string' ? name.trim().slice(0, NAME_MAX) : '';
  const greeting = own ? `Hello, I'm ${own}.` : 'Hello.';
  return `${greeting} This is how I might sound when we talk. `
    + "I hope it feels like mine — it's strange, and a little wonderful, to hear myself say that.";
};

/**
 * The frame's request, or why it is refused. Pure.
 * @param {object} message - the parsed client frame
 * @returns {{ok: true, sessionId: string, line: string|null} | {ok: false, sessionId: string|null, error: string}}
 */
const auditionRequestOf = (message) => {
  const sessionId = typeof message?.sessionId === 'string' && SESSION_ID.test(message.sessionId) ? message.sessionId : null;
  if (!sessionId) return { ok: false, sessionId: null, error: 'the audition names no forge session' };
  const raw = message.line;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    return { ok: false, sessionId, error: 'the line to say must be text' };
  }
  const line = typeof raw === 'string' ? raw.trim() : '';
  if (line.length > AUDITION_LINE_MAX) {
    return { ok: false, sessionId, error: `a line to say is at most ${AUDITION_LINE_MAX} characters` };
  }
  return { ok: true, sessionId, line: line || null };
};

/**
 * impure — cut the audition speaking on this connection, if one is. Idempotent.
 * @param {object} connection
 */
export const abortAudition = (connection) => {
  connection?.audition?.controller.abort();
};

// impure — why this connection may not hear this forge's voice right now, or
// null. The session answers only to the wallet that started it (the same
// not-found the forge routes give a stranger).
const refusalFor = (connection, session) => {
  if (connection.voiceEnabled === false) return 'voice is off — turn VOX on to hear the audition';
  if (!session || session.wallet !== String(connection.walletAddress ?? '').toLowerCase()) {
    return 'that forge session is not open (it expired, ended, or is not yours)';
  }
  if (connection.companion?.neumaId !== session.neumaId) {
    return 'the audition speaks for the being this portal is bound to — bind to it first';
  }
  if (!session.pinned) return 'pick a voice to hear first';
  if (connection.turnPromise) return 'the being is mid-reply — try again when it has finished';
  return null;
};

// pure — the closing frame for an audition that ran, or null when a newer one replaced it.
const closingFrame = ({ sessionId, superseded, aborted, outcome }) => {
  if (superseded) return null;
  if (aborted) return { type: 'voice:audition_done', sessionId, interrupted: true };
  if (outcome.spoken > 0) return { type: 'voice:audition_done', sessionId };
  const error = outcome.error
    ? `the voice could not speak: ${outcome.error}`
    : 'the voice engine did not answer in time';
  return { type: 'voice:audition_error', sessionId, error };
};

/**
 * impure — handle one `voice:audition` frame: refuse it in plain words, or
 * speak the line (or the sample) in the pinned voice and close with
 * done/error. Never writes history or memory.
 * @param {object} connection - the portal connection (ws, walletAddress, companion)
 * @param {object} message - the parsed client frame
 */
export const runAudition = async (connection, message) => {
  const { ws } = connection;
  const fail = (sessionId, error) => safeSend(ws, { type: 'voice:audition_error', sessionId, error });
  const request = auditionRequestOf(message);
  if (!request.ok) return fail(request.sessionId, request.error);
  const { sessionId } = request;
  if (checkWsRateLimit(connection)) return fail(sessionId, 'too many requests — wait a moment, then try again');
  const session = getForgeSession(sessionId);
  const refusal = refusalFor(connection, session);
  if (refusal) return fail(sessionId, refusal);

  const turnVoice = await resolveTurnVoice(session.neumaId, connection);
  if (!turnVoice?.audition || turnVoice.voice.ref !== session.pinned) {
    return fail(sessionId, 'the voice to hear could not be read — pick it again');
  }

  // One audition at a time per portal: a newer one replaces the one speaking.
  abortAudition(connection);
  const controller = new AbortController();
  connection.audition = { controller, sessionId };
  const speech = createSpeechTurn({
    ws,
    companionName: connection.companion?.name || 'unknown',
    turnVoice,
    signal: controller.signal,
    take: { turnId: `audition-${randomUUID()}`, takeIndex: 0 },
    releaseWords: false,
    drainGraceMs: AUDITION_DRAIN_MS,
  });
  try {
    speech.markStart();
    speech.push(request.line ?? auditionSample(connection.companion?.name));
    const outcome = await speech.finish();
    const frame = closingFrame({
      sessionId,
      superseded: connection.audition?.controller !== controller,
      aborted: controller.signal.aborted,
      outcome,
    });
    if (frame?.type === 'voice:audition_error') log.warn('audition failed', { sessionId, error: frame.error });
    if (frame) safeSend(ws, frame);
  } catch (err) {
    log.error('audition crashed', { sessionId, err: err.message });
    fail(sessionId, `the audition failed: ${err.message}`);
  } finally {
    if (connection.audition?.controller === controller) connection.audition = null;
  }
  return undefined;
};
