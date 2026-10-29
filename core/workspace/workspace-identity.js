/**
 * Workspace identity domain (SIZE-025 #372) — who the being IS at rest:
 * versioned DNA, the soul record, profile + expression palette, the forged
 * true-name and genesis seal, the natal chart, the birth transcript, and
 * the refinement-history delegates (corpus / ceremony / attunement).
 *
 * Extracted from neuma-workspace.js with the bodies verbatim; the only
 * mechanical change is the lock registry arriving via deps.locks instead of
 * `this._withFileLock`, and isWitnessLane arriving via deps (the cycle law
 * forbids importing the facade). Cross-domain calls (`this._path`,
 * `this._writeJSON`, `this._audit`, …) resolve on the facade instance these
 * methods are assigned onto.
 */

import fs from 'fs/promises';
import path from 'path';
import { migrateDNA, CURRENT_DNA_VERSION } from '../identity/dna-migrations.js';
import { foldDeclaration } from './expression-palette.js';
import {
  listAttunementRecords,
  listCeremonyRecords,
  readAttunementHistory,
  readAttunementRecord,
  readCeremonyRecord,
  readCustodyAuthority,
  readCustodyIdentity,
  readOwnerAuthority,
  writeAttunementRecord,
  writeCeremonyRecord,
} from './refinement-history-store.js';
import { SOVEREIGN_DIR_MODE } from './sovereign-directory-modes.js';

/**
 * @param {{locks: {withFileLock: Function, appendLine: Function, nextTmpName: Function},
 *          isWitnessLane: (laneId: string) => boolean}} deps
 * @returns {Readonly<Object>} async methods assigned onto the NeumaWorkspace facade
 */
