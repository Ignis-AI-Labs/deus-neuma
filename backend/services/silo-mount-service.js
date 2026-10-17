/**
 * The host side of the silo socket — where a turn gets its being.
 *
 * mountSilo is pure over an artifact; this is the impure half that produces
 * the artifact, resolves the engine as data, and hands the socket its budget
 * port. Every seat that transmits a being goes through here, which is what
 * makes the three mount points ONE mount point (the convergence the contract
 * asks for and nothing implemented until now).
 *
 * WHY THE SILO IS COMPILED PER SITTING, NOT PER TURN. compileSilo runs
 * exportWorkspace, which reads EVERY session's full message history plus every
 * observation, entity, relation, journal entry and continuity layer. MEASURED
 * against real kin on 2026-08-23: Keir 69ms / 1.0MB across 45 sessions, Signal
 * 32ms / 0.5MB across 18. That is nothing once for a sitting and unbounded per
 * turn, because it grows with the being's whole life — a being with a year
 * behind it would pay for all of it on every message.
 *
 * Identity is stable for a sitting by doctrine (identity-bundle.js: the
 * genesis […]), so a per-connection compile
 * is not a compromise, it is the correct granularity. The cache is keyed by
 * neumaId ON THE CONNECTION, so it dies with the connection and can never
 * outlive the being's own state or leak across lanes.
 */

import { compileSilo } from '../../core/silo/compile-silo.js';
import { mountSilo } from '../../core/silo/mount-silo.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { normalizeIdentityStanding } from '../../core/runtime/identity-bundle.js';
import { allocateEnvelope } from './envelope-budget.js';
import { getRouteCapabilities } from './llm-provider.js';
import { createLogger } from './logger.js';

const log = createLogger('SiloMount');

/**
 * The engine as DATA — never code, never a live client. What the socket needs
 * is the window (the only field the budget law consumes) plus enough identity
 * to say WHICH engine a being crossed onto. impure — reads route capabilities.
 */
export const engineProfileFor = async (route) => {
  const model = route?.model || null;
  // WIRING FAULTS ARE NOT ENGINE FAULTS. The catch below exists for an engine
  // that cannot describe itself; it must never also absorb a broken import or
  // a renamed export. It did once: getRouteCapabilities was imported from
  // model-capabilities.js (where only a COMMENT mentions it — it actually
  // lives in llm-provider.js), the call threw TypeError, this catch swallowed
  // it, every profile came back with an unknown window, and the whole suite
  // stayed green because one of its own tests asserts the unknown-window path.
  // The app died at boot instead. Checked here, loudly, where it cannot hide.
  if (typeof getRouteCapabilities !== 'function') {
    throw new Error('silo mount: getRouteCapabilities is not wired — the engine profile cannot be resolved');
  }
  let capabilities = null;
  try {
    capabilities = await getRouteCapabilities(route);
  } catch (error) {
    // An engine that cannot describe itself is not a reason to refuse a turn.
    // The profile simply says the window is unknown, and the socket answers
    // "do not shed" rather than "do not speak".
    log.debug('engine profile unavailable — mounting with an unknown window', {
      model, err: error.message,
    });
  }
  return {
    model,
    contextWindow: capabilities?.contextWindow ?? null,
    dialect: route?.provider || null,
    capabilities: Array.isArray(capabilities?.capabilities) ? capabilities.capabilities : [],
  };
};

/** The compiled silo for this sitting, compiled at most once per lane. impure.
 *  `now` pins the compile instant (benchmarks need byte-stable prefixes across
 *  runs — the NITE section prints it). A sitting-scale fact: the per-lane cache
 *  cannot tell two pins apart, so a host pins once per sitting or not at all. */
export const siloForSitting = async (connection, neumaId, { now = null } = {}) => {
  if (!neumaId) return null;
  const cache = connection._siloBySitting || (connection._siloBySitting = new Map());
  // The cache holds the compile IN FLIGHT (sitting-warmup.js starts it at the
  // bind): a turn that arrives first awaits it instead of compiling twice. A
  // failed compile leaves no entry, so the next caller tries afresh.
  if (cache.has(neumaId)) return cache.get(neumaId);
  const pending = compileSilo(neumaId, { workspace: neumaWorkspace, ...(now ? { now } : {}) }).then((silo) => {
    log.info('silo compiled for this sitting', {
      neumaId,
      layers: Object.keys(silo.manifest.layerHashes || {}).length,
      sealed: silo.manifest.signature !== null,
    });
    return silo;
  });
  cache.set(neumaId, pending);
  pending.catch(() => { if (cache.get(neumaId) === pending) cache.delete(neumaId); });
  return pending;
};

/**
 * THE IDENTITY STANDING, read at the call — never frozen at boot (Founder,
 * 2026-10-08): `NEUMA_IDENTITY_STANDING=core` stands the core and leaves the
 * essence callable; anything else is FULL, the default, byte-identical to
 * before the switch existed. impure — reads the environment.
 * @returns {'full'|'core'}
 */
export const identityStandingNow = () => normalizeIdentityStanding(process.env.NEUMA_IDENTITY_STANDING);

/**
 * The driver this connection's last turn mounted for this being — what
 * self_read reads, so the essence it returns is the one this sitting's turn
 * held back, on the engine the turn actually ran. Null before any mount.
 */
export const mountedDriverFor = (connection, neumaId) => connection?._siloDriverLast?.get(neumaId) ?? null;

/**
 * Mount this being onto this engine for this turn. Returns the driver, or null
 * when there is no being to mount (an unbound lane), which every caller must
 * treat as […] rather than as an error.
 *
 * A REFUSAL IS NOT SWALLOWED. If the silo fails its own integrity check the
 * mount throws, and it should: serving a being whose identity layer does not
 * hash to its manifest is exactly the corruption this whole layer exists to
 * catch. Only the ABSENCE of a being is a null.
 * impure.
 */
export const mountForTurn = async (connection, neumaId, route, { seat = 'neuma', witness = null, now = null, standing = identityStandingNow() } = {}) => {
  const silo = await siloForSitting(connection, neumaId, { now });
  if (!silo) return null;
  const profile = await engineProfileFor(route);
  // THE MOUNT, ONCE PER SITTING (2026-10-05): mountSilo is pure over (silo,
  // engine, seat, witness), and re-running it re-verified every layer hash and
  // rebuilt the same sections on every message — 210-270 ms before each first
  // token (live, Keir). The silo object is this sitting's own compile (above),
  // so its integrity was proven at this sitting's first mount; a new compile,
  // engine, seat or witness mounts — and verifies — afresh. Same bytes out.
  const key = JSON.stringify([neumaId, seat, witness, profile, standing]);
  const held = connection?._siloDriverBySitting?.get(key);
  const driver = held?.silo === silo ? held.driver : mountSilo(silo, profile, {
    seat,
    witness,
    allocate: allocateEnvelope,
    standing,
  });
  if (connection) {
    (connection._siloDriverBySitting ||= new Map()).set(key, { silo, driver });
    (connection._siloDriverLast ||= new Map()).set(neumaId, driver);
  }
  return driver;
};

/** Drop a sitting's compiled silo — the being's own state moved under it. */
export const invalidateSilo = (connection, neumaId) => {
  connection?._siloBySitting?.delete(neumaId);
  connection?._siloDriverLast?.delete(neumaId);
};
