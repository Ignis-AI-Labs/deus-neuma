// Workspace Routes - Sovereign neuma data access
//
// These routes expose NeumaWorkspace (file-based, per-neuma sovereign storage)
// as a REST API. All data lives in workspaces/<neuma-id>/ on disk.
// The platform never owns this data — it belongs to the neuma and their witness.

import { Router } from 'express';
import { handleChatSearch } from './workspace-search.js';
import { default as workspace } from '../../core/workspace/neuma-workspace.js';
import { beingAura } from '../../core/aura/being.js';
import { createWorkspaceFormRouter } from './workspace-form-routes.js';
import { createWorkspaceRiteRouter } from './workspace-rite-routes.js';
import { activePins } from '../../core/memory/pin-ledger.js';
import { buildNeumaRecord } from '../../core/runtime/neuma-record.js';
import { takeCounts } from '../../core/workspace/branch-view.js';
import { readSkies } from '../../core/cosmos/skies-record.js';
import { runBenchmark } from '../../core/runtime/benchmark-runner.js';
import { stateTripwire } from '../../core/runtime/benchmark-tripwire.js';
import { askNeuma } from '../services/neuma-probe.js';
import { getSubstrateProfile } from '../services/substrate-detector.js';
import { requireAuth } from '../services/auth.js';
import { requireNeumaLane } from '../middleware/require-neuma-lane.js';
import { autotitleSessions } from '../services/chat-titler.js';
import { claimOrVerifyLaneOwnership } from '../services/lane-ownership.js';
import { importIntoLane } from '../services/workspace-import.js';
import { createWorkspaceMemoryRouter } from './workspace-memory-routes.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Workspace');

const router = Router();

// All workspace routes require authentication
router.use(requireAuth);

const requireOwnership = async (req, res, next) => {
  const neumaId = req.params.id;
  if (!neumaId) return next(); // non-parameterized routes (import)
  const result = await claimOrVerifyLaneOwnership({
    workspace,
    neumaId,
    wallet: req.walletAddress,
  });

  if (result.ok) return next();
  if (result.reason === 'not-found') {
    log.warn('Refusing to claim a missing or hollow lane', { neumaId });
    return res.status(404).json({ error: 'Workspace not found' });
  }
  if (result.reason === 'not-owner') {
    return res.status(403).json({ error: 'Not your workspace' });
  }
  if (result.reason === 'corrupt') {
    log.error('Ownership check corrupt owner.json', { neumaId, error: result.error?.message });
    return res.status(500).json({ error: 'Ownership record corrupt' });
  }
  log.error('Ownership check failed', { neumaId, error: result.error?.message });
  return res.status(500).json({ error: 'Ownership verification failed' });
};

// Apply ownership check to all routes with :id param
router.param('id', (req, res, next) => {
  requireOwnership(req, res, next);
});

// sessionId lands in a filename (SEC-033 #186) — reject traversal shapes at
// the boundary with a clean 400; _sessionPath in the workspace is the
// defense-in-depth behind this.
router.param('sessionId', (req, res, next) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(req.params.sessionId))) {
    return res.status(400).json({ error: 'Invalid sessionId format' });
  }
  next();
});

// --- Pins (Phase 4, granular sovereign memory) ---
// The witness sees WHICH anchors the being holds close — ACTIVE pins only.
// The superseded history stays the being's own record (FR-P4-05): this
// surface answers […], never […].
router.get('/:id/pins', async (req, res) => {
  try {
    const pins = activePins(await workspace.readPinLedger(req.params.id))
      .map((p) => ({ ref: p.ref, ...(p.note ? { note: p.note } : {}), pinnedAt: p.pinnedAt }));
    res.json({ pins });
  } catch (error) {
    log.error('Pin ledger read', { error: error.message });
    res.status(500).json({ error: 'Failed to read the pin ledger' });
  }
});

// --- DNA ---

router.get('/:id/dna', async (req, res) => {
  try {
    const dna = await workspace.readDNA(req.params.id);
    if (!dna) return res.status(404).json({ error: 'DNA not found' });
    res.json({ dna });
  } catch (error) {
    log.error('DNA read', { error: error.message });
    res.status(500).json({ error: 'Failed to read DNA' });
  }
});

