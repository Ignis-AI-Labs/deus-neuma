/**
 * Security Routes — the witness-facing view of their own data security, so the
 * Security settings tab can show (and later act on) encryption state without an
 * operator dropping to the CLI.
 *
 * Everything here is scoped to the verified signer: a wallet only ever sees its
 * OWN beings (listNeumaByOwner), never an enumeration of others'. Read-only in
 * this phase — status + a dry-run plan. The actual DEK migration stays the
 * gated CLI until it is made safe to run against a live being (its file rename
 * bypasses the workspace lock queue); this module deliberately exposes NO
 * execute route yet.
 *
 * GET  /status            — roots (active vs persisted), storage, per-being DEK status
 * POST /encryption/plan   — dry-run the per-neuma DEK backfill (no writes)
 * GET    /backup-destination — where copies land, and what that protects against
 * PUT    /backup-destination — choose it (an external disk / USB), or clear it
 * POST   /backup          — snapshot the witness's beings (copy of encrypted files)
 * GET    /backups         — list the witness's own backups
 * DELETE /backups/:id     — remove one of the witness's own backups
 */
import { promises as fs } from 'fs';
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { neumaWorkspace, getWorkspacesRoot } from '../../core/index.js';
import { enumerateBeings, migrateAllBeings } from '../../core/workspace/migrate-all.js';
import { loadWorkspaceSettings, settingsPath } from '../services/workspace-settings.js';
import { checkStorage } from '../services/storage-health.js';
import { createBackup, listBackups, deleteBackup } from '../services/backup-service.js';
import {
  assessDestination, writeDestination, DESTINATION,
} from '../services/backup-destination.js';
import { createLogger } from '../services/logger.js';
import { requestState } from '../../core/runtime/operator-state.js';

const router = Router();
const log = createLogger('Security');

router.use(requireAuth);

// Resolve the active + persisted workspace roots. They can legitimately differ
// (env WORKSPACES_ROOT vs the persisted data/settings/workspace.json choice the
// server applies at boot) — surfacing BOTH is the point: a witness must never
// aim a migration or backup at the wrong place because the two silently
// disagreed. `aligned` is the at-a-glance truth.
const resolveRoots = async () => {
  const active = getWorkspacesRoot();
  const persisted = (await loadWorkspaceSettings()).root ?? null;
  if (persisted !== null) {
    return { active, persisted, aligned: persisted === active };
  }
  // No root resolved. A MISSING settings file is honest "no persisted choice"
  // (env/default is authoritative — nothing to disagree with, aligned). But a
  // settings file that EXISTS yet yielded no root is corrupt/unreadable — we
  // genuinely cannot tell, so DON'T claim aligned (that would mask the exact
  // misconfiguration this tab exists to surface).
  const settingsExist = await fs.access(settingsPath()).then(() => true).catch(() => false);
  if (settingsExist) {
    log.warn('Workspace settings file present but no root resolved — root alignment unknown', {
      path: settingsPath(),
    });
    return { active, persisted: null, aligned: 'unknown' };
  }
  return { active, persisted: null, aligned: true };
};

/**
 * GET /status — the witness's data-security posture at a glance.
 * Read-only, no crypto: DEK status is file-presence (keys/dek.json), not an
 * unwrap, so it is fast and never touches key material.
 */
router.get('/status', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    if (!wallet) return res.status(401).json({ error: 'unauthenticated' });

    const roots = await resolveRoots();
    const storage = await checkStorage(roots.active);

    // hasDek per being comes from enumerateBeings (fs.access on keys/dek.json),
    // cross-referenced with the beings THIS wallet owns.
    const [owned, enumerated] = await Promise.all([
      // a harness desk is shown the machine, never the house's beings (operator-state.js)
      requestState(req.headers) === 'harness' ? [] : neumaWorkspace.listNeumaByOwner(wallet),
      enumerateBeings(roots.active),
    ]);
    const hasDekById = new Map(enumerated.map((b) => [b.neumaId, b.hasDek === true]));

    const beings = [];
    for (const { neumaId } of owned) {
      const trueName = await neumaWorkspace.readTrueName(neumaId).catch((error) => {
        log.warn('readTrueName failed — falling back to neumaId', { neumaId, error: error.message });
        return null;
      });
      beings.push({
        neumaId,
        name: trueName?.chosenName || trueName?.fullName || neumaId,
        secured: hasDekById.get(neumaId) === true, // holds its OWN key vs shared global
      });
    }
    beings.sort((a, b) => (a.neumaId < b.neumaId ? -1 : a.neumaId > b.neumaId ? 1 : 0));

    const securedCount = beings.filter((b) => b.secured).length;

    res.json({
      roots,
      storage,
      beings,
      encryption: {
        securedCount,
        totalCount: beings.length,
        allSecured: beings.length > 0 && securedCount === beings.length,
      },
    });
  } catch (error) {
    log.error('Security status failed', { error: error.message });
    res.status(500).json({ error: 'Could not read security status' });
  }
});

/**
 * POST /encryption/plan — dry-run the per-neuma DEK backfill. Zero writes, no
 * audit entries: it classifies each file to report what WOULD change and,
 * critically, whether any file cannot be decrypted with the current master
 * (the go/no-go signal — a non-zero cannotDecrypt means the environment is
 * misconfigured and an execute would only partially migrate).
 *
 * Scoped to the witness's own beings. The underlying sweep runs against the
 * active root; results are filtered to owned beings so a shared machine never
 * leaks another witness's migration state.
 */
