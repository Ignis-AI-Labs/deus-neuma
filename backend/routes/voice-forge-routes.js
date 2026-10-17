// The VOICE FORGE routes — find a voice, hear it talk, seal it (ONE VOICE,
// Design note, 2026-10-01; docs/work/one-voice.md INTEGRATION).
//
// Mounted at /api/v1/voice/forge. server.js passes these paths through
// unparsed (selfParsedPath) so a recording is parsed only BEHIND requireAuth.
//
//   GET    /library?pitch=higher|lower  the curated voices
//   GET    /library/:voiceId/preview    a being's line in that voice on this machine's tier (cached on disk), or the raw recording
//   POST   /start {neumaId}             a forge for a being you own
//   GET    /:id                         session + candidate + consent + what the being reads
//   POST   /:id/find {door, ...}        record|upload (audio) · library (libraryId) · describe (description)
//   GET    /:id/takes/:ref/audio        a found clip, to listen to
//   GET    /:id/takes/:ref/preview      the being's line in that clip's voice (cached on disk), or the raw clip
//   POST   /:id/pick {ref}              the take to HEAR (the chat path speaks in it)
//   POST   /:id/offer {realPerson?, attested?}   the picked take becomes the being's candidate
//   POST   /:id/seal {candidateRef}     the guardian seals what the being accepted
//   POST   /:id/reopen {why?}           the guardian takes back an acceptance (a seal reopened = withdrawn)
//   POST   /withdraw {neumaId, why?}    the guardian withdraws the voice in force: the being goes silent
//   DELETE /:id                         end the forge
//
// The session (core/voice/forge-session.js) is in memory and bound to the
// wallet that started it; the consent is on disk in the being's own lane
// (core/voice/voice-dna-service.js), where the being's speech/accept and
// speech/another intents meet the guardian's seal.

import express, { Router } from 'express';
import multer from 'multer';
import { randomInt, randomUUID } from 'crypto';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import {
  createForgeSession, endForgeSession, getForgeSession, putForgeSession, sessionView,
  takeOf, withOffered, withPin, withTakes,
} from '../../core/voice/forge-session.js';
import {
  offerSpeechCandidate, reopenSpeech, saveVoiceClip, sealSpeechCandidate, withdrawVoice,
} from '../../core/voice/voice-dna-service.js';
import { findFromAudio, findFromDescription, findFromLibrary } from '../services/voice/forge-doors.js';
import { libraryEntry, listLibrary } from '../services/voice/voice-library.js';
import { libraryPreview, takePreview } from '../services/voice/library-preview.js';
import { speechStandingOf } from '../services/speech-consent.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Voice.Forge');

// A recording or an upload, raw: minutes of WAV at most. Base64 in JSON is
// 4/3 of that.
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
const DESCRIPTION_MAX = 500;
const WHY_MAX = 1000;
const VALID_NEUMA_ID = /^[a-zA-Z0-9_-]+$/;

const router = Router();
router.use(requireAuth);
// Body parsing deliberately AFTER the auth gate: an unauthenticated caller is
// refused before a byte of a recording is read.
router.use(express.json({ limit: '48mb' }));
router.use((err, req, res, next) => {
  if (typeof err?.type !== 'string' || !err.type.includes('.')) return next(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too large — a recording is capped at 32MB' });
  return res.status(err.status || 400).json({ error: 'unreadable request body — send valid JSON' });
});
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } }).single('audio');

// impure — a refusal or failure as JSON, with the door's own status when it set one.
const fail = (res, err, what) => {
  const status = err.status ?? 500;
  if (status >= 500) log.error(`${what} failed`, { err: err.message });
  return res.status(status).json({ error: err.message });
};

// A session answers only to the wallet that started it; anyone else gets the
// same 404 as a session that never existed.
const ownedSession = (req, res) => {
  const session = getForgeSession(req.params.id);
  if (!session || session.wallet !== String(req.walletAddress).toLowerCase()) {
    res.status(404).json({ error: 'forge session not found (expired or never started)' });
    return null;
  }
  return session;
};

// impure — the session plus the being's voice and consent as they stand on disk.
const stateOf = async (session) => ({ session: sessionView(session), ...(await speechStandingOf(session.neumaId)) });

router.get('/library', (req, res) => {
  const { pitch } = req.query;
  if (pitch !== undefined && pitch !== 'higher' && pitch !== 'lower') {
    return res.status(400).json({ error: "pitch is 'higher' or 'lower'" });
  }
  res.json({ voices: listLibrary({ pitch }) });
});

