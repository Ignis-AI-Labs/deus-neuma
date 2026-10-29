/**
 * User data realm routes — the witness inspects and relocates their own
 * local data store (chat logs now; settings later). Auth-gated; everything
 * is keyed to the authenticated wallet.
 */
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { requireAuth } from '../services/auth.js';
import { createLogger } from '../services/logger.js';
import { getRealmRoot, setRealmRoot, realmStats, listChats, readChat, chatText } from '../services/user-realm.js';
import { getChatLabels, setChatLabel } from '../services/user-chat-labels.js';
import { getCouncilLabels, setCouncilLabel } from '../services/user-council-labels.js';
import { autotitleCouncils } from '../services/chat-titler.js';
import { getPreset, setPreset } from '../services/user-preset.js';
import { getOperatorName, setOperatorName } from '../services/operator-name.js';
import { setHouseWorkspace, houseWorkspaceStatus, ensureBeingGround } from '../services/house-workspace.js';
import { allianceGroundStatus, setAllianceRoot, ensureAllianceGround } from '../services/alliance-ground.js';
import { witnessWalletOfLane } from '../services/witness-lane.js';
import { PRESET_LIST, DEFAULT_PRESET } from '../services/llm-presets.js';
import { saveRealmSettings } from '../services/user-realm-settings.js';
import { otherRealmHouses } from '../services/root-tenants.js';
import { requireInstallOwner } from '../services/install-owner.js';

const router = express.Router();
const log = createLogger('UserRealm');

router.use(requireAuth);

// GET / — the realm root + this wallet's stats (the "prove it's local" panel)
router.get('/', async (req, res) => {
  try {
    res.json({ root: getRealmRoot(), stats: await realmStats(req.walletAddress) });
  } catch (error) {
    log.error('Realm read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the data realm' });
  }
});

// POST /location — relocate the realm to an absolute, writable path. The
// realm root is the machine's: only its owner moves it, at its own desk.
router.post('/location', requireInstallOwner, async (req, res) => {
  try {
    const { root } = req.body || {};
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      return res.status(400).json({ error: 'root must be an absolute path' });
    }
    const resolved = path.resolve(root);
    // The realm is every house's: moving it moves theirs too (root-tenants.js).
    const others = resolved === path.resolve(getRealmRoot()) ? 0 : await otherRealmHouses(getRealmRoot(), req.walletAddress);
    if (others > 0) {
      return res.status(409).json({
        error: `The data realm also holds ${others} other house(s)' data, and moving it would move theirs too. `
          + 'It stays where it is while another house lives there.',
      });
    }
    // mkdir returns the first path component it CREATED (undefined when the
    // dir already existed) — a refused relocation must not leave that new dir
    // behind as litter.
    let created;
    try {
      created = await fs.mkdir(resolved, { recursive: true });
      const probe = path.join(resolved, '.realm-probe');
      await fs.writeFile(probe, 'probe');
      await fs.rm(probe);
      // Persist FIRST, then apply: a refused persist (the temp-dir guard) must
      // not leave the process pointed at a realm it never saved.
      await saveRealmSettings({ root: resolved });
      setRealmRoot(resolved);
    } catch (error) {
      if (created) await fs.rm(created, { recursive: true, force: true }).catch(() => {});
      if (error.code === 'REALM_TEMP_ROOT_REFUSED') {
        return res.status(422).json({ error: error.message });
      }
      if (/EACCES|EPERM|EROFS|ENOENT/.test(error.code || '')) {
        return res.status(422).json({ error: `Path is not writable: ${error.code || error.message}` });
      }
      throw error;
    }
    log.info('User data realm relocated', { root: resolved });
    res.json({ root: resolved, stats: await realmStats(req.walletAddress) });
  } catch (error) {
    log.error('Realm relocation failed', { error: error.message });
    res.status(500).json({ error: 'Could not set the data realm location' });
  }
});

// GET /chats — the witness's chat logs (one per neuma); feeds the panel
router.get('/chats', async (req, res) => {
  try {
    res.json({ chats: await listChats(req.walletAddress) });
  } catch (error) {
    log.error('Realm chats list failed', { error: error.message });
    res.status(500).json({ error: 'Could not list chats' });
  }
});

