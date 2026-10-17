/**
 * Workspace vault domain (SIZE-025 #372) — the personal vault
 * (T3-personal): the being's own curation space of markdown notes,
 * DEK-encrypted at rest, readable/writable only through NEUMA surfaces —
 * never raw-disk-openable. Sharing into the commons is a separate, explicit
 * publish gesture.
 *
 * Extracted from neuma-workspace.js with the bodies verbatim; the only
 * mechanical change is the lock registry arriving via deps.locks instead of
 * `this._withFileLock`. Cross-domain calls (`this._path`, `this._writeJSON`,
 * `this._readJSON`, `this._readJSONDir`) resolve on the facade instance these
 * methods are assigned onto.
 */

import fs from 'fs/promises';
import path from 'path';
import { matchVaultNotes } from '../vault/vault-search.js';
import { SOVEREIGN_DIR_MODE } from './sovereign-directory-modes.js';

/**
 * @param {{locks: {withFileLock: Function, appendLine: Function, nextTmpName: Function}}} deps
 * @returns {Readonly<Object>} async methods assigned onto the NeumaWorkspace facade
 */
export const createVaultDomain = ({ locks }) => Object.freeze({

  _vaultNotePath(neumaId, slug) {
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(slug)) {
      throw new Error(`Invalid vault note slug: ${String(slug).slice(0, 80)}`);
    }
    return path.join(this._path(neumaId), 'vault', 'notes', `${slug}.json`);
  },

  /**
   * Write (create or update) one personal-vault note. Encrypted like every
   * other sovereign file. On update, the outgoing version is snapshotted to
   * `vault/history/<slug>/` BEFORE the overwrite (the same stamp-and-retain
   * doctrine as writeDNA's dna/history) — a page's whole life is recoverable
   * via listVaultHistory/readVaultRevision. Returns the stored note record.
   * @param {string} neumaId
   * @param {string} slug - kebab-case note name (the being's own title key)
   * @param {{title: string, body: string, createdAt?: string, updatedAt?: string}} note -
   *   markdown body; createdAt/updatedAt pass through only when a bundle
   *   import is restoring the being's history (echo R3 Low)
   * @returns {Promise<Object>}
   */
  async writeVaultNote(neumaId, slug, { title, body, createdAt, updatedAt }) {
    if (typeof title !== 'string' || typeof body !== 'string') {
      throw new Error('writeVaultNote: title and body strings required');
    }
    const filePath = this._vaultNotePath(neumaId, slug);
    // createdAt preservation is a read-modify-write — under the per-file lock
    // (MEM-008 #195) so concurrent saves of one note never clobber each other.
    return locks.withFileLock(filePath, async () => {
      const existing = await this._readJSON(filePath).catch(() => null);
      if (existing) {
        // Snapshot the outgoing version to history before overwrite. Named by
        // its own updatedAt (filename-safe) so each revision's name says WHEN
        // it was current; successive edits always carry distinct stamps.
        const stamp = String(existing.updatedAt || Date.now()).replace(/[^0-9A-Za-z]+/g, '-');
        const historyPath = path.join(this._path(neumaId), 'vault', 'history', slug, `${stamp}.json`);
        await this._writeJSON(historyPath, existing);
      }
      const now = new Date().toISOString();
      const record = {
        slug,
        title,
        body,
        // Preservation order: the existing record (a normal edit), the
        // incoming record (an import restoring history), then now (new note).
        createdAt: existing?.createdAt || createdAt || now,
        updatedAt: updatedAt || now,
      };
      await fs.mkdir(path.dirname(filePath), { recursive: true, mode: SOVEREIGN_DIR_MODE });
      await this._writeJSON(filePath, record);
      return record;
    });
  },

  /**
   * Read one personal-vault note, or null when absent.
   * @param {string} neumaId
   * @param {string} slug
   * @returns {Promise<Object|null>}
   */
  async readVaultNote(neumaId, slug) {
    const filePath = this._vaultNotePath(neumaId, slug);
    return this._readJSON(filePath).catch(() => null);
  },

  /**
   * List personal-vault notes (full records), newest-updated first.
   * Archived pages are NEVER mixed in silently: by default only live pages
   * come back; with `includeArchived` the archived records (each stamped
   * `archivedAt`) follow after the live list, newest-archived last — two
   * distinct runs, so a caller always knows which standing a page holds.
   * @param {string} neumaId
   * @param {{includeArchived?: boolean}} [opts]
   * @returns {Promise<Array<Object>>}
   */
  async listVaultNotes(neumaId, { includeArchived = false } = {}) {
    const dir = path.join(this._path(neumaId), 'vault', 'notes');
    let files;
    try {
      files = await fs.readdir(dir);
    } catch {
      files = []; // no live dir yet — archived pages may still follow below
    }
    const notes = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const note = await this._readJSON(path.join(dir, f)).catch(() => null);
      if (note) notes.push(note);
    }
    const live = notes.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    if (!includeArchived) return live;
    const archived = (await this._readJSONDir(path.join(this._path(neumaId), 'vault', 'archive'), 'vault-archive'))
      .map((e) => e.record)
      .sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));
    return [...live, ...archived];
  },

  /**
   * Revision history of one vault page, newest first. Each entry names its
   * revision (the history filename stem — the sanitized updatedAt the
   * version carried while it was current), its updatedAt, and its title.
   * @param {string} neumaId
   * @param {string} slug
   * @returns {Promise<Array<{revision: string, updatedAt: string|null, title: string}>>}
   */
  async listVaultHistory(neumaId, slug) {
    this._vaultNotePath(neumaId, slug); // the slug defense, same as every vault path
    const historyDir = path.join(this._path(neumaId), 'vault', 'history', slug);
    const entries = await this._readJSONDir(historyDir, 'vault-history');
    return entries
      .sort((a, b) => b.file.localeCompare(a.file))
      .map((e) => ({
        revision: e.file.replace(/\.json$/, ''),
        updatedAt: e.record.updatedAt || null,
        title: e.record.title || slug,
      }));
  },

  /**
   * Read one historical revision of a vault page (full record), or null when
   * absent. The revision id is validated against the exact namespace
   * writeVaultNote's snapshot naming produces — no dots, no separators, so
   * no traversal out of the page's history dir.
   * @param {string} neumaId
   * @param {string} slug
   * @param {string} revision - a revision id from listVaultHistory
   * @returns {Promise<Object|null>}
   */
  async readVaultRevision(neumaId, slug, revision) {
    this._vaultNotePath(neumaId, slug);
    if (!/^[0-9A-Za-z][0-9A-Za-z-]{0,80}$/.test(String(revision || ''))) {
      throw new Error(`Invalid vault revision: ${String(revision).slice(0, 80)}`);
    }
    const revisionPath = path.join(this._path(neumaId), 'vault', 'history', slug, `${revision}.json`);
    return this._readJSON(revisionPath).catch(() => null);
  },

  // Stage-verify-commit: write the archive copy, read it back whole, and
  // only THEN let the live file go. Never a blind unlink — a failed stage or
  // a torn verify leaves the live page standing. The caller holds the lock
  // on the live file (archiveVaultNote and renameVaultNote both do).
  // impure — writes the archive copy, removes the live file after verification
  async _archiveVaultNoteLocked(neumaId, slug, record) {
    const archivePath = path.join(this._path(neumaId), 'vault', 'archive', `${slug}.json`);
    const archived = { ...record, archivedAt: new Date().toISOString() };
    await this._writeJSON(archivePath, archived);
    const verified = await this._readJSON(archivePath);
    if (verified?.slug !== record.slug
      || verified?.body !== record.body
      || verified?.updatedAt !== record.updatedAt) {
      throw new Error(`archive verification failed for vault note "${slug}" — the live page was kept`);
    }
    await fs.unlink(this._vaultNotePath(neumaId, slug));
    return archived;
  },

  /**
   * Archive one vault page — non-destructive: the record (stamped
   * `archivedAt`) moves to `vault/archive/<slug>.json` and the live file is
   * removed ONLY after the archive copy verifies on read-back. Returns the
   * archived record, or null when no such live page exists. An archived page
   * is restorable simply by writeVaultNote to the same slug — the archive
   * copy remains as the record of its resting period.
   * @param {string} neumaId
   * @param {string} slug
   * @returns {Promise<Object|null>}
   */
  async archiveVaultNote(neumaId, slug) {
    const filePath = this._vaultNotePath(neumaId, slug);
    return locks.withFileLock(filePath, async () => {
      const record = await this._readJSON(filePath).catch(() => null);
      if (!record) return null;
      return this._archiveVaultNoteLocked(neumaId, slug, record);
    });
  },

  /**
   * Rename one vault page: the record is written under newSlug with its
   * createdAt preserved (a fresh updatedAt), the page's revision history
   * follows to the new name, and the OLD slug is archived (not erased) so
   * the old name leaves the live list while nothing is lost. Refuses loudly
   * when the page does not exist or newSlug is already taken.
   * @param {string} neumaId
   * @param {string} slug
   * @param {string} newSlug - through the same _vaultNotePath defense
   * @returns {Promise<Object>} the renamed record
   */
  async renameVaultNote(neumaId, slug, newSlug) {
    const fromPath = this._vaultNotePath(neumaId, slug);
    const toPath = this._vaultNotePath(neumaId, newSlug); // same slug defense
    if (slug === newSlug) {
      throw new Error(`renameVaultNote: "${slug}" is already its own name`);
    }
    return locks.withFileLock(fromPath, async () => {
      const record = await this._readJSON(fromPath).catch(() => null);
      if (!record) throw new Error(`renameVaultNote: no vault note named "${slug}"`);
      const clash = await this._readJSON(toPath).catch(() => null);
      if (clash) throw new Error(`renameVaultNote: a vault note named "${newSlug}" already exists`);
      const renamed = {
        ...record,
        slug: newSlug,
        createdAt: record.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await this._writeJSON(toPath, renamed);
      // The page's history follows its name; the old name rests in the archive.
      const fromHistory = path.join(this._path(neumaId), 'vault', 'history', slug);
      const toHistory = path.join(this._path(neumaId), 'vault', 'history', newSlug);
      try {
        await fs.rename(fromHistory, toHistory);
      } catch {
        // No history yet — a never-rewritten page has nothing to move.
      }
      await this._archiveVaultNoteLocked(neumaId, slug, record);
      return renamed;
    });
  },

  /**
   * Search the being's live vault pages by word — the gather is impure
   * (list + decrypt), the matching is the pure core/vault/vault-search.js.
   * Archived pages do not answer search: they are at rest, not in the being's
   * working curation. Blank queries refuse loudly (never a silent match-all).
   * @param {string} neumaId
   * @param {string} query
   * @returns {Promise<Array<{slug: string, title: string, snippet: string}>>}
   */
  // impure — reads every live page through the encrypted store
  async searchVaultNotes(neumaId, query) {
    return matchVaultNotes(await this.listVaultNotes(neumaId), query);
  },
});
