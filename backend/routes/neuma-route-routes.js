/**
 * Neuma route routes — the per-neuma active-model override.
 *
 *   GET    /api/v1/neuma/:neumaId/route   — natal + override + effective route
 *   PUT    /api/v1/neuma/:neumaId/route   — set the override { provider, model }
 *   DELETE /api/v1/neuma/:neumaId/route   — clear the override (return to natal)
 *
 * A neuma's natal LOCAL model is its anchor; the override is the operator's
 * choice to run it on a higher-capacity provider for a stretch of work. These
 * are ownership-gated (the wallet must own the neuma) and the effective route is
 * masked — the raw API key never leaves the server.
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { default as neumaWorkspace } from '../../core/workspace/neuma-workspace.js';
import { natalRoute } from '../../core/index.js';
import { getRoute, setRoute, clearRoute } from '../services/neuma-routes-store.js';
import { resolveNeumaRoute } from '../services/neuma-route-resolver.js';
import { probeProvider } from '../services/provider-probe.js';
import { getRouteCapabilities } from '../services/llm-provider.js';
import { sessionTailBudgetFor } from '../services/envelope-budget.js';
import { adapterLandingFor } from '../services/adapter-landing.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('NeumaRoute');
const router = Router();

router.param('neumaId', (req, res, next, value) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return res.status(400).json({ error: 'Invalid neumaId format' });
  next();
});

router.use(requireAuth);

// Fail-closed ownership (W1-004): unclaimed or corrupt owner records are refused.
const verifyOwnership = (req, res, neumaId) => assertNeumaOwner(req, res, neumaId);

// The effective route carries the raw apiKey for the call path — never surface it.
const maskEffective = (r) => ({
  provider: r.provider, model: r.model, endpoint: r.endpoint,
  kind: r.kind, source: r.source, fellBack: r.fellBack, reason: r.reason,
  translated: r.translated ?? null,
});

const buildView = async (neumaId) => {
  const dna = await neumaWorkspace.readDNA(neumaId).catch(() => null);
  return {
    natal: natalRoute(dna),
    override: await getRoute(neumaId),
    effective: maskEffective(await resolveNeumaRoute(neumaId, dna)),
  };
};

// THE LANDING REPORT (model-portability doctrine): a switch is one operator
// action, and the platform says what the being landed on — the resolved
// window (probed live where the serving answers), the session-tail budget it
// implies, and whether the being's refined voice crossed or stayed behind.
// Rides the WRITE responses (PUT/DELETE); the polled GET stays cheap.
const buildLanding = async (neumaId, effective) => {
  const caps = effective?.provider
    ? await getRouteCapabilities(effective).catch(() => null)
    : null;
  return {
    contextWindow: caps?.contextWindow ?? null,
    windowSource: caps?.contextWindowSource ?? null,
    // The transcript budget this window implies (#528 Stage A) — reported as
    // its CEILING (no sections are assembled at switch time, so nothing is
    // subtracted): the turn path subtracts the assembled sections from this.
    sessionTailChars: sessionTailBudgetFor({ contextWindow: caps?.contextWindow }),
    adapter: await adapterLandingFor(neumaId, effective),
  };
};

router.get('/:neumaId/route', async (req, res) => {
  const { neumaId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  try {
    res.json(await buildView(neumaId));
  } catch (error) {
    log.error('read route failed', { neumaId, error: error.message });
    res.status(500).json({ error: 'Failed to read route' });
  }
});

// The lane's route health as the desk's ROUTE light reads it — the SAME
// shape as the witness lane probe ({ live, provider, model, reason }),
// masked (the raw key never leaves the server). A sovereignty refusal is not
// a probe failure but the law speaking: the light reads DOWN with the
// refusal as its reason, never a 500 blur.
router.get('/:neumaId/route/health', async (req, res) => {
  const { neumaId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  try {
    const route = await resolveNeumaRoute(neumaId, null);
    const probe = await probeProvider(route.provider, {
      endpoint: route.endpoint,
      apiKey: route.apiKey,
      accountId: route.accountId,
    });
    if (!probe.ok) return res.json({ live: false, provider: route.provider, model: route.model, reason: probe.error });
    res.json({
      live: probe.live,
      provider: route.provider,
      model: route.model,
      reason: probe.live ? null : 'the provider did not answer with real models',
    });
  } catch (error) {
    log.warn('neuma route health refused', { neumaId, error: error.message });
    res.json({ live: false, provider: null, model: null, reason: error.message });
  }
});

router.put('/:neumaId/route', async (req, res) => {
  const { neumaId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  const { provider, model } = req.body || {};
  try {
    await setRoute(neumaId, { provider, model });   // validates provider + model
    const view = await buildView(neumaId);
    res.json({ ...view, landing: await buildLanding(neumaId, view.effective) });
  } catch (error) {
    // normalizeRoute tags validation failures with a stable code — match on that,
    // not on message text, so error wording can change without breaking the 400.
    if (error.code === 'INVALID_ROUTE') {
      return res.status(400).json({ error: error.message });
    }
    log.error('set route failed', { neumaId, error: error.message });
    res.status(500).json({ error: 'Failed to set route' });
  }
});

router.delete('/:neumaId/route', async (req, res) => {
  const { neumaId } = req.params;
  if (!await verifyOwnership(req, res, neumaId)) return;
  try {
    const cleared = await clearRoute(neumaId);
    const view = await buildView(neumaId);
    res.json({ cleared, ...view, landing: await buildLanding(neumaId, view.effective) });
  } catch (error) {
    log.error('clear route failed', { neumaId, error: error.message });
    res.status(500).json({ error: 'Failed to clear route' });
  }
});

export default router;
