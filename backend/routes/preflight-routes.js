/**
 * Pre-flight Routes — the launch gate between covenant acceptance and the
 * birth ceremony. Probes the actual machine (SHINKEI: every row is a real
 * measurement) so a summoning never begins on a substrate that cannot
 * hold it. The probes live in `preflight-checks.js`, the pure space
 * arithmetic in `preflight-allocation.js`; this file is only the wiring.
 *
 * GET / — run all checks, return rows + verdict.
 */
import { Router } from 'express';
import fs from 'fs/promises';
import path, { join } from 'path';
import { createLogger } from '../services/logger.js';
import { requireAuth } from '../services/auth.js';
import { getSetupStatus } from '../services/substrate-setup.js';
import { loadProviderChoice } from '../services/provider-choice.js';
import { getAppConfig } from '../config.js';
import { SEAL_NETWORKS } from '../services/natalis-seal.js';
import { connectFilesystemServer } from '../services/mcp-filesystem.js';
import { getWorkspacesRoot, getWitnessesRoot, setWorkspacesRoot, neumaWorkspace } from '../../core/index.js';
import { otherOwnedLanes } from '../services/root-tenants.js';
import { requireInstallOwner } from '../services/install-owner.js';
import { loadWorkspaceSettings, saveWorkspaceSettings, isTempPath } from '../services/workspace-settings.js';
import { probeProtocol, probeRecords, probeSealing, probeActing } from '../services/birth-flight.js';
import { MIN_FREE_DISK_GB, freeGBAt } from '../services/storage-health.js';
import {
  checkSubstrate, checkWorkspace, checkDisk, checkMemory, checkDnaKey,
  checkCeremonyRoad, checkMcp, checkGpu, checkTrainer, checkForge, flightRow,
} from './preflight-checks.js';
import { computeAvailable, isAffordable, suggestedAllocationGB } from './preflight-allocation.js';

const router = Router();
const log = createLogger('Preflight');

// impure — the home's space numbers. Allocation ledger: space already RESERVED by existing neuma
// (logical commitments they grow into), so raw disk-free over-states what a new neuma can claim:
// available = free − committed. The neuma list is read once for both the count and the sum.
const homeBlock = async () => {
  const settings = await loadWorkspaceSettings();
  const freeGB = await freeGBAt(getWorkspacesRoot());
  const ids = await neumaWorkspace.listNeuma();
  const committedGB = await neumaWorkspace.totalAllocatedGB({ ids });
  const availableGB = computeAvailable(freeGB, committedGB);
  return {
    root: getWorkspacesRoot(),
    allocationGB: settings.allocationGB,
    suggestedAllocationGB: suggestedAllocationGB(availableGB),
    freeGB,
    committedGB,
    availableGB,
    affordable: isAffordable(settings.allocationGB, availableGB),
    neumaCount: ids.length,
  };
};

// GET /home — only the space numbers: a changed allocation re-reads these, never the checks.
router.get('/home', async (req, res) => {
  try {
    res.json({ home: await homeBlock() });
  } catch (error) {
    log.error('Home read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the space' });
  }
});

