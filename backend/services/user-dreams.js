/**
 * The witness's dream journal — their own record, kept per wallet in the user
 * realm beside their chat logs. Never a being's: a being reads a dream only
 * when the witness shares it.
 *
 * Layout: <realm>/<wallet>/dreams/<id>.json (the entry) + <id>.<ext> (the voice).
 * The phone names the id when it starts recording, so a dream sent twice (a
 * link dropped before the answer came back) is the same dream, never a copy.
 * Dreams are private even on this machine: the folder is 0700, files 0600.
 * IO isolated and marked.
 */
import fs from 'fs/promises';
import path from 'path';
import { walletDir, writeJsonAtomic } from './user-realm.js';

const ID_RE = /^[a-z0-9][a-z0-9-]{7,63}$/;

// The recorders a phone or desk browser produces, and the file each becomes.
const EXT_OF = Object.freeze({
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
});

/**
 * The bare type of a Content-Type ('audio/webm;codecs=opus' → 'audio/webm'). Pure.
 * @param {string} contentType
 * @returns {string}
 */
export const bareMime = (contentType) => String(contentType ?? '').split(';')[0].trim().toLowerCase();

/** @param {string} contentType @returns {boolean} Pure. */
export const isDreamAudio = (contentType) => Object.hasOwn(EXT_OF, bareMime(contentType));

/** @param {unknown} id @returns {boolean} Pure. */
export const isDreamId = (id) => typeof id === 'string' && ID_RE.test(id);

const dreamsDir = (wallet) => path.join(walletDir(wallet), 'dreams');

const entryPath = (wallet, id) => {
  if (!isDreamId(id)) throw new Error('Invalid dream id');
  return path.join(dreamsDir(wallet), `${id}.json`);
};

const audioPath = (wallet, id, mime) => path.join(dreamsDir(wallet), `${id}.${EXT_OF[bareMime(mime)]}`);

// impure — the entry, or null when there is none.
export const readDream = async (wallet, id) => {
  try {
    return JSON.parse(await fs.readFile(entryPath(wallet, id), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

/**
 * Keep a recorded dream. The voice lands before the entry that names it, so a
 * crash between the two leaves an orphan file, never an entry without its voice.
 * A second save of the same id returns the first, untouched.
 * @param {string} wallet
 * @param {{ id: string, audio: Buffer, mime: string, recordedAt?: string, durationMs?: number }} dream
 * @returns {Promise<{ entry: object, created: boolean }>}
 */
// impure
export const saveDream = async (wallet, { id, audio, mime, recordedAt, durationMs }) => {
  const existing = await readDream(wallet, id);
  if (existing) return { entry: existing, created: false };
  if (!isDreamAudio(mime)) throw new Error(`Not a recording this journal keeps: ${bareMime(mime) || 'no type'}`);
  if (!Buffer.isBuffer(audio) || audio.length === 0) throw new Error('A dream needs its recording');
  const recorded = Number.isNaN(Date.parse(recordedAt)) ? new Date() : new Date(recordedAt);
  await fs.mkdir(dreamsDir(wallet), { recursive: true, mode: 0o700 });
  await fs.writeFile(audioPath(wallet, id, mime), audio, { mode: 0o600 });
  const entry = {
    id,
    recordedAt: recorded.toISOString(),
    savedAt: new Date().toISOString(),
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : null,
    mime: bareMime(mime),
    bytes: audio.length,
    transcript: { state: 'none', text: '', error: null, at: null },
  };
  await writeJsonAtomic(entryPath(wallet, id), entry);
  await fs.chmod(entryPath(wallet, id), 0o600);
  return { entry, created: true };
};

// impure — every dream, newest first. A half-written or foreign file is skipped.
export const listDreams = async (wallet) => {
  let names;
  try {
    names = await fs.readdir(dreamsDir(wallet));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const ids = names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).filter(isDreamId);
  const entries = await Promise.all(ids.map((id) => readDream(wallet, id).catch(() => null)));
  return entries.filter(Boolean).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
};

/**
 * Where a dream's voice is on disk. impure (reads the entry).
 * @returns {Promise<{ path: string, mime: string } | null>}
 */
export const dreamAudio = async (wallet, id) => {
  const entry = await readDream(wallet, id);
  return entry ? { path: audioPath(wallet, id, entry.mime), mime: entry.mime } : null;
};

/**
 * Record where the words of a dream stand. impure.
 * @param {{ state: 'working'|'done'|'failed', text?: string, error?: string|null }} transcript
 * @returns {Promise<object|null>} the updated entry, or null when the dream is gone
 */
export const setTranscript = async (wallet, id, { state, text = '', error = null }) => {
  const entry = await readDream(wallet, id);
  if (!entry) return null;
  const next = { ...entry, transcript: { state, text, error, at: new Date().toISOString() } };
  await writeJsonAtomic(entryPath(wallet, id), next);
  await fs.chmod(entryPath(wallet, id), 0o600);
  return next;
};

// impure — remove a dream and its voice. Resolves whether there was one.
export const deleteDream = async (wallet, id) => {
  const entry = await readDream(wallet, id);
  if (!entry) return false;
  await fs.rm(audioPath(wallet, id, entry.mime), { force: true });
  await fs.rm(entryPath(wallet, id), { force: true });
  return true;
};
