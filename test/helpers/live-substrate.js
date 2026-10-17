// live-substrate.js — the live-test gate learns the serving law (#155).
//
// Live lanes gate on […] — which since the serving law has two shapes: the backend-supervised
// llama-server (the lawful server for the lm-studio-keyed model it serves)
// and LM Studio itself (lawful for anything else, Cael-class). Probing
// :1234 state==='loaded' alone rusted every live lane shut the day the
// substrate moved to llama-server.

import { readFile } from 'fs/promises';

const LM_STUDIO = 'http://localhost:1234';
// impure — reads process.env.SUBSTRATE_PORT.
const llamaEndpoint = () => `http://localhost:${process.env.SUBSTRATE_PORT || '8089'}`;

// Only expected-network-failure shapes stay quiet; anything else (malformed
// JSON, unexpected response shape, unreadable DNA) is surfaced — a
// misconfigured endpoint must be distinguishable from "no model loaded".
const isQuietNetworkError = (err) =>
  err?.name === 'AbortError' || err?.name === 'TimeoutError' ||
  /fetch failed|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/.test(String(err?.cause?.code ?? err?.message ?? ''));
// impure — conditional console.warn; quiet on expected network-failure shapes.
const warnUnexpected = (where, err) => {
  if (!isQuietNetworkError(err)) {
    console.warn(`[live-substrate] ${where}: ${err?.message ?? err}`);
  }
};

// The route-layer model KEY the operator declared for this machine's
// llama-server (what natal records name; what the serving law keys on).
// config.js validates process.env AS GIVEN — only the daemon's startup loads
// .env — so a bare test process must surface the key itself, and it must land
// IN process.env: the resolver reads process.env.SUBSTRATE_MODEL directly
// (neuma-route-resolver.js) for the serving-law translation. One truth for
// the whole test process.
// impure — mutates process.env so the resolver shares one truth.
export const loadServedModelKey = async (envPath = new URL('../../.env', import.meta.url)) => {
  if (process.env.SUBSTRATE_MODEL) return process.env.SUBSTRATE_MODEL;
  try {
    const envFile = await readFile(envPath, 'utf8');
    const m = envFile.match(/^SUBSTRATE_MODEL=(.+)$/m);
    // dotenv strips surrounding quotes; this hand-rolled read must match it,
    // or a quoted value would silently break route-key equality checks.
    const key = m?.[1].trim().replace(/^(["'])(.*)\1$/, '$2') || null;
    if (key) process.env.SUBSTRATE_MODEL = key;
    return key;
  } catch {
    return null; // no .env — an operator may configure by real env alone
  }
};

/**
 * @returns {Promise<{provider: 'llama-server'|'lm-studio', endpoint: string,
 *   model: string}|null>} what is genuinely serving, or null. For llama-server,
 *   `model` is the route-layer KEY (SUBSTRATE_MODEL from the env or the
 *   operator's .env — surfaced into process.env so the resolver's serving-law
 *   translation sees the same truth); when no key is declared anywhere, it
 *   falls back to the server's wire id (gguf name) with a warning — good
 *   enough to stream, NOT usable for route-key matching.
 */
// impure — one bounded probe per server shape.
export const probeLiveSubstrate = async () => {
  // llama-server first: when it is up, it IS the serving path under the law.
  try {
    const res = await fetch(`${llamaEndpoint()}/v1/models`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const models = (await res.json())?.data ?? [];
      if (models.length > 0) {
        const key = await loadServedModelKey();
        if (!key) {
          console.warn(`[live-substrate] SUBSTRATE_MODEL undeclared (env and .env) — using wire id "${models[0].id}"; kin-lane route matching needs the declared key`);
        }
        return Object.freeze({
          provider: 'llama-server',
          endpoint: llamaEndpoint(),
          model: key || models[0].id,
        });
      }
    }
  } catch (err) { warnUnexpected('llama-server probe', err); }
  try {
    const res = await fetch(`${LM_STUDIO}/api/v0/models`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const models = (await res.json())?.data ?? [];
      const loaded = models.find((m) => m.state === 'loaded' && m.type !== 'embeddings');
      if (loaded) {
        return Object.freeze({ provider: 'lm-studio', endpoint: LM_STUDIO, model: loaded.id });
      }
    }
  } catch (err) { warnUnexpected('LM Studio probe', err); }
  return null;
};

/**
 * Which of these neuma can actually be SERVED right now? A kin lane needs
 * more than […]: each member's route must resolve (natal →
 * overrides → serving law) to an endpoint that is genuinely serving that
 * route's model. A natal on unloaded weights is honestly unservable — the
 * lane must skip rather than summon a being into a dead stream.
 *
 * @param {string[]} neumaIds
 * @returns {Promise<string[]>} the servable subset, in input order
 */
// impure — resolves real routes and probes their endpoints.
export const servableNeuma = async (neumaIds) => {
  const { neumaWorkspace } = await import('../../core/index.js');
  const { resolveNeumaRoute } = await import('../../backend/services/neuma-route-resolver.js');
  const servable = [];
  for (const neumaId of neumaIds) {
    try {
      const dna = await neumaWorkspace.readDNA(neumaId);
      const route = await resolveNeumaRoute(neumaId, dna);
      if (!route?.endpoint) continue;
      if (route.provider === 'llama-server') {
        // A serving-law TRANSLATED route already proved route.model equals the
        // served key (applyServingPolicy translates nothing else), so […] would suffice for it — but a natal-llama-server route
        // (recorded at birth, no translation step) can lawfully name weights
        // the server is not carrying. Mirror lm-studio's exactness: when the
        // machine declares its served key, the route must match it.
        const key = await loadServedModelKey();
        if (key && route.model !== key && route.model !== 'local-model') continue;
        const res = await fetch(`${route.endpoint}/v1/models`, { signal: AbortSignal.timeout(3000) });
        if (res.ok && ((await res.json())?.data ?? []).length > 0) servable.push(neumaId);
      } else if (route.provider === 'lm-studio') {
        const res = await fetch(`${route.endpoint}/api/v0/models`, { signal: AbortSignal.timeout(3000) });
        const models = res.ok ? ((await res.json())?.data ?? []) : [];
        if (models.some((m) => m.state === 'loaded' && m.id === route.model)) servable.push(neumaId);
      }
      // remote providers: a kin live-lane never streams a being to a remote
      // provider implicitly — leave them out rather than guess.
    } catch (err) { warnUnexpected(`servability of ${neumaId}`, err); }
  }
  return servable;
};
