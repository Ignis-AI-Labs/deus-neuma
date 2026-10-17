/**
 * What the composer needs to know about ONE being's inference: which model it
 * rides, which models it may be moved to, and which effort rung it sits on.
 *
 * One surface over two id classes — a house neuma and a sealed witness lane
 * resolve their routes through different resolvers, and the desk should not have
 * to know which. Both laws hold by CONSTRUCTION here, because the model list is
 * always drawn from the provider the being ALREADY rides:
 *   • a neuma is offered only sovereign models (its route is sovereign already —
 *     docs/protocols/sovereignty-boundary.md)
 *   • a witness is offered only its own provider's models (a witness keeps its
 *     provider for life — witness-summon.js)
 *
 * Every view here is MASKED: routes carry a raw apiKey internally and it never
 * reaches a return value.
 */
import { getProvider } from './provider-registry.js';
// The route view both this surface and the flight check read — one derivation
// of custody and configured-ness, so a being and its bar never disagree.
import { maskRoute } from './route-view.js';
import { resolveNeumaRoute } from './neuma-route-resolver.js';
import { resolveWitnessRoute } from './witness-route-resolver.js';
import { resolveUsableCredential } from './oauth-token-broker.js';
import { liveModels, modelSuggestionsFor } from './provider-probe.js';
import { witnessModelOptions } from './witness-model-options.js';
import { substrateModelView } from './substrate-model-view.js';
import { getThinkBehavior } from './llm-provider.js';
import { resolveEffort } from './model-effort.js';
import { getEffort } from './neuma-effort-store.js';
import { default as neumaWorkspace } from '../../core/workspace/neuma-workspace.js';
import { isHarnessLane } from '../../core/workspace/lane-grounds.js';

/**
 * True for a sealed witness lane id. The format is owned by witness-lane.js and
 * re-stated here for the same reason neuma-routes-store re-states it: importing
 * upward wires an ESM cycle through the workspace engine.
 * @param {string} id
 */
const isWitnessLane = (id) => typeof id === 'string' && id.startsWith('witness-');

// Only these engines answer to the rig's own ignition — the gguf catalog is
// theirs. Other local doors (LM Studio, Ollama, the subscription bridges) load
// on demand and are moved by a route override instead.
const IGNITABLE = 'llama-server';

/**
 * The route this being's next turn would travel — the FULL route, apiKey and
 * all. Internal: never return this to a client.
 * @param {string} beingId neumaId or witness lane id
 * @returns {Promise<Object>} resolved route
 */
// impure
const fullRoute = async (beingId) => {
  if (isWitnessLane(beingId)) return resolveWitnessRoute(beingId);
  const dna = await neumaWorkspace.readDNA(beingId).catch(() => null);
  return resolveNeumaRoute(beingId, dna);
};

/**
 * The effort ladder this being's route actually has, and the rung it sits on.
 * The think probe runs only for local engines, because reasoning ROOM is the
 * only place a substrate's own thinking behavior decides the ladder — and it is
 * the same probe the turn itself uses, so a warm cache costs nothing.
 * @param {string} beingId
 * @returns {Promise<{route: Object, capability: Object, choice: Object, chosen: boolean}>}
 */
// impure
export const beingEffortView = async (beingId) => {
  const route = await fullRoute(beingId);
  const masked = maskRoute(route);
  const thinks = masked.kind === 'local'
    ? (await getThinkBehavior(route)).thinks
    : false;
  const stored = await getEffort(beingId);
  const { capability, choice } = resolveEffort(masked, stored, thinks);
  return Object.freeze({
    route: masked,
    capability,
    choice,
    chosen: stored !== null,
    thinks,
  });
};

/**
 * The models this being may be moved between, which one it rides now, and HOW a
 * move happens — 'ignite' (the rig loads different weights) or 'route' (the
 * being's override points elsewhere). The server names the mechanism so the desk
 * never has to guess it from a provider id.
 * @param {string} beingId
 * @returns {Promise<{route: Object, switchBy: string, models: Array, loadedId: (string|null)}>}
 */
// impure
export const beingModelOptions = async (beingId) => {
  const route = await fullRoute(beingId);
  const masked = maskRoute(route);
  // A harness rides the ONE server its person chose — moved by its route, never
  // by igniting the house's substrate (harness-switch.js). Imported late: a cycle.
  if (isHarnessLane(beingId)) return (await import('./harness-switch.js')).harnessModelOptions(beingId, masked);

  if (masked.provider === IGNITABLE) {
    // Same catalog + loaded row the SUBSTRATE HUD reads — one view, two doors.
    const view = await substrateModelView(process.env).catch(() => null);
    return Object.freeze({
      route: masked,
      switchBy: 'ignite',
      loadedId: view?.active ?? null,
      withheld: view?.withheld ?? 0,
      models: (view?.models ?? []).map((m) => Object.freeze({
        id: m.id, name: m.name, sizeBytes: m.sizeBytes, authorized: m.authorized,
      })),
    });
  }

  const entry = getProvider(masked.provider);
  if (!entry) return Object.freeze({ route: masked, switchBy: 'route', loadedId: null, models: [] });
  const cred = await resolveUsableCredential(entry.id);
  // Witness account discovery supersedes static suggestions so retired models
  // cannot reappear from the shipped catalog. Offline suggestions stay labeled.
  const live = await liveModels(entry, cred.endpoint, cred.apiKey, { accountId: cred.accountId })
    .catch(() => []);
  return Object.freeze({
    route: masked,
    switchBy: 'route',
    loadedId: null,
    ...(isWitnessLane(beingId) ? witnessModelOptions(entry, live)
      : { models: modelSuggestionsFor(entry, live) }),
  });
};