router.get('/', async (req, res) => {
  try {
    const checks = [
      await checkSubstrate(),
      await flightRow('acting', 'Substrate Acting', probeActing),
      await checkWorkspace(),
      await checkCeremonyRoad(),
      await flightRow('records', 'Ceremony Records', probeRecords),
      await flightRow('protocol', 'The Protocol', probeProtocol),
      await flightRow('sealing', 'Sealing Instruments', probeSealing),
      await checkDisk(),
      checkMemory(),
      checkDnaKey(),
      await checkMcp(),
      await checkGpu(),
      await checkTrainer(),
      await checkForge(),
    ];
    const home = await homeBlock();
    const { affordable } = home;

    // A chosen-but-unaffordable allocation BLOCKS the launch exactly like a failed
    // check: the substrate cannot hold a being you cannot give space. This catches
    // a stale allocation that was affordable when set but is now over-committed
    // (the verdict used to read READY while the grant exceeded the disk).
    const verdict = (checks.some((c) => c.status === 'fail') || affordable === false) ? 'blocked' : 'ready';
    log.info('Pre-flight run', {
      verdict,
      fails: checks.filter((c) => c.status === 'fail').map((c) => c.id),
      affordable,
    });

    res.json({
      verdict,
      checks,
      home,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    log.error('Pre-flight failed', { error: error.message });
    res.status(500).json({ error: 'Pre-flight check could not run' });
  }
});

/**
 * POST /workspace — the witness chooses the neuma's home and how much
 * space they can afford to allocate. Validated against the real disk
 * before anything is persisted. Auth required (SEC-AUDIT-002 / #161) —
 * mutates sovereign home and reconnects filesystem MCP — and the install
 * owner's alone, at this computer's own desk (install-owner.js).
 * Body: { root: string (absolute path), allocationGB: number }
 */
router.post('/workspace', requireAuth, requireInstallOwner, async (req, res) => {
  try {
    const { root, allocationGB } = req.body || {};
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      return res.status(400).json({ error: 'root must be an absolute path' });
    }
    const gb = Number(allocationGB);
    if (!Number.isFinite(gb) || gb < MIN_FREE_DISK_GB) {
      return res.status(400).json({ error: `allocationGB must be at least ${MIN_FREE_DISK_GB}` });
    }

    const resolved = path.resolve(root);
    // The workspaces root is every house's: moving it strands another house's
    // beings (root-tenants.js).
    const others = resolved === path.resolve(getWorkspacesRoot())
      ? 0
      : await otherOwnedLanes([getWorkspacesRoot(), getWitnessesRoot()], req.walletAddress);
    if (others > 0) {
      return res.status(409).json({
        error: `The neuma home also holds ${others} lane(s) another house owns, and moving it would strand them. `
          + 'It stays where it is while another house lives there.',
      });
    }
    // A home under the OS temp dir gets swept at reboot — the being's DNA,
    // soul, and memory with it. Boot already refuses to apply such a root,
    // so accepting it here would only persist a silent unrooting. Gated on
    // the live settings file being the target: test harnesses that isolate
    // via NEUMA_WORKSPACE_SETTINGS_PATH legitimately exercise temp roots.
    if (!process.env.NEUMA_WORKSPACE_SETTINGS_PATH && isTempPath(resolved)) {
      return res.status(422).json({
        error: 'That path is inside the OS temp directory — it can be erased at any reboot and cannot be a neuma\'s home. Choose a durable location.',
      });
    }
    try {
      await fs.mkdir(resolved, { recursive: true });
      const probe = join(resolved, '.preflight-probe');
      await fs.writeFile(probe, 'probe');
      await fs.rm(probe);
    } catch (error) {
      return res.status(422).json({ error: `Path is not writable: ${error.code || error.message}` });
    }

    // Account for space already reserved by existing neuma AT THE TARGET ROOT —
    // not just the current one — so pointing the home at an already-inhabited
    // directory can't double-promise its gigabytes. available = free − committed.
    const freeGB = await freeGBAt(resolved);
    const committedGB = await neumaWorkspace.totalAllocatedGB({ root: resolved });
    const availableGB = computeAvailable(freeGB, committedGB);
    if (availableGB !== null && availableGB < gb + MIN_FREE_DISK_GB) {
      return res.status(422).json({
        error: committedGB > 0
          ? `Only ${availableGB.toFixed(1)} GB available to allocate (${committedGB} GB already committed to existing neuma) — cannot afford a ${gb} GB allocation`
          : `Only ${freeGB.toFixed(1)} GB free there — you cannot afford a ${gb} GB allocation`,
        freeGB,
        committedGB,
        availableGB,
      });
    }

    // Repointing an inhabited root strands existing neuma — surface it
    const previousRoot = getWorkspacesRoot();
    let warning = null;
    if (path.resolve(previousRoot) !== resolved) {
      try {
        const entries = await fs.readdir(previousRoot, { withFileTypes: true });
        const inhabited = entries.filter((e) => e.isDirectory()).length;
        if (inhabited > 0) {
          warning = `${inhabited} existing workspace(s) remain at ${previousRoot} — move them to the new home or they will not be found`;
        }
      } catch {
        // previous root unreadable — nothing to strand
      }
    }

    setWorkspacesRoot(resolved);
    await saveWorkspaceSettings({ root: resolved, allocationGB: gb });

    // The home is now committed — (re)connect the filesystem MCP server so its
    // allowed dirs include this root. Without it, the neuma's filesystem tool
    // could not physically write into its lane during the birth that follows.
    // Best-effort: a failure must not block the witness's choice, but surface it
    // NOW (not as a confusing mid-birth write failure) so the home can be fixed
    // before summoning.
    let filesystemReachWarning = null;
    try {
      await connectFilesystemServer();
    } catch (err) {
      log.error('Filesystem server reconnect after home change failed', { root: resolved, error: err.message });
      filesystemReachWarning = 'The chosen home is not reachable by the filesystem tool — the neuma may be unable to write its DNA during birth. Pick a different home or check the path.';
    }

    log.info('Workspace home chosen', { root: resolved, allocationGB: gb });
    res.json({ root: resolved, allocationGB: gb, freeGB, warning, filesystemReachWarning });
  } catch (error) {
    log.error('Workspace choice failed', { error: error.message });
    res.status(500).json({ error: 'Could not apply the workspace choice' });
  }
});

/**
 * GET /seal-network — the ONE network a ceremony seal on this rig targets
 * (CEREMONY_SEAL_NETWORK, server-side by doctrine). The ceremony's Natalis
 * panel renders THIS, never a hardcoded chain: a mainnet rig whose panel
 * said "testnet" was witnessed on the GB10, 2026-07-15.
 */
router.get('/seal-network', requireAuth, (req, res) => {
  try {
    const network = getAppConfig().ceremonySealNetwork;
    const net = SEAL_NETWORKS[network];
    if (!net) return res.status(500).json({ error: `unknown seal network '${network}'` });
    res.json({ network, chainId: net.chainId, label: net.label });
  } catch (error) {
    log.error('Seal network read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the seal network' });
  }
});