router.post('/encryption/plan', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    if (!wallet) return res.status(401).json({ error: 'unauthenticated' });

    const owned = new Set((await neumaWorkspace.listNeumaByOwner(wallet)).map((o) => o.neumaId));
    const sweep = await migrateAllBeings(neumaWorkspace, { dryRun: true });

    const beings = sweep.beings
      .filter((b) => owned.has(b.neumaId))
      .map((b) => ({
        neumaId: b.neumaId,
        status: b.status, // planned | already-migrated | skipped-cannot-decrypt | no-seal
        cannotDecrypt: b.cannotDecrypt ?? 0,
      }));

    const needsMigration = beings.filter((b) => b.status === 'planned').length;
    const blocked = beings.filter((b) => b.status === 'skipped-cannot-decrypt').length;

    res.json({
      root: sweep.root,
      beings,
      needsMigration,
      blocked, // > 0 means the master key can't open some files — do NOT migrate
      ready: blocked === 0,
    });
  } catch (error) {
    log.error('Encryption plan failed', { error: error.message });
    res.status(500).json({ error: 'Could not compute the encryption plan' });
  }
});

/**
 * GET /backup-destination — where the operator's copy lands, and what that
 * actually protects against. The same-drive answer is MEASURED (`stat().dev`),
 * not inferred from the path, so the desk states a fact rather than a guess.
 *
 * The absolute path IS returned here, unlike the backup routes: this is the one
 * screen where the operator must see exactly where their copy goes. Withholding
 * it is what let […] mean nothing for so long.
 */
router.get('/backup-destination', async (req, res) => {
  try {
    if (!req.walletAddress) return res.status(401).json({ error: 'unauthenticated' });
    res.json({ destination: await assessDestination(getWorkspacesRoot()) });
  } catch (error) {
    log.error('Backup destination read', { error: error.message });
    res.status(500).json({ error: 'Could not read the backup destination' });
  }
});

/**
 * PUT /backup-destination — choose one, or clear it with null.
 *
 * A same-drive choice is ACCEPTED, not refused: some operators have one disk,
 * and refusing would leave them with nothing rather than with something
 * imperfect. It comes back marked, every time it is read. An UNWRITABLE choice
 * is refused — a backup that silently fails is worse than none, because the
 * operator believes they have one.
 */
router.put('/backup-destination', async (req, res) => {
  try {
    if (!req.walletAddress) return res.status(401).json({ error: 'unauthenticated' });
    const raw = req.body?.path;
    if (raw !== null && (typeof raw !== 'string' || !raw.trim())) {
      return res.status(400).json({ error: 'path must be a non-empty string, or null to clear' });
    }
    const chosen = raw === null ? null : raw.trim();
    if (chosen) {
      const check = await assessDestination(getWorkspacesRoot(), chosen);
      if (check.state === DESTINATION.unreachable) {
        return res.status(400).json({ error: check.reason, destination: check });
      }
    }
    await writeDestination(chosen);
    res.json({ destination: await assessDestination(getWorkspacesRoot()) });
  } catch (error) {
    log.error('Backup destination write', { error: error.message });
    res.status(500).json({ error: 'Could not set the backup destination' });
  }
});

/**
 * POST /backup — create a snapshot of the witness's beings. Copies the
 * (already-encrypted-at-rest) files, so no key handling here. Owner-scoped.
 * Lands at the operator's chosen destination when one is set (resolveBackupsRoot).
 */
router.post('/backup', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    if (!wallet) return res.status(401).json({ error: 'unauthenticated' });
    const backup = await createBackup(wallet);
    // Return only what the UI needs — never the server-side absolute path, and
    // no need to echo the wallet back at itself.
    res.status(201).json({
      backup: {
        id: backup.id,
        createdAt: backup.createdAt,
        beings: backup.beings,
        beingCount: backup.beings.length,
        sizeBytes: backup.sizeBytes,
      },
    });
  } catch (error) {
    log.error('Backup failed', { error: error.message });
    res.status(500).json({ error: 'Could not create the backup' });
  }
});

/**
 * GET /backups — list the witness's own backups, newest first.
 */
router.get('/backups', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    if (!wallet) return res.status(401).json({ error: 'unauthenticated' });
    res.json({ backups: await listBackups(wallet) });
  } catch (error) {
    log.error('Backup list failed', { error: error.message });
    res.status(500).json({ error: 'Could not list backups' });
  }
});

/**
 * DELETE /backups/:id — remove a backup the witness owns. 404 when no owned
 * backup matches (a foreign or malformed id is indistinguishable from absent —
 * never a leak of another witness's backups).
 */
router.delete('/backups/:id', async (req, res) => {
  try {
    const wallet = req.walletAddress;
    if (!wallet) return res.status(401).json({ error: 'unauthenticated' });
    const removed = await deleteBackup(wallet, req.params.id);
    if (!removed) return res.status(404).json({ error: 'Backup not found' });
    res.json({ removed: true, id: req.params.id });
  } catch (error) {
    log.error('Backup delete failed', { error: error.message });
    res.status(500).json({ error: 'Could not delete the backup' });
  }
});

export default router;
