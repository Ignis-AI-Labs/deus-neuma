/**
 * Dream journal routes — the witness's own dreams, recorded on the phone and
 * kept on the desk (services/user-dreams.js). Auth-gated, keyed to the wallet;
 * a paired phone reaches these as any client does (docs/security/remote-surface.md).
 *
 *   POST   /?id=&recordedAt=&durationMs=   raw audio body → the entry (201, or 200 if already kept)
 *   GET    /                               every entry, newest first
 *   GET    /:id/audio                      the recording (Range-capable)
 *   POST   /:id/transcribe                 start the words (202); the entry says when they land
 *   DELETE /:id
 */
import express from 'express';
import fs from 'fs/promises';
import { requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import {
  saveDream, listDreams, readDream, dreamAudio, setTranscript, deleteDream, isDreamAudio, isDreamId,
} from '../services/user-dreams.js';
import { transcribeRecording } from '../services/voice/whisper-transcribe.js';

const router = express.Router();
const log = createLogger('Dreams');

// Opus at a phone's rate is ~2.5 MB for ten minutes; this bounds an hour of the worst codec.
const MAX_AUDIO_BYTES = 80 * 1024 * 1024;
// A transcription still "working" this long after it began died with the process that ran it.
const STALE_WORK_MS = 15 * 60 * 1000;

/**
 * May a transcription start now? Not while one is live; a dead one may be retried. Pure.
 * @param {{ state: string, at: string | null }} transcript
 * @param {number} now
 * @returns {boolean}
 */
export const mayTranscribe = (transcript, now) => transcript?.state !== 'working'
  || now - Date.parse(transcript.at ?? 0) > STALE_WORK_MS;

router.use(requireAuth);

const idOf = (req, res) => {
  if (isDreamId(req.params.id)) return req.params.id;
  res.status(400).json({ error: 'Not a dream id' });
  return null;
};

router.post('/', express.raw({ type: (req) => isDreamAudio(req.headers['content-type']), limit: MAX_AUDIO_BYTES }), async (req, res) => {
  const { id, recordedAt, durationMs } = req.query;
  if (!isDreamId(id)) return res.status(400).json({ error: 'A dream needs an id from the phone that recorded it' });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'Send the recording as the body, with its audio type' });
  }
  try {
    const { entry, created } = await saveDream(req.walletAddress, {
      id, audio: req.body, mime: req.headers['content-type'], recordedAt, durationMs: Number(durationMs),
    });
    res.status(created ? 201 : 200).json({ dream: entry });
  } catch (error) {
    log.error('Dream not kept', { error: error.message });
    res.status(500).json({ error: 'Could not keep the dream' });
  }
});

router.get('/', async (req, res) => {
  try {
    res.json({ dreams: await listDreams(req.walletAddress) });
  } catch (error) {
    log.error('Dreams not read', { error: error.message });
    res.status(500).json({ error: 'Could not read the dream journal' });
  }
});

router.get('/:id/audio', async (req, res) => {
  const id = idOf(req, res);
  if (!id) return;
  const audio = await dreamAudio(req.walletAddress, id).catch(() => null);
  if (!audio) return res.status(404).json({ error: 'No such dream' });
  res.set('Cache-Control', 'private, no-store');
  res.type(audio.mime).sendFile(audio.path);
});

// impure — decode in the background; the entry carries the outcome.
const runTranscription = async (wallet, id) => {
  try {
    const audio = await dreamAudio(wallet, id);
    if (!audio) return;
    const { text } = await transcribeRecording(await fs.readFile(audio.path), audio.mime);
    await setTranscript(wallet, id, { state: 'done', text });
  } catch (error) {
    log.warn('Dream not transcribed', { error: error.message });
    await setTranscript(wallet, id, { state: 'failed', error: error.message }).catch(() => {});
  }
};

router.post('/:id/transcribe', async (req, res) => {
  const id = idOf(req, res);
  if (!id) return;
  try {
    const entry = await readDream(req.walletAddress, id);
    if (!entry) return res.status(404).json({ error: 'No such dream' });
    if (!mayTranscribe(entry.transcript, Date.now())) return res.status(202).json({ dream: entry });
    const working = await setTranscript(req.walletAddress, id, { state: 'working' });
    runTranscription(req.walletAddress, id);
    res.status(202).json({ dream: working });
  } catch (error) {
    log.error('Transcription not started', { error: error.message });
    res.status(500).json({ error: 'Could not start the transcription' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = idOf(req, res);
  if (!id) return;
  try {
    if (!(await deleteDream(req.walletAddress, id))) return res.status(404).json({ error: 'No such dream' });
    res.status(204).end();
  } catch (error) {
    log.error('Dream not deleted', { error: error.message });
    res.status(500).json({ error: 'Could not delete the dream' });
  }
});

export default router;