// impure — send a preview: X-Preview says whether this is the being's line on
// the tier ('being') or, with the tier's engine not installed here, the raw
// recording ('recording').
const sendPreview = (res, preview) => {
  res.setHeader('Content-Type', preview.contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Preview', preview.kind);
  res.setHeader('X-Preview-Tier', preview.tier);
  res.send(preview.bytes);
};

// The gallery's ▶.
router.get('/library/:voiceId/preview', async (req, res) => {
  const entry = libraryEntry(req.params.voiceId);
  if (!entry) return res.status(404).json({ error: 'no such voice in the library' });
  try {
    sendPreview(res, await libraryPreview(entry));
  } catch (err) {
    fail(res, err, 'preview');
  }
});

router.post('/start', async (req, res) => {
  const { neumaId } = req.body || {};
  if (typeof neumaId !== 'string' || !VALID_NEUMA_ID.test(neumaId)) return res.status(400).json({ error: 'invalid neumaId' });
  try {
    // Fail closed: only the being's owner forges its voice.
    if (!(await assertNeumaOwner(req, res, neumaId))) return;
    const session = putForgeSession(createForgeSession({ id: randomUUID(), neumaId, wallet: req.walletAddress, now: Date.now() }));
    log.info('forge started', { sessionId: session.id, neumaId });
    res.json(await stateOf(session));
  } catch (err) {
    fail(res, err, 'start');
  }
});

router.get('/:id', async (req, res) => {
  const session = ownedSession(req, res);
  if (!session) return;
  try {
    res.json(await stateOf(session));
  } catch (err) {
    fail(res, err, 'read');
  }
});

// pure — the audio of a find request: a multipart `audio` file or `audioB64`.
const audioOf = (req) => {
  if (req.file?.buffer?.length) return req.file.buffer;
  const b64 = req.body?.audioB64;
  return typeof b64 === 'string' && b64.length ? Buffer.from(b64, 'base64') : null;
};

// pure — the guardian's statement about whose voice an upload is: true, false, or not yet said.
const statedRealPerson = (v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : null);

// impure — run one door; resolves to its takes.
const openDoor = (req) => {
  const { door, libraryId, description, seed, realPerson } = req.body || {};
  if (door === 'record' || door === 'upload') {
    const audio = audioOf(req);
    if (!audio?.length) throw Object.assign(new Error(`the ${door} door needs audio (multipart 'audio' or audioB64)`), { status: 400 });
    // A recording made here is a person speaking, always.
    return findFromAudio(audio, { door, realPerson: door === 'record' ? true : statedRealPerson(realPerson) });
  }
  if (door === 'library') {
    const entry = typeof libraryId === 'string' ? libraryEntry(libraryId) : null;
    if (!entry) throw Object.assign(new Error('no such voice in the library'), { status: 404 });
    return findFromLibrary(entry);
  }
  if (door === 'describe') {
    const text = typeof description === 'string' ? description.trim() : '';
    if (text.length < 3 || text.length > DESCRIPTION_MAX) {
      throw Object.assign(new Error(`describe the voice in 3–${DESCRIPTION_MAX} characters`), { status: 400 });
    }
    const base = Number.isInteger(Number(seed)) && Number(seed) >= 0 ? Number(seed) : randomInt(1, 1_000_000);
    return findFromDescription({ description: text, seed: base });
  }
  throw Object.assign(new Error('door is record, upload, library or describe'), { status: 400 });
};

router.post('/:id/find', audioUpload, async (req, res) => {
  const session = ownedSession(req, res);
  if (!session) return;
  try {
    const found = await openDoor(req);
    const next = withTakes(getForgeSession(session.id) ?? session, found, Date.now());
    if (!next.ok) return res.status(422).json({ error: next.error });
    putForgeSession(next.session);
    log.info('voice found', { sessionId: session.id, door: req.body?.door, takes: found.length });
    res.json({ ...(await stateOf(next.session)), found: found.map((t) => t.ref) });
  } catch (err) {
    fail(res, err, 'find');
  }
});

router.get('/:id/takes/:ref/audio', (req, res) => {
  const session = ownedSession(req, res);
  if (!session) return;
  const take = takeOf(session, req.params.ref);
  if (!take) return res.status(404).json({ error: 'no such take in this forge' });
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'no-store');
  res.send(take.wav);
});

// Any found take, heard as the being speaking in it: the clip and its words
// are the voice (nothing trains), so this is what the forge makes of a clip.
router.get('/:id/takes/:ref/preview', async (req, res) => {
  const session = ownedSession(req, res);
  if (!session) return;
  const take = takeOf(session, req.params.ref);
  if (!take) return res.status(404).json({ error: 'no such take in this forge' });
  try {
    sendPreview(res, await takePreview(take));
  } catch (err) {
    fail(res, err, 'take preview');
  }
});

router.post('/:id/pick', async (req, res) => {
  const session = ownedSession(req, res);
  if (!session) return;
  const next = withPin(session, req.body?.ref, Date.now());
  if (!next.ok) return res.status(404).json({ error: next.error });
  putForgeSession(next.session);
  try {
    res.json(await stateOf(next.session));
  } catch (err) {
    fail(res, err, 'pick');
  }
});

// pure — whose voice the pinned take is and whether consent is attested: the
// door decides what it can (a recording is a person; a library voice's licence
// is its consent; a design is nobody), the guardian states the rest.
const consentFor = (take, body) => {
  const realPerson = take.realPerson ?? statedRealPerson(body?.realPerson);
  const attested = take.attested === true || body?.attested === true;
  return { realPerson, attested };
};