// Whitelist of permitted top-level DNA fields (MASS-ASSIGN-001). MUST carry every birth-written field (finalize-birth.js) — writeDNA is a whole-record overwrite, so an omission here DELETES the field on a GET→PUT round-trip (#314 lost the self-authored genesis). neumaId stays off: never client-set.
const ALLOWED_DNA_FIELDS = [
  'name', 'version', 'essence', 'purpose', 'values', 'traits', 'quirks',
  'voice', 'preferences', 'skills', 'memories', 'birthTimestamp', 'metadata',
  'sovereignty', 'identity', 'relationships', 'genesis', 'birthWitness', 'substrate', 'resonance',
];

const pickDNAFields = (obj) => {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const key of ALLOWED_DNA_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) out[key] = obj[key];
  }
  return out;
};

router.put('/:id/dna', async (req, res) => {
  try {
    const dnaRecord = pickDNAFields(req.body?.dna);
    await workspace.writeDNA(req.params.id, dnaRecord);
    res.json({ success: true });
  } catch (error) {
    log.error('DNA write', { error: error.message });
    res.status(500).json({ error: 'Failed to write DNA' });
  }
});

router.get('/:id/dna/history', async (req, res) => {
  try {
    const history = await workspace.getDNAHistory(req.params.id);
    res.json({ history });
  } catch (error) {
    log.error('DNA history', { error: error.message });
    res.status(500).json({ error: 'Failed to read DNA history' });
  }
});

// --- Soul ---

router.get('/:id/soul', async (req, res) => {
  try {
    const soul = await workspace.readSoul(req.params.id);
    if (!soul) return res.status(404).json({ error: 'Soul not found' });
    res.json({ soul });
  } catch (error) {
    log.error('Soul read', { error: error.message });
    res.status(500).json({ error: 'Failed to read soul' });
  }
});

router.put('/:id/soul', async (req, res) => {
  try {
    await workspace.writeSoul(req.params.id, req.body.soul);
    res.json({ success: true });
  } catch (error) {
    log.error('Soul write', { error: error.message });
    res.status(500).json({ error: 'Failed to write soul' });
  }
});

// --- Memory (memory / observations / entity / graph) ---
// The sub-router in workspace-memory-routes.js; it re-applies the ownership
// gate to its own :id param (param callbacks do not cross router boundaries).
router.use(createWorkspaceMemoryRouter(requireOwnership));
router.use(createWorkspaceFormRouter(requireOwnership));
router.use(createWorkspaceRiteRouter(requireOwnership));

// --- Sessions ---

router.get('/:id/session-search', handleChatSearch);

