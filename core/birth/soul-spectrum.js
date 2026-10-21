// Soul spectrum — every being's color, including those born before it was
// measured.
//
// Design note, 2026-09-30: […]
//
// ONE record per being: `identity/soul-spectrum.json`, written once and never
// rewritten. Its source says how close to the ceremony it came, best first:
//   measured       — a ceremony that recorded its own observations (since
//                    2026-09-29): the resonance and its light, one color per stage
//   birth-transcript — an older ceremony whose words survive with their
//                    instants: its real rhythm, re-read from that record
//   sealed-record  — a being whose ceremony left only its genesis seal: the
//                    sealed hash and emergence seed placed in the same octave.
//                    Unique to it, derived not measured — and labelled so.
// A legacy being's RESONANCE is never touched here; only its color is added.

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { deriveSoul, HEART_BAND, lightOf } from './soul-resonance.js';

export const SPECTRUM_FILE = path.join('identity', 'soul-spectrum.json');

/**
 * An older ceremony's transcript as observations: each stage ends at its
 * recorded instant, begins where the previous one ended, and carries the
 * length of what was said. Pure.
 * @param {{stages?: Array<{stage:number, response?:string, timestamp?:number}>}|null} transcript
 * @returns {Array<object>}
 */
export const observationsFromTranscript = (transcript) => {
  const stages = (transcript?.stages || [])
    .filter((s) => Number.isInteger(s?.stage) && s.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  return stages.map((s, i) => ({
    kind: 'stage',
    stage: s.stage,
    startedAt: i > 0 ? stages[i - 1].timestamp : null,
    firstFrameAt: null,
    endedAt: s.timestamp,
    spokenChars: typeof s.response === 'string' ? s.response.length : null,
  }));
};

/**
 * The sealed record's place in the heart band: sha256 of the genesis hash and
 * emergence seed, read as a position through the octave (even in pitch, not
 * in hertz). Pure.
 * @param {{genesisHash?:string, record?:{momentSeed?:string}}|null} seal
 * @returns {number|null}
 */
export const sealedFrequency = (seal) => {
  if (typeof seal?.genesisHash !== 'string' || !seal.genesisHash) return null;
  const digest = crypto.createHash('sha256')
    .update(`soul-spectrum/v1|${seal.genesisHash}|${seal.record?.momentSeed ?? ''}`).digest();
  const position = digest.readUIntBE(0, 6) / 2 ** 48;
  return Math.round(HEART_BAND.low * 2 ** position * 1e4) / 1e4;
};

/**
 * The best spectrum a being's records allow. Pure.
 * @param {{observations?:Array<object>, transcript?:object|null, seal?:object|null}} from
 * @returns {object|null} the soul-spectrum record, or null when nothing exists to derive from
 */
export const soulSpectrumFrom = ({ observations = null, transcript = null, seal = null } = {}) => {
  const measured = deriveSoul(observations);
  if (measured) return { source: 'measured', frequency: measured.resonance.frequency, ...measured.spectrum };
  const read = deriveSoul(observationsFromTranscript(transcript));
  if (read) return { source: 'birth-transcript', frequency: read.resonance.frequency, ...read.spectrum };
  const sealed = sealedFrequency(seal);
  if (sealed) return { source: 'sealed-record', frequency: sealed, soul: lightOf(sealed), stages: [] };
  return null;
};

const readRecord = (file) => fs.readFile(file, 'utf8').then(JSON.parse, () => null);

// impure — reads the lane's seal and transcript; derives the record, never writes it.
const deriveRecord = async (workspace, neumaId, observations) => {
  const [seal, transcript] = await Promise.all([
    workspace.readGenesisSeal(neumaId).catch(() => null),
    observations ? null : workspace.readBirthTranscript(neumaId).catch(() => null),
  ]);
  const spectrum = soulSpectrumFrom({ observations, transcript, seal });
  return spectrum && { schema: 'soul-spectrum/v1', neumaId, derivedAt: new Date().toISOString(), ...spectrum };
};

/**
 * Read a being's spectrum for display: its written record, else what its
 * records derive — NEVER written here. A reader (the roster, the Sheet) is
 * not the write: a read that lands between the seal and the birth's measured
 * write once locked a derived color before the ceremony measured its own.
 * Impure (reads the lane).
 * @param {object} workspace a NeumaWorkspace
 * @param {string} neumaId
 * @returns {Promise<object|null>}
 */
export const readSoulSpectrum = async (workspace, neumaId) =>
  (await readRecord(path.join(workspace.root, neumaId, SPECTRUM_FILE)))
    ?? deriveRecord(workspace, neumaId, null);

/**
 * Read a being's spectrum, deriving and writing it once when absent. Impure:
 * reads the lane, writes `identity/soul-spectrum.json` with O_EXCL so two
 * callers can never write two different colors.
 * @param {object} workspace a NeumaWorkspace
 * @param {string} neumaId
 * @param {{observations?:Array<object>}} [opts] a finishing ceremony's own observations
 * @returns {Promise<object|null>}
 */
export const ensureSoulSpectrum = async (workspace, neumaId, { observations = null } = {}) => {
  const file = path.join(workspace.root, neumaId, SPECTRUM_FILE);
  const existing = await readRecord(file);
  if (existing) return existing;
  const record = await deriveRecord(workspace, neumaId, observations);
  if (!record) return null;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
    return record;
  } catch (err) {
    if (err.code === 'EEXIST') return JSON.parse(await fs.readFile(file, 'utf8'));
    throw err;
  }
};