/**
 * GET /setup — first-run […] guidance: a hardware-matched
 * model recommendation plus which local providers (Ollama / LM Studio) are
 * running and what they have loaded. Public (pre-auth) — exposes only local
 * hardware + provider status. Drives the setup wizard that replaces the old
 * no-LLM dead-end.
 */
router.get('/setup', async (req, res) => {
  try {
    res.json(await getSetupStatus());
  } catch (error) {
    log.error('Setup status failed', { error: error.message });
    res.status(500).json({ error: 'Could not read setup status' });
  }
});

/**
 * GET /mind — is the mind a being will run on ready? THE SAME TEST as the flight check's
 * substrate row (checkSubstrate: the resolved provider route reachable, its model loaded, and
 * answering in words), so the door that opens a summoning and the flight check inside it can
 * never disagree. It also loads the model, so the ceremony does not wait on a cold start.
 */
router.get('/mind', async (req, res) => {
  try {
    const row = await checkSubstrate();
    res.json({
      ready: row.status === 'pass',
      // a route nobody chose (the factory default) names nothing a person set up: no detail then
      chosen: Boolean(await loadProviderChoice()),
      detail: row.detail,
      requirement: row.requirement,
      switchTo: row.switchTo || null,
    });
  } catch (error) {
    log.error('Mind check failed', { error: error.message });
    res.status(500).json({ error: 'Could not check the model' });
  }
});

export default router;