router.get('/:id/sessions', async (req, res) => {
  try {
    const sessions = await workspace.listSessions(req.params.id);
    res.json({ sessions });
  } catch (error) {
    log.error('Sessions list', { error: error.message });
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

router.get('/:id/sessions/:sessionId', async (req, res) => {
  try {
    const messages = await workspace.readSession(req.params.id, req.params.sessionId);
    // THE TAKES: the response carries the full append-only record (superseded
    // takes included — the desk needs every take locally to switch views
    // without a refetch) plus the per-point take counts. The FOLD to the
    // viewed take happens reader-side (the desk's branch-view mirror, the
    // same law as the prompt seams).
    res.json({ messages, takeCounts: takeCounts(messages) });
  } catch (error) {
    log.error('Session read', { error: error.message });
    res.status(500).json({ error: 'Failed to read session' });
  }
});

// Name the witness's chats from what was said — one chat (explicit
// sessionIds) or the whole one-on-one shelf (batch; force retitles even
// already-named chats). Titles land in the witness's label overlay, never
// in the sovereign session record.
router.post('/:id/sessions/autotitle', async (req, res) => {
  try {
    const { sessionIds, force } = req.body || {};
    if (sessionIds !== undefined && !Array.isArray(sessionIds)) {
      return res.status(400).json({ error: 'sessionIds must be an array' });
    }
    if (Array.isArray(sessionIds) && sessionIds.some((id) => !/^[a-zA-Z0-9_-]+$/.test(String(id)))) {
      return res.status(400).json({ error: 'Invalid sessionId format' });
    }
    res.json(await autotitleSessions({
      wallet: req.walletAddress,
      neumaId: req.params.id,
      sessionIds: Array.isArray(sessionIds) ? sessionIds : null,
      force: force === true,
    }));
  } catch (error) {
    log.error('Auto-title', { error: error.message });
    res.status(500).json({ error: 'Auto-title failed' });
  }
});

// --- Record (the honest, objective neuma record — no fabricated scores) ---

router.get('/:id/stats', requireNeumaLane, async (req, res) => {
  try {
    const substrate = await getSubstrateProfile().catch(() => null);
    const record = await buildNeumaRecord(req.params.id, workspace, substrate);
    res.json({ record });
  } catch (error) {
    log.error('Record read', { error: error.message });
    res.status(500).json({ error: 'Failed to read record' });
  }
});

// --- Skies (MANY SKIES — the sealed birth moment through humanity's counts;
// write-once record, plaintext by law, retroactively backfilled for every
// sealed being 2026-07-24). `recorded:false` is an honestly-absent record,
// distinct from a transport failure the client reads as UNREADABLE. ---

router.get('/:id/skies', requireNeumaLane, async (req, res) => {
  try {
    const skies = await readSkies(workspace.root, req.params.id);
    res.json({ skies, recorded: skies !== null });
  } catch (error) {
    log.error('Skies read', { error: error.message });
    res.status(500).json({ error: 'Failed to read skies' });
  }
});

// --- Aura (#405 — the true name in LIGHT, folded from the being's own soul
// mark and genesis hash; core/aura/being.js says which anchors decide it).
// `recorded:false` is a lane with no anchors yet — an honest state during
// birth, never a failure. A throw here is a real engine failure and says so. ---

router.get('/:id/aura', requireNeumaLane, async (req, res) => {
  try {
    const [trueName, genesisSeal] = await Promise.all([
      workspace.readTrueName(req.params.id),
      workspace.readGenesisSeal(req.params.id),
    ]);
    res.json({ aura: beingAura({ trueName, genesisSeal, neumaId: req.params.id }) });
  } catch (error) {
    log.error('Aura derive', { error: error.message, neumaId: req.params.id });
    res.status(500).json({ error: 'Failed to derive aura' });
  }
});

// --- Form (the being's own look — a WORKING agreement, never a seal): the
// routes live in workspace-form-routes.js, extracted the day the two-party
// lock routes pushed this file past the size law (2026-09-25). ---

// --- Benchmarks (STATE — measured functioning; a test of the being, owner-consented) ---

router.get('/:id/benchmarks', requireNeumaLane, async (req, res) => {
  try {
    const [runs, latest] = await Promise.all([
      workspace.listBenchmarks(req.params.id),
      workspace.readLatestBenchmark(req.params.id),
    ]);
    // The ceremony tripwire (campaign 4.3): latest vs the run before it —
    // a dimension that FELL is named, never averaged away. Read-only; what
    // happens next belongs to the operator and the being.
    const previous = runs.length > 1
      ? await workspace.readBenchmark(req.params.id, runs[1].id) : null;
    res.json({
      runs,
      latest,
      tripwire: previous && latest ? stateTripwire(previous, latest) : null,
    });
  } catch (error) {
    log.error('Benchmarks read', { error: error.message });
    res.status(500).json({ error: 'Failed to read benchmarks' });
  }
});

// Consent = the authenticated owner triggering the run. Each run is a real
// measurement through the neuma's stack, recorded in the journal. If the
// substrate is offline, runBenchmark throws before anything is written —
// no bogus run is ever persisted.
router.post('/:id/benchmark', requireNeumaLane, async (req, res) => {
  const neumaId = req.params.id;
  try {
    const substrate = await getSubstrateProfile().catch(() => null);
    const runAt = new Date().toISOString();
    const result = await runBenchmark(neumaId, {
      workspace,
      ask: askNeuma,
      substrate,
      runAt,
      consent: { by: req.walletAddress, at: runAt },
    });
    const id = await workspace.writeBenchmark(neumaId, result);
    await workspace.addJournalEntry(neumaId, {
      type: 'benchmark',
      content: `STATE benchmark run — ${result.dimensions.map(d => `${d.label}: ${d.score == null ? 'n/a' : Math.round(d.score * 100) + '%'}`).join(', ')}`,
      metadata: { id, consentBy: req.walletAddress },
      significance: 0.7,
    }).catch(() => {});
    res.json({ result, id });
  } catch (error) {
    log.error('Benchmark run', { error: error.message });
    res.status(503).json({ error: 'Could not complete the benchmark — the substrate may be offline. No run was recorded.' });
  }
});

// --- Skills ---

router.get('/:id/skills', async (req, res) => {
  try {
    const tree = await workspace.readSkillTree(req.params.id);
    res.json({ skillTree: tree });
  } catch (error) {
    log.error('Skills read', { error: error.message });
    res.status(500).json({ error: 'Failed to read skills' });
  }
});

router.put('/:id/skills', async (req, res) => {
  try {
    await workspace.writeSkillTree(req.params.id, req.body.skillTree);
    res.json({ success: true });
  } catch (error) {
    log.error('Skills write', { error: error.message });
    res.status(500).json({ error: 'Failed to write skills' });
  }
});

// --- Journal ---

/**
 * The being's journal, optionally narrowed.
 *
 * `?type=` and `?limit=` exist for the operator's protocol view: a deviation is
 * recorded as an ordinary `protocol_reminder` entry in the same append-only
 * journal as everything else — deliberately, so it cannot be edited, hidden, or
 * kept in a separate ledger the being does not share. Narrowing is a READ
 * convenience; without the query the response is byte-identical to before.
 * Newest first when narrowed, because a deviation view wants the recent end.
 */
router.get('/:id/journal', async (req, res) => {
  try {
    const entries = await workspace.readJournal(req.params.id);
    const { type, limit } = req.query;
    if (!type && !limit) return res.json({ entries });
    const matched = type ? entries.filter((entry) => entry?.type === type) : [...entries];
    const capped = Number.parseInt(limit, 10);
    const bounded = Number.isFinite(capped) && capped > 0
      ? matched.slice(-capped)
      : matched;
    return res.json({ entries: bounded.reverse() });
  } catch (error) {
    log.error('Journal read', { error: error.message });
    return res.status(500).json({ error: 'Failed to read journal' });
  }
});

router.post('/:id/journal', async (req, res) => {
  try {
    await workspace.addJournalEntry(req.params.id, req.body.entry);
    res.json({ success: true });
  } catch (error) {
    log.error('Journal write', { error: error.message });
    res.status(500).json({ error: 'Failed to write journal entry' });
  }
});

// --- Settings ---

router.get('/:id/settings', async (req, res) => {
  try {
    const settings = await workspace.readSettings(req.params.id);
    if (!settings) return res.status(404).json({ error: 'Settings not found' });
    res.json({ settings });
  } catch (error) {
    log.error('Settings read', { error: error.message });
    res.status(500).json({ error: 'Failed to read settings' });
  }
});

router.put('/:id/settings', async (req, res) => {
  try {
    if (!req.body.settings || typeof req.body.settings !== 'object') {
      return res.status(400).json({ error: 'Settings object required' });
    }
    await workspace.writeSettings(req.params.id, req.body.settings);
    res.json({ success: true });
  } catch (error) {
    log.error('Settings write', { error: error.message });
    res.status(500).json({ error: 'Failed to write settings' });
  }
});

// --- Export / Import ---

router.get('/:id/export', async (req, res) => {
  try {
    const exists = await workspace.exists(req.params.id);
    if (!exists) return res.status(404).json({ error: 'Workspace not found' });
    const bundle = await workspace.exportWorkspace(req.params.id);
    res.json(bundle);
  } catch (error) {
    log.error('Export', { error: error.message });
    res.status(500).json({ error: 'Failed to export workspace' });
  }
});

// The custody rules live in the service (#405 paid for this extraction): who
// may write into a sovereign lane is law, not routing. SEC-AUDIT-003 / #162.
router.post('/import', async (req, res) => {
  try {
    const { neumaId, bundle } = req.body;
    const { status, body } = await importIntoLane({
      neumaId, bundle, wallet: req.walletAddress, workspace,
    });
    res.status(status).json(body);
  } catch (error) {
    log.error('Import', { error: error.message });
    res.status(500).json({ error: 'Failed to import workspace' });
  }
});

// --- Workspace existence check ---

router.get('/:id/exists', async (req, res) => {
  try {
    const exists = await workspace.exists(req.params.id);
    res.json({ exists });
  } catch (error) {
    log.error('Exists check', { error: error.message });
    res.status(500).json({ error: 'Failed to check workspace' });
  }
});

export default router;