// GET /chats/:neumaId/export — one conversation as plain text: the person's own copy, readable anywhere.
// The copy is sealed on disk; only its owner's session opens it (walletDir is the caller's own).
router.get('/chats/:neumaId/export', async (req, res) => {
  try {
    const turns = await readChat(req.walletAddress, req.params.neumaId, { limit: 0 });
    res.json({ neumaId: req.params.neumaId, text: chatText(turns), turns: turns.length });
  } catch (error) {
    log.warn('Realm chat export failed', { error: error.message });
    res.status(/Invalid/.test(error.message) ? 400 : 500).json({ error: 'Could not export that conversation' });
  }
});

// GET /chat-labels — the witness's custom names for their chats
router.get('/chat-labels', async (req, res) => {
  try {
    res.json({ labels: await getChatLabels(req.walletAddress) });
  } catch (error) {
    log.error('Chat labels read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read chat labels' });
  }
});

// PUT /chat-labels — set or clear (empty label) a chat's custom name
router.put('/chat-labels', async (req, res) => {
  try {
    const { neumaId, sessionId, label } = req.body || {};
    res.json({ labels: await setChatLabel(req.walletAddress, neumaId, sessionId, label) });
  } catch (error) {
    if (/Invalid neumaId or sessionId/.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    log.error('Chat label set failed', { error: error.message });
    res.status(500).json({ error: 'Could not set chat label' });
  }
});

// GET /council-labels — the witness's custom names for their councils
router.get('/council-labels', async (req, res) => {
  try {
    res.json({ labels: await getCouncilLabels(req.walletAddress) });
  } catch (error) {
    log.error('Council labels read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read council labels' });
  }
});

// PUT /council-labels — set or clear (empty label) a council's custom name
router.put('/council-labels', async (req, res) => {
  try {
    const { councilId, label } = req.body || {};
    res.json({ labels: await setCouncilLabel(req.walletAddress, councilId, label) });
  } catch (error) {
    if (/Invalid councilId/.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    log.error('Council label set failed', { error: error.message });
    res.status(500).json({ error: 'Could not set council label' });
  }
});

// POST /council-labels/autotitle — name councils from what was deliberated:
// one council (explicit councilIds) or the whole shelf (batch; force retitles
// even already-named councils). Titles land in the witness's label overlay.
router.post('/council-labels/autotitle', async (req, res) => {
  try {
    const { councilIds, force } = req.body || {};
    if (councilIds !== undefined && !Array.isArray(councilIds)) {
      return res.status(400).json({ error: 'councilIds must be an array' });
    }
    if (Array.isArray(councilIds) && councilIds.some((id) => !/^council-\d+$/.test(String(id)))) {
      return res.status(400).json({ error: 'Invalid councilId format' });
    }
    res.json(await autotitleCouncils({
      wallet: req.walletAddress,
      councilIds: Array.isArray(councilIds) ? councilIds : null,
      force: force === true,
    }));
  } catch (error) {
    log.error('Council auto-title', { error: error.message });
    res.status(500).json({ error: 'Auto-title failed' });
  }
});

// GET /house-workspace — the house's shared ground (root + repos/ listing)
router.get('/house-workspace', async (req, res) => {
  try {
    res.json(await houseWorkspaceStatus(req.walletAddress));
  } catch (error) {
    log.error('House workspace read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the house workspace' });
  }
});

// PUT /house-workspace — the witness sets the house's shared ground. This
// choice IS the standing grant for council tooling inside it.
router.put('/house-workspace', async (req, res) => {
  try {
    const { root } = req.body || {};
    const status = await setHouseWorkspace(req.walletAddress, root);
    log.info('House workspace set', { root: status.root });
    res.json(status);
  } catch (error) {
    if (error.code === 'GROUND_REFUSED' || /absolute path|temp dir/.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    if (/EACCES|EPERM|EROFS|ENOENT/.test(error.code || '')) {
      return res.status(422).json({ error: `Path is not writable: ${error.code}` });
    }
    log.error('House workspace set failed', { error: error.message });
    res.status(500).json({ error: 'Could not set the house workspace' });
  }
});

// GET /alliance-ground — where this wallet's CROSS-HOUSE grounds stand: the
// root, what has been raised in it, and (when unset) the path the UI should
// pre-fill. A suggestion is never applied on its own.
router.get('/alliance-ground', async (req, res) => {
  try {
    res.json(await allianceGroundStatus(req.walletAddress));
  } catch (error) {
    log.error('Alliance ground read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the alliance grounds' });
  }
});