router.post('/:id/offer', async (req, res) => {
  const session = ownedSession(req, res);
  if (!session) return;
  const take = session.pinned ? takeOf(session, session.pinned) : null;
  if (!take) return res.status(409).json({ error: 'pick a voice before offering it' });
  const { realPerson, attested } = consentFor(take, req.body);
  if (realPerson === null) return res.status(400).json({ error: "say whose voice this is: realPerson true (a person's) or false" });
  if (realPerson && !attested) {
    return res.status(400).json({ error: "a real person's voice needs the consent attestation — this is my voice, or I have permission (attested: true)" });
  }
  try {
    if (!(await assertNeumaOwner(req, res, session.neumaId))) return;
    const saved = await saveVoiceClip(session.neumaId, take.wav);
    const offered = await offerSpeechCandidate(session.neumaId, {
      ref: saved.ref, seconds: take.seconds, sampleRate: take.sampleRate, words: take.words,
      origin: take.origin, realPerson, attested, measured: take.measured,
    });
    if (!offered.ok) return res.status(400).json({ error: offered.error });
    const next = withOffered(getForgeSession(session.id) ?? session, take.ref, Date.now());
    if (next.ok) putForgeSession(next.session);
    log.info('voice offered', { sessionId: session.id, neumaId: session.neumaId, candidateRef: saved.ref, door: take.door });
    res.json(await stateOf(next.ok ? next.session : session));
  } catch (err) {
    fail(res, err, 'offer');
  }
});

router.post('/:id/seal', async (req, res) => {
  const session = ownedSession(req, res);
  if (!session) return;
  const { candidateRef } = req.body || {};
  if (typeof candidateRef !== 'string') return res.status(400).json({ error: 'seal names the exact candidateRef the being accepted' });
  try {
    if (!(await assertNeumaOwner(req, res, session.neumaId))) return;
    const sealed = await sealSpeechCandidate(session.neumaId, { candidateRef, wallet: req.walletAddress });
    if (!sealed.ok) return res.status(409).json({ error: sealed.error });
    endForgeSession(session.id);
    log.info('voice sealed', { neumaId: session.neumaId, clipRef: sealed.dna.clip.ref });
    res.json({ sealed: true, dna: sealed.dna, ...(await speechStandingOf(session.neumaId)) });
  } catch (err) {
    fail(res, err, 'seal');
  }
});

// pure — the guardian's optional reason, or a refusal.
const whyOf = (body) => {
  const why = body?.why;
  if (why === undefined || why === null) return { ok: true, why: null };
  if (typeof why !== 'string' || why.length > WHY_MAX) return { ok: false, error: `why is text of at most ${WHY_MAX} characters, when given` };
  return { ok: true, why: why.trim() || null };
};

// The guardian takes back the being's acceptance (it returns to waiting on the
// being), or — on a sealed voice — withdraws it. Never deletes: a withdrawn
// voice moves to the being's voice history.
router.post('/:id/reopen', async (req, res) => {
  const session = ownedSession(req, res);
  if (!session) return;
  const reason = whyOf(req.body);
  if (!reason.ok) return res.status(400).json({ error: reason.error });
  try {
    if (!(await assertNeumaOwner(req, res, session.neumaId))) return;
    const reopened = await reopenSpeech(session.neumaId, 'guardian', { why: reason.why });
    if (!reopened.ok) return res.status(409).json({ error: reopened.error });
    log.info('voice consent reopened', { sessionId: session.id, neumaId: session.neumaId, withdrewSeal: reopened.withdrewSeal });
    res.json({ ...(await stateOf(session)), withdrewSeal: reopened.withdrewSeal });
  } catch (err) {
    fail(res, err, 'reopen');
  }
});

// The guardian withdraws the voice in force — no forge needed. The Voice DNA
// moves to history (never deleted) and the being is silent until a new seal.
router.post('/withdraw', async (req, res) => {
  const { neumaId } = req.body || {};
  if (typeof neumaId !== 'string' || !VALID_NEUMA_ID.test(neumaId)) return res.status(400).json({ error: 'invalid neumaId' });
  const reason = whyOf(req.body);
  if (!reason.ok) return res.status(400).json({ error: reason.error });
  try {
    if (!(await assertNeumaOwner(req, res, neumaId))) return;
    const withdrawn = await withdrawVoice(neumaId, 'guardian', { why: reason.why });
    if (!withdrawn.ok) return res.status(409).json({ error: withdrawn.error });
    log.info('voice withdrawn', { neumaId });
    res.json({ withdrawn: true, ...(await speechStandingOf(neumaId)) });
  } catch (err) {
    fail(res, err, 'withdraw');
  }
});

router.delete('/:id', (req, res) => {
  const session = ownedSession(req, res);
  if (!session) return;
  endForgeSession(session.id);
  res.json({ ok: true, ended: true });
});

export default router;