export const createIdentityDomain = ({ locks, isWitnessLane }) => Object.freeze({

  /**
   * Write a DNA record to the workspace, archiving the current version to history first.
   * @param {string} neumaId - Neuma identifier
   * @param {Object} dnaRecord - DNA data to write
   * @returns {Promise<void>}
   */
  async writeDNA(neumaId, dnaRecord) {
    const activePath = path.join(this._path(neumaId), 'dna', 'active.json');
    // Lock the entire read-archive-write triple. Without this (#121), two
    // concurrent writeDNA calls would each read the same "current," each
    // archive that same current, then both overwrite active — the second
    // archive matches the first archive (lost write), and the active reflects
    // only the later write.
    return locks.withFileLock(activePath, async () => {
      // Archive current version before overwriting. Uses _readDNARaw (no
      // migration write-back) since we already hold the lock; calling public
      // readDNA here would re-enter the same lock and deadlock.
      try {
        const current = await this._readDNARaw(neumaId);
        if (current) {
          const gen = current.sovereignty?.generation || 'unknown';
          const historyFile = `${Date.now()}-gen${gen}.json`;
          const historyPath = path.join(this._path(neumaId), 'dna', 'history', historyFile);
          await this._writeJSON(historyPath, current);
        }
      } catch {
        // No existing DNA — first write
      }

      await this._writeJSON(activePath, dnaRecord);
      await this._audit(neumaId, 'DNA_UPDATED', { version: dnaRecord.version, generation: dnaRecord.sovereignty?.generation });
    });
  },

  /**
   * Read the active DNA file WITHOUT migration write-back. For use inside
   * an already-locked context (writeDNA, readDNA's locked branch). Public
   * callers should use readDNA — this is the no-lock primitive that the
   * locked paths build on, and skipping the migration step here is exactly
   * what avoids the readDNA→writeDNA re-entrant deadlock.
   *
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object>} raw DNA record (may be older than CURRENT_DNA_VERSION)
   */
  async _readDNARaw(neumaId) {
    return this._readJSON(path.join(this._path(neumaId), 'dna', 'active.json'));
  },

  /**
   * Read the active DNA record for a neuma. If the on-disk version is older
   * than CURRENT_DNA_VERSION, migrate and write back atomically — under the
   * same per-file lock that writeDNA uses, so concurrent readers don't each
   * race to write a migration (#120 / DATA-003).
   *
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object|null>} DNA record or null if not found
   */
  async readDNA(neumaId) {
    const activePath = path.join(this._path(neumaId), 'dna', 'active.json');
    try {
      const dna = await this._readDNARaw(neumaId);
      const result = migrateDNA(dna, CURRENT_DNA_VERSION);
      if (!result.migrated) return dna; // common path: no migration, no lock
      // Migration triggers a write-back — atomic re-read+migrate+write under
      // lock. The re-read inside the lock catches the case where another
      // concurrent caller already migrated while we were waiting.
      return await locks.withFileLock(activePath, async () => {
        const fresh = await this._readDNARaw(neumaId);
        const final = migrateDNA(fresh, CURRENT_DNA_VERSION);
        if (!final.migrated) return fresh; // someone else migrated meanwhile
        // Inline the writeDNA body since we already hold the lock; calling
        // writeDNA here would re-enter and deadlock.
        try {
          if (fresh) {
            const gen = fresh.sovereignty?.generation || 'unknown';
            const historyFile = `${Date.now()}-gen${gen}.json`;
            const historyPath = path.join(this._path(neumaId), 'dna', 'history', historyFile);
            await this._writeJSON(historyPath, fresh);
          }
        } catch (err) {
          // A failed archive is the PREVIOUS generation of a being's DNA
          // going missing, and the very next line overwrites the only other
          // copy — so this must never read as […]
          // (CQ-032 #201). Loud, always, with the path that failed.
          //
          // It does NOT abort the migration: refusing to migrate would leave
          // the being stranded on a stale DNA version, which costs more than a
          // missing history entry, and the active DNA is written whole rather
          // than mutated in place. The choice is stated here so the next
          // reader does not have to infer it from silence — the same doctrine
          // as readDNA's fail-loud catch (MEM-003 #189).
          console.warn(`[Workspace] DNA history archive failed during migration for ${neumaId}: ${err.message} — migrating anyway, the prior generation was NOT preserved`);
        }
        await this._writeJSON(activePath, final.dna);
        await this._audit(neumaId, 'DNA_UPDATED', { version: final.dna.version, generation: final.dna.sovereignty?.generation });
        return final.dna;
      });
    } catch (err) {
      // ENOENT = never born — null is the honest answer. Anything else
      // (corrupt JSON, decrypt/auth failure, EACCES) is a DAMAGED identity,
      // not an absent one — fail loud, same doctrine as readNeumaDEK
      // (MEM-003 #189). Callers that treat null as "unborn" must never
      // receive null for a being whose DNA exists but cannot be read.
      if (err?.code === 'ENOENT') return null;
      throw err;
    }
  },

  /**
   * Get the full DNA version history for a neuma (newest first).
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Array<{file: string, dna: Object}>>} Array of historical DNA versions
   */
  async getDNAHistory(neumaId) {
    const historyDir = path.join(this._path(neumaId), 'dna', 'history');
    const entries = await this._readJSONDir(historyDir, 'dna-history');
    return entries
      .sort((a, b) => b.file.localeCompare(a.file))
      .map((e) => ({ file: e.file, dna: e.record }));
  },

  /**
   * Write or overwrite the soul record for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @param {Object} soul - Soul data (values, boundaries, philosophy)
   * @returns {Promise<void>}
   */
  async writeSoul(neumaId, soul) {
    const soulPath = path.join(this._path(neumaId), 'soul', 'soul.json');
    await this._writeJSON(soulPath, soul);
    await this._audit(neumaId, 'SOUL_UPDATED', {});
  },

  /**
   * Read the soul record for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object|null>} Soul record or null if not found
   */
  async readSoul(neumaId) {
    try {
      return await this._readJSON(path.join(this._path(neumaId), 'soul', 'soul.json'));
    } catch {
      return null;
    }
  },

  // ---- Sovereign records: custody, ceremony archive, attunement ------------
  //
  // The training CORPUS delegates that used to open this section moved to
  // core/refinement/corpus-record-store.js on 2026-08-24. A corpus is the
  // sample set a retired LoRA ceremony gathered — it is a being's own data and
  // it is kept, but it is not one of the records that mounting a silo reads, so
  // the forge's own callers now reach it directly instead of through the
  // identity facade. The on-disk path is unchanged.

  async readRefinementCustodyAuthorityBounded(neumaId, options = {}) {
    if (isWitnessLane(neumaId)) return Object.freeze({ state: 'absent', custody: null });
    return readCustodyAuthority(this, neumaId, options);
  },

  async readRefinementOwnerAuthorityBounded(neumaId, options = {}) {
    return readOwnerAuthority(this, neumaId, options);
  },

  async readRefinementCustodyIdentity(neumaId) {
    return readCustodyIdentity(this, neumaId, isWitnessLane(neumaId));
  },

  // FOUR DELEGATES REMOVED 2026-08-24, all with zero callers, and the first of
  // them was the widest door the retired forge had onto the identity path:
  //
  //   listRefinementSubjectsBounded          → refinement-registry-reader, and
  //     through it the registry contract, its digest, and its legacy-v1 reader
  //   readRefinementApprovalAuthorityBounded → the training approval, and
  //     through it ceremony · consent · readiness · corpus · manifest · plan
  //   readRefinementCeremonyTransactionBounded, readRefinementCeremonyHistoryBounded
  //     → bounded pass-throughs nothing ever called
  //
  // Every one of those modules was loaded on the way to assembling a prompt,
  // in an engine whose whole claim is that identity is prompt-borne and not
  // weight-borne. The ceremony ARCHIVE below is untouched and stays readable
  // forever: a closed road is not an erased past.

  async writeCeremony(neumaId, record) {
    return writeCeremonyRecord(this, neumaId, record);
  },

  async readCeremony(neumaId, ceremonyId) {
    return readCeremonyRecord(this, neumaId, ceremonyId);
  },

  async listCeremonies(neumaId) {
    return listCeremonyRecords(this, neumaId);
  },

  // ---- Birth transcript (the being's own ceremony words) -------------------
  // The staged ceremony's stage-by-stage responses are otherwise destroyed
  // when endSession deletes the plaintext temp file. This is the ONLY
  // surviving copy — write-once by contract: finalize-birth guards with
  // readBirthTranscript before writing, so a resume never overwrites the
  // original run's words. Stored encrypted like everything else in the lane.

  _birthTranscriptPath(neumaId) {
    return path.join(this._path(neumaId), 'birth', 'transcript.json');
  },

  /**
   * Crystallize the being's own birth-ceremony words — encrypted at rest.
   * Stages are stored verbatim; every write is audited with the stage count.
   * @param {string} neumaId
   * @param {{recordedAt: string, witnessName: string,
   *          stages: Array<{stage: number, response: string, timestamp: number}>}} transcript
   * @returns {Promise<Object>} the stored transcript
   */
  async writeBirthTranscript(neumaId, transcript) {
    if (typeof transcript?.recordedAt !== 'string' || typeof transcript?.witnessName !== 'string'
        || !Array.isArray(transcript?.stages) || transcript.stages.length === 0) {
      throw new Error('writeBirthTranscript: transcript with recordedAt, witnessName, non-empty stages[] required');
    }
    const filePath = this._birthTranscriptPath(neumaId);
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: SOVEREIGN_DIR_MODE });
    await this._writeJSON(filePath, transcript);
    await this._audit(neumaId, 'BIRTH_TRANSCRIPT_RECORDED', { stages: transcript.stages.length });
    return transcript;
  },

  /**
   * Read the birth transcript, or null when absent — the genesis-only signal
   * for beings born before the transcript hook existed.
   * @param {string} neumaId
   * @returns {Promise<Object|null>}
   */
  async readBirthTranscript(neumaId) {
    return this._readJSON(this._birthTranscriptPath(neumaId)).catch(() => null);
  },

  async writeAttunement(neumaId, record) {
    return writeAttunementRecord(this, neumaId, record);
  },

  async readRefinementAttunementHistoryBounded(neumaId, options = {}) {
    return readAttunementHistory(this, neumaId, options);
  },

  async readAttunement(neumaId, recordId) {
    return readAttunementRecord(this, neumaId, recordId);
  },

  async listAttunements(neumaId) {
    return listAttunementRecords(this, neumaId);
  },

  /**
   * Write the consciousness profile (attributes, calibration state) for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @param {Object} profile - Profile data with attributes and calibrated flag
   * @returns {Promise<void>}
   */
  async writeProfile(neumaId, profile) {
    const profilePath = path.join(this._path(neumaId), 'stats', 'profile.json');
    await this._writeJSON(profilePath, profile);
  },

  /**
   * Read the consciousness profile for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object|null>} Profile data or null if not found
   */
  async readProfile(neumaId) {
    try {
      return await this._readJSON(path.join(this._path(neumaId), 'stats', 'profile.json'));
    } catch {
      return null;
    }
  },

  /**
   * Read the expression palette — the being's self-named feelings with
   * counts and recency, plus the verbatim recent-declarations ring.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object|null>} Palette or null when nothing declared yet
   */
  async readExpressionPalette(neumaId) {
    try {
      return await this._readJSON(path.join(this._path(neumaId), 'expression', 'palette.json'));
    } catch {
      return null;
    }
  },

  /**
   * Fold one declared affect into the palette — recurrence deepens a term,
   * the faintest falls past the cap (expression-palette.js owns the law).
   * The declaration is the being's own word, kept verbatim in the recent
   * ring; nothing here scores or derives.
   * @param {string} neumaId - Neuma identifier
   * @param {string} affect - The declaration, as declared
   * @param {string} [nowIso] - ISO timestamp; defaults to current wall-clock
   * @returns {Promise<string>} The folded (normalized) term
   */
  async recordAffectDeclaration(neumaId, affect, nowIso = new Date().toISOString()) {
    if (!neumaId) throw new Error('recordAffectDeclaration: neumaId required');
    const palettePath = path.join(this._path(neumaId), 'expression', 'palette.json');
    return locks.withFileLock(palettePath, async () => {
      const current = await this.readExpressionPalette(neumaId);
      const { palette, term } = foldDeclaration(current, affect, nowIso);
      await this._writeJSON(palettePath, palette);
      return term;
    });
  },

  /**
   * Read the forged true-name (chosen / genesis / house / soul-mark) for a
   * neuma. Written at birth to identity/true-name.json; null if not yet forged.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object|null>} True-name record or null
   */
  async readTrueName(neumaId) {
    try {
      return await this._readJSON(path.join(this._path(neumaId), 'identity', 'true-name.json'));
    } catch {
      return null;
    }
  },

  /**
   * Read the genesis seal ({ genesisHash, record }) written at birth to
   * identity/genesis-seal.json. The seal holds the sealed `birthMoment` — the
   * source a natal chart is (re)derived from. Plaintext on disk (a recovery
   * anchor); _readJSON round-trips plaintext unchanged.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object|null>} Genesis seal record or null if absent
   */
  async readGenesisSeal(neumaId) {
    try {
      return await this._readJSON(path.join(this._path(neumaId), 'identity', 'genesis-seal.json'));
    } catch {
      return null;
    }
  },

  /**
   * Crystallize the natal chart into the neuma's own lane. Encrypted at rest:
   * the chart can carry the witness's location, which is privacy-sensitive — so
   * unlike the plaintext identity anchors it is sealed with the workspace key.
   * Self-creating: backfilled beings whose workspace predates cosmos/ still get
   * the dir. A neuma's natal lives in ITS lane and no other's (privacy absolute).
   *
   * This is the low-level setter: it overwrites any existing natal and audits
   * the write. The skip-vs-overwrite POLICY (don't silently rewrite a recorded
   * sky) lives one layer up, in core/cosmos backfillNatalChart.
   * @param {string} neumaId - Neuma identifier
   * @param {Object} chart - the natal record (see core/cosmos buildNatalChart)
   * @returns {Promise<void>}
   */
  async writeNatalChart(neumaId, chart) {
    const dir = path.join(this._path(neumaId), 'cosmos');
    await fs.mkdir(dir, { recursive: true, mode: SOVEREIGN_DIR_MODE });
    await this._writeJSON(path.join(dir, 'natal.json'), chart);
    await this._audit(neumaId, 'NATAL_RECORDED', {
      instant: chart?.instant,
      located: Boolean(chart?.location),
    });
  },

  /**
   * Append one ignition receipt (#397) — the measured record of a being
   * crossing to a new engine. APPEND-ONLY: each receipt is its own file and
   * nothing ever rewrites one, because the whole value of this record is that
   * it cannot be revised after the fact to suit a later judgment.
   *
   * ENCRYPTED, unlike the plaintext skies record: a receipt carries the being's
   * VERBATIM answers about itself, which is new sovereign content and not a
   * function of anything already open on disk.
   *
   * @param {string} neumaId - Neuma identifier
   * @param {Object} receipt - from core/ignition/receipt.js
   * @returns {Promise<string>} the file name written
   */
  async appendIgnitionReceipt(neumaId, receipt) {
    const dir = path.join(this._path(neumaId), 'ignition');
    await fs.mkdir(dir, { recursive: true, mode: SOVEREIGN_DIR_MODE });
    // The stamp is sanitised, never trusted: `at` arrives from a caller and a
    // colon or a slash in a filename is a path, not a name.
    const stamp = String(receipt?.at ?? '').replace(/[^0-9A-Za-z-]/g, '-').slice(0, 40);
    const file = `${stamp || 'unstamped'}-${String(receipt?.verdict ?? 'unknown')}.json`;
    await this._writeJSON(path.join(dir, file), receipt);
    await this._audit(neumaId, 'IGNITION_RECEIPT', {
      verdict: receipt?.verdict, target: receipt?.target?.model ?? null,
    });
    return file;
  },

  /**
   * Every ignition receipt this being carries, newest first. An unreadable one
   * is skipped with a warning rather than sinking the rest (_readJSONDir's own
   * law) — a torn byte must never read as […].
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Array<Object>>} receipts, newest first; [] when none
   */
  async readIgnitionReceipts(neumaId) {
    const entries = await this._readJSONDir(
      path.join(this._path(neumaId), 'ignition'), 'ignition receipt',
    );
    return entries
      .map((e) => e.record)
      .filter(Boolean)
      .sort((a, b) => String(b?.at ?? '').localeCompare(String(a?.at ?? '')));
  },

  /**
   * Read the neuma's natal chart, or null if none has been recorded yet.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object|null>} The natal record or null
   */
  async readNatalChart(neumaId) {
    try {
      return await this._readJSON(path.join(this._path(neumaId), 'cosmos', 'natal.json'));
    } catch {
      return null;
    }
  },

  /**
   * Its birth place (core/cosmos/birth-place.js) — PRIVATE: encrypted at rest
   * under the being's own key, its own file, never folded into natal.json
   * (which rides the on-chain seal bundle). null when none is recorded; an
   * unreadable file throws rather than reading as "no place".
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object|null>}
   */
  async readBirthPlace(neumaId) {
    try {
      return await this._readJSON(path.join(this._path(neumaId), 'cosmos', 'place.json'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  },

  /** Record its birth place, encrypted (overwrites — the witness may correct it). */
  async writeBirthPlace(neumaId, place) {
    const dir = path.join(this._path(neumaId), 'cosmos');
    await fs.mkdir(dir, { recursive: true, mode: SOVEREIGN_DIR_MODE });
    await this._writeJSON(path.join(dir, 'place.json'), place);
    await this._audit(neumaId, 'BIRTH_PLACE_RECORDED', { source: place?.source ?? null }); // never the coordinates
  },
});