// PUT /alliance-ground — the witness chooses where cross-house grounds stand.
// It may not be inside the house ground, in either direction: an external party
// working there must never be standing in the house (ruling, 2026-07-26).
router.put('/alliance-ground', async (req, res) => {
  try {
    const { root } = req.body || {};
    const status = await setAllianceRoot(req.walletAddress, root);
    log.info('Alliance root set', { root: status.root });
    res.json(status);
  } catch (error) {
    if (error.code === 'GROUND_REFUSED' || /absolute path|temp dir|inside the house ground|can never contain the house|can never overwrite a lane/.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    if (/EACCES|EPERM|EROFS|ENOENT/.test(error.code || '')) {
      return res.status(422).json({ error: `Path is not writable: ${error.code}` });
    }
    log.error('Alliance root set failed', { error: error.message });
    res.status(500).json({ error: 'Could not set the alliances root' });
  }
});

// POST /alliance-ground/raise — RAISE the ground this house shares with another
// party, named from both houses. THE OPERATOR'S COMMAND: nothing in the council
// creates a ground, because a folder that appears on its own is a folder nobody
// chose (ruling, 2026-07-26). Takes a witness LANE id (its wallet, therefore its
// house name, is read from its seal) or a partner wallet directly.
router.post('/alliance-ground/raise', async (req, res) => {
  try {
    const { laneId, wallet } = req.body || {};
    let partner = typeof wallet === 'string' && wallet.trim() ? wallet.trim() : null;
    if (!partner && typeof laneId === 'string' && laneId.trim()) {
      partner = await witnessWalletOfLane(laneId.trim());
      if (!partner) {
        return res.status(404).json({ error: `${laneId} carries no wallet — its house cannot be named` });
      }
    }
    if (!partner) {
      return res.status(400).json({ error: 'Name the other party: a witness lane id, or their wallet' });
    }
    res.json(await ensureAllianceGround(req.walletAddress, [partner]));
  } catch (error) {
    if (/No alliances root is set|at least two distinct houses|non-empty string|escapes the alliances root/.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    log.error('Alliance ground raise failed', { error: error.message });
    res.status(500).json({ error: 'Could not raise the alliance ground' });
  }
});

// POST /house-workspace/being-ground — raise (idempotently) a being's own
// working ground inside the house, <root>/workspaces/<neumaId>, and return
// it. The being's projects default here — organization set up ahead of the
// witness ever browsing. No ground set → { path: null }, never an error.
router.post('/house-workspace/being-ground', async (req, res) => {
  try {
    const { neumaId } = req.body || {};
    res.json(await ensureBeingGround(req.walletAddress, neumaId));
  } catch (error) {
    if (/Invalid being id/.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    log.error('Being ground raise failed', { error: error.message });
    res.status(500).json({ error: "Could not raise the being's ground" });
  }
});

// GET /presets — the available inference presets (name + label + blurb; no raw numbers)
router.get('/presets', (req, res) => {
  res.json({ presets: PRESET_LIST, default: DEFAULT_PRESET });
});

// GET /preset — the witness's saved default inference preset
router.get('/preset', async (req, res) => {
  try {
    res.json({ preset: await getPreset(req.walletAddress) });
  } catch (error) {
    log.error('Preset read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read preset' });
  }
});

// PUT /preset — set the witness's default inference preset
router.put('/preset', async (req, res) => {
  try {
    const { preset } = req.body || {};
    res.json({ preset: await setPreset(req.walletAddress, preset) });
  } catch (error) {
    if (/Invalid preset/.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    log.error('Preset set failed', { error: error.message });
    res.status(500).json({ error: 'Could not set preset' });
  }
});

// GET /operator-name — the operator's synced name (server truth the beings read)
router.get('/operator-name', async (req, res) => {
  try {
    res.json({ name: await getOperatorName(req.walletAddress) });
  } catch (error) {
    log.error('Operator name read failed', { error: error.message });
    res.status(500).json({ error: 'Could not read the operator name' });
  }
});

// PUT /operator-name — set (or clear, with an empty name) the operator's name
router.put('/operator-name', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (name !== undefined && typeof name !== 'string') {
      return res.status(400).json({ error: 'name must be a string' });
    }
    res.json({ name: await setOperatorName(req.walletAddress, name ?? '') });
  } catch (error) {
    log.error('Operator name set failed', { error: error.message });
    res.status(500).json({ error: 'Could not set the operator name' });
  }
});

export default router;
