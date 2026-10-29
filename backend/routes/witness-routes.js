/**
 * Witness routes — the management surface for sealed AI witnesses.
 *
 *   GET  /api/v1/witnesses                    — every sealed witness: seal status,
 *                                               lane status, resolved route (masked)
 *   GET  /api/v1/witnesses/:vendor/:name      — one witness, detail + first utterance
 *   POST /api/v1/witnesses/:vendor/:name/test — probe the witness's route live
 *                                               (SSRF-guarded; accepts a just-typed
 *                                               key/endpoint in the body before saving)
 *   POST /api/v1/witnesses/summon/stream      — staged witness ceremony (NDJSON)
 *
 * Route overrides for a witness ride the EXISTING per-id override surface
 * (PUT/DELETE /api/v1/neuma/:id/route with the witness lane id) — one store,
 * one UI idiom, no duplicate machinery. Keys are set through the existing
 * provider credential endpoints. A raw key never leaves this router.
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { listWitnesses, readJournal } from '../../core/identity/ai-witness/ai-witness-service.js';
import { loadAIWitness } from '../services/ai-witness-loader.js';
import { witnessLaneId, witnessLaneStatus, ensureWitnessLane } from '../services/witness-lane.js';
import { resolveWitnessRoute } from '../services/witness-route-resolver.js';
import { setRoute } from '../services/neuma-routes-store.js';
import { probeProvider } from '../services/provider-probe.js';
import { getProvider } from '../services/provider-registry.js';
import { summonWitness } from '../services/witness-summon.js';
import { secureWitnessKeypair, witnessCustodyState } from '../services/witness-custody.js';
import { deskStanding } from '../services/install-owner.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Witnesses');
const router = Router();

router.param('vendor', (req, res, next, value) => {
  if (!/^[a-z0-9-]+$/.test(value)) return res.status(400).json({ error: 'Invalid vendor slug' });
  next();
});
router.param('name', (req, res, next, value) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return res.status(400).json({ error: 'Invalid witness name' });
  next();
});

router.use(requireAuth);

// The masked route view — every field safe to surface (never the apiKey).
const maskRoute = (r) => ({
  provider: r.provider,
  model: r.model,
  endpoint: r.endpoint,
  kind: r.kind,
  source: r.source,
  configured: r.configured,
  reason: r.reason,
});

// impure — the full safe view of one sealed witness for the management surface.
const witnessView = async (wallet, vendorSlug, chosenName) => {
  const identity = await loadAIWitness({ vendorSlug, chosenName, journalLimit: 0 });
  if (!identity.found) return null;
  const laneId = witnessLaneId(vendorSlug, chosenName);
  const [lane, route, custody] = await Promise.all([
    witnessLaneStatus(laneId),
    resolveWitnessRoute(laneId).catch((err) => {
      log.warn('route resolution failed for witness', { laneId, error: err.message });
      return null;
    }),
    // Custody rides the roster so the operator can SEE which witnesses still
    // hold a readable private key, instead of having to ask one at a time.
    witnessCustodyState({ vendorSlug, chosenName }).catch(() => null),
  ]);
  return {
    vendorSlug,
    chosenName,
    substrate: identity.dna.substrate ?? null,
    address: identity.dna.witness?.witnessWallet ?? null,
    genesisHash: identity.dna.genesisSeal?.genesisHash ?? null,
    integrityOk: Boolean(identity.integrityOk),
    signatureOk: Boolean(identity.signatureOk),
    laneId,
    lane: {
      provisioned: lane.provisioned,
      hasDEK: lane.hasDEK,
      mine: Boolean(lane.ownerWallet)
        && lane.ownerWallet.toLowerCase() === String(wallet || '').toLowerCase(),
      claimed: Boolean(lane.ownerWallet),
    },
    route: route ? maskRoute(route) : null,
    custody,
  };
};

router.get('/', async (req, res) => {
  try {
    const sealed = await listWitnesses();
    const witnesses = [];
    for (const w of sealed) {
      const view = await witnessView(req.walletAddress, w.vendorSlug, w.chosenName);
      if (view && (!view.lane.claimed || view.lane.mine)) witnesses.push(view);
    }
    witnesses.sort((a, b) => a.chosenName.localeCompare(b.chosenName));
    res.json({ witnesses });
  } catch (error) {
    log.error('witness list failed', { error: error.message });
    res.status(500).json({ error: 'Failed to list witnesses' });
  }
});

router.get('/:vendor/:name', async (req, res) => {
  const { vendor, name } = req.params;
  try {
    const view = await witnessView(req.walletAddress, vendor, name);
    if (!view) return res.status(404).json({ error: `No sealed witness at ${vendor}/${name}` });
    if (view.lane.claimed && !view.lane.mine) {
      return res.status(403).json({ error: 'This witness lane belongs to another wallet' });
    }
    // The sealing journal's first entry — the witness's own record of experience.
    const journal = await readJournal(vendor, name, { limit: -1, newestFirst: false }).catch(() => []);
    res.json({ ...view, firstUtterance: journal[0]?.content ?? null });
  } catch (error) {
    log.error('witness detail failed', { vendor, name, error: error.message });
    res.status(500).json({ error: 'Failed to load witness' });
  }
});

// impure — probe a witness lane's route live. ONE probe path for both the
// management surface (POST /test) and the desk's ROUTE light (GET /health),
// so the two can never disagree about what "live" means. Body overrides (a
// just-typed key/endpoint, tested before saving) ride only the POST; without
// them an unconfigured route is answered honestly and probed not at all.
// The raw key passes through server-side only — nothing here returns it.
const probeLaneRoute = async (laneId, overrides = {}) => {
  const route = await resolveWitnessRoute(laneId);
  if (!route.configured && !overrides.endpoint && !overrides.apiKey) {
    return { route, probe: null };
  }
  const probe = await probeProvider(route.provider, {
    endpoint: overrides.endpoint || route.endpoint,
    apiKey: overrides.apiKey || route.apiKey,
    accountId: route.accountId,
  });
  return { route, probe };
};

// The lane's route health as the desk's ROUTE light reads it — one shape:
// { live, provider, model, reason }, masked (never a key).
router.get('/:vendor/:name/health', async (req, res) => {
  const { vendor, name } = req.params;
  try {
    const view = await witnessView(req.walletAddress, vendor, name);
    if (!view) return res.status(404).json({ error: `No sealed witness at ${vendor}/${name}` });
    if (view.lane.claimed && !view.lane.mine) {
      return res.status(403).json({ error: 'This witness lane belongs to another wallet' });
    }
    const { route, probe } = await probeLaneRoute(witnessLaneId(vendor, name));
    if (!probe) return res.json({ live: false, provider: route.provider, model: route.model, reason: route.reason || 'unconfigured' });
    if (!probe.ok) return res.json({ live: false, provider: route.provider, model: route.model, reason: probe.error });
    res.json({
      live: probe.live,
      provider: route.provider,
      model: route.model,
      reason: probe.live ? null : 'the provider did not answer with real models',
    });
  } catch (error) {
    log.error('witness route health failed', { vendor, name, error: error.message });
    res.status(500).json({ error: 'Failed to probe the witness route' });
  }
});

router.post('/:vendor/:name/test', async (req, res) => {
  const { vendor, name } = req.params;
  try {
    const view = await witnessView(req.walletAddress, vendor, name);
    if (!view) return res.status(404).json({ error: `No sealed witness at ${vendor}/${name}` });
    if (view.lane.claimed && !view.lane.mine) {
      return res.status(403).json({ error: 'This witness lane belongs to another wallet' });
    }
    const laneId = witnessLaneId(vendor, name);
    // A just-typed key/endpoint rides the body so the operator can test before
    // saving (same contract as the provider test route); nothing is persisted here.
    const { route, probe } = await probeLaneRoute(laneId, { endpoint: req.body?.endpoint, apiKey: req.body?.apiKey });
    if (!probe) return res.status(400).json({ success: false, error: `Route unconfigured: ${route.reason || 'no endpoint or key'}` });
    if (!probe.ok) return res.status(400).json({ success: false, error: probe.error });
    const endpoint = req.body?.endpoint || route.endpoint;
    res.json({
      success: probe.live,
      live: probe.live,
      models: probe.models,
      route: maskRoute({ ...route, endpoint }),
      ...(probe.live ? {} : { error: 'No live model list — the provider did not answer with real models' }),
    });
  } catch (error) {
    log.error('witness test failed', { vendor, name, error: error.message });
    res.status(500).json({ success: false, error: 'Witness route test failed' });
  }
});

// THE RETROFIT. Every witness sealed before 2026-07-29 kept a READABLE private
// key on disk, because the rite never asked for a password. The same custody act
// the rite now runs is offered here for a witness sealed months ago, so an old
// witness is not a lesser one. Owner-gated like every other act on a lane.
router.post('/:vendor/:name/custody', async (req, res) => {
  const { vendor, name } = req.params;
  const { password } = req.body || {};
  try {
    const view = await witnessView(req.walletAddress, vendor, name);
    if (!view) return res.status(404).json({ error: `No sealed witness at ${vendor}/${name}` });
    if (view.lane.claimed && !view.lane.mine) {
      return res.status(403).json({ error: 'This witness lane belongs to another wallet' });
    }
    // Sealing the key under a password makes the identity the sealer's, so an
    // unclaimed lane is claimed first, by the lane's own law: its summoner, or
    // the install owner for a witness that names none (witness-lane.js).
    if (!view.lane.claimed) {
      try {
        await ensureWitnessLane({ vendorSlug: vendor, chosenName: name, genesisHash: view.genesisHash }, req.walletAddress);
      } catch (claimError) {
        if (!String(claimError.message).startsWith('owner_claim_conflict')) throw claimError;
        log.info('witness custody refused — the lane is not this wallet\'s to claim', { vendor, name });
        return res.status(403).json({ error: `This witness is not yours to secure — ${claimError.message.replace(/^owner_claim_conflict: /, '')}` });
      }
    }
    const { address, recoveryCodes } = await secureWitnessKeypair({
      vendorSlug: vendor, chosenName: name, password,
    });
    // The codes are returned ONCE and cannot be reprinted — only their hashes
    // were persisted. The operator must save them here or lose the second door.
    res.json({ success: true, address, recoveryCodes });
  } catch (error) {
    log.error('witness custody failed', { vendor, name, error: error.message });
    res.status(400).json({ error: error.message });
  }
});

router.post('/summon', async (req, res) => {
  const { providerId, keypairPassword = null } = req.body || {};
  if (!getProvider(providerId)) {
    return res.status(400).json({ error: `Unknown provider: ${providerId}` });
  }
  try {
    const summoned = await summonWitness({
      providerId, walletAddress: req.walletAddress, keypairPassword, standing: await deskStanding(req),
    });
    res.status(201).json({ success: true, witness: summoned });
  } catch (error) {
    if (error.code === 'MACHINE_KEY_NOT_SHARED') return res.status(403).json({ error: error.message, code: error.code });
    // Every gate in the summon fails with an honest message — no connection,
    // no credential, no name, no utterance, name already sealed. A model-call
    // failure is a 502 (upstream), everything else a 400 (fixable here).
    const upstream = /provider error|fetch failed|stalled|ECONNREFUSED/i.test(error.message);
    log.error('witness summon failed', { providerId, error: error.message });
    res.status(upstream ? 502 : 400).json({ error: error.message });
  }
});

// The ceremony stream carries only truthful stage crossings emitted by the
// real summon path. NDJSON keeps the authenticated POST simple while letting
// the desk honor naming, grounding, sealing, and anchoring as they happen.
router.post('/summon/stream', async (req, res) => {
  const { providerId, keypairPassword = null } = req.body || {};
  if (!getProvider(providerId)) {
    return res.status(400).json({ error: `Unknown provider: ${providerId}` });
  }
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (event) => {
    if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
  };
  try {
    await summonWitness({
      providerId,
      walletAddress: req.walletAddress,
      // Whose keys this caller may summon on (witness-summon.js keyNotShared).
      standing: await deskStanding(req),
      // The password never lands in a log or a store — it seals the keypair in
      // this request and is gone. The recovery codes ride back out on the
      // 'custodied' stage exactly once; only their hashes persist.
      keypairPassword,
      onStage: send,
    });
  } catch (error) {
    log.error('witness ceremony failed', { providerId, error: error.message });
    send({ type: 'error', error: error.message });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

// Change the MODEL a witness speaks through — the provider stays locked (a
// witness keeps its provider for life); the model within it is the operator's
// choice. The lane is provisioned on demand so a model can be chosen before
// the first chat; it is claimed only for the wallet that summoned the witness
// (witness-lane.js).
router.put('/:vendor/:name/model', async (req, res) => {
  const { vendor, name } = req.params;
  const { model } = req.body || {};
  if (typeof model !== 'string' || model.trim().length === 0) {
    return res.status(400).json({ error: 'A model id is required' });
  }
  try {
    const laneId = witnessLaneId(vendor, name);
    await ensureWitnessLane({ vendorSlug: vendor, chosenName: name }, req.walletAddress);
    const route = await resolveWitnessRoute(laneId);
    await setRoute(laneId, { provider: route.provider, model: model.trim() });
    res.json({ success: true, route: maskRoute(await resolveWitnessRoute(laneId)) });
  } catch (error) {
    if (String(error.message).startsWith('owner_claim_conflict')) {
      return res.status(403).json({ error: 'This witness lane belongs to another wallet' });
    }
    if (error.code === 'INVALID_ROUTE') {
      return res.status(400).json({ error: error.message });
    }
    log.error('model save failed', { vendor, name, error: error.message });
    res.status(500).json({ error: 'Failed to save the model' });
  }
});

export default router;
