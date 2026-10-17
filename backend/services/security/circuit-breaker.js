import fs from 'fs/promises';
import path from 'path';
import { isIP } from 'net';
import { getSettingsDir } from '../data-root.js';
import { withFileLock } from '../file-lock.js';
import { recordAct } from '../act-ledger.js';
import { createLogger } from '../logger.js';

const log = createLogger('Security.CircuitBreaker');
const STATE_VERSION = 1;
const CACHE_MS = 1_000;
const MIN_DURATION_SECONDS = 30;
const MAX_MANUAL_DURATION_SECONDS = 24 * 60 * 60;
const MAX_AUTOMATIC_DURATION_SECONDS = 15 * 60;

const circuitBreakerPath = () => process.env.NEUMA_SECURITY_BREAKERS_PATH
  || path.join(getSettingsDir(), 'security-circuit-breakers.json');

/** Canonical source address from a kernel-trusted socket value. Pure. */
export const normalizeSource = (value) => {
  const bracketless = String(value || '').trim().replace(/^\[|\]$/g, '');
  const zoneless = bracketless.includes(':') ? bracketless.replace(/%[^%]+$/, '') : bracketless;
  const unwrapped = zoneless.startsWith('::ffff:') ? zoneless.slice(7) : zoneless;
  return isIP(unwrapped) ? unwrapped : null;
};

/** Loopback sources are the operator's recovery lane and can never be blocked. Pure. */
export const isLoopbackSource = (value) => {
  const source = normalizeSource(value);
  if (!source) return false;
  return source === '::1' || source.startsWith('127.');
};

const initialState = () => Object.freeze({
  version: STATE_VERSION,
  autoContain: true,
  lockdown: null,
  blockedSources: Object.freeze([]),
  updatedAt: null,
});

const boundedReason = (value) => {
  const reason = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (reason.length < 8) throw new Error('mitigation reason must explain the observed risk');
  return reason;
};

const durationFor = (value, automatic) => {
  const seconds = Number(value);
  const max = automatic ? MAX_AUTOMATIC_DURATION_SECONDS : MAX_MANUAL_DURATION_SECONDS;
  if (!Number.isInteger(seconds) || seconds < MIN_DURATION_SECONDS || seconds > max) {
    throw new Error(`durationSeconds must be ${MIN_DURATION_SECONDS}..${max}`);
  }
  return seconds;
};

/** Validate, prune, and freeze one persisted breaker state. Pure. */
export const normalizeBreakerState = (raw, nowMs = Date.now()) => {
  if (!raw || typeof raw !== 'object' || raw.version !== STATE_VERSION) {
    throw new Error('security circuit-breaker state is corrupt or has an unsupported version');
  }
  const blockedSources = [];
  for (const entry of Array.isArray(raw.blockedSources) ? raw.blockedSources : []) {
    const source = normalizeSource(entry?.source);
    const untilMs = Date.parse(entry?.until || '');
    if (!source || isLoopbackSource(source) || !Number.isFinite(untilMs) || untilMs <= nowMs) continue;
    blockedSources.push(Object.freeze({
      source,
      until: new Date(untilMs).toISOString(),
      reason: String(entry.reason || '').slice(0, 500),
      actor: String(entry.actor || 'unknown').slice(0, 120),
      automatic: entry.automatic === true,
      createdAt: String(entry.createdAt || ''),
    }));
  }
  const lockdownUntil = Date.parse(raw.lockdown?.until || '');
  const lockdown = Number.isFinite(lockdownUntil) && lockdownUntil > nowMs
    ? Object.freeze({
      until: new Date(lockdownUntil).toISOString(),
      reason: String(raw.lockdown.reason || '').slice(0, 500),
      actor: String(raw.lockdown.actor || 'unknown').slice(0, 120),
      createdAt: String(raw.lockdown.createdAt || ''),
    })
    : null;
  return Object.freeze({
    version: STATE_VERSION,
    autoContain: raw.autoContain !== false,
    lockdown,
    blockedSources: Object.freeze(blockedSources.sort((a, b) => a.source.localeCompare(b.source))),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  });
};

const readStateFile = async (target, nowMs) => {
  try {
    return normalizeBreakerState(JSON.parse(await fs.readFile(target, 'utf8')), nowMs);
  } catch (error) {
    if (error.code === 'ENOENT') return initialState();
    throw error;
  }
};

const writeStateFile = async (target, state) => {
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, target);
    await fs.chmod(target, 0o600);
    await fs.chmod(path.dirname(target), 0o700);
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
};

/** Persistent application-firewall controls, serialized across backend processes. */
export const createCircuitBreaker = ({ path: statePath = circuitBreakerPath, now = Date.now } = {}) => {
  let cache = null;
  let cacheTarget = null;
  let cacheExpiresAt = 0;
  let serial = Promise.resolve();
  const target = () => (typeof statePath === 'function' ? statePath() : statePath);
  const lockPath = () => `${target()}.lock`;

  const remember = (state) => {
    cache = state;
    cacheTarget = target();
    cacheExpiresAt = now() + CACHE_MS;
    return state;
  };

  const load = async ({ fresh = false } = {}) => {
    const currentTarget = target();
    if (!fresh && cache && cacheTarget === currentTarget && cacheExpiresAt > now()) return cache;
    return remember(await readStateFile(currentTarget, now()));
  };

  const mutate = (change) => {
    const run = serial.then(() => withFileLock(lockPath(), async () => {
      const current = await readStateFile(target(), now());
      const changed = normalizeBreakerState(change(current), now());
      await writeStateFile(target(), changed);
      return remember(changed);
    }));
    serial = run.catch(() => {});
    return run;
  };

  const audit = (tool, scope, actor, decision = 'approved') => recordAct({
    laneId: actor || 'system', name: actor || 'system', tool, scope, decision, status: 'ok',
  });

  const blockSource = async ({ source, durationSeconds, reason, actor = 'operator', automatic = false } = {}) => {
    const canonical = normalizeSource(source);
    if (!canonical) throw new Error('source must be one IPv4 or IPv6 address');
    if (isLoopbackSource(canonical)) throw new Error('loopback is the operator recovery lane and cannot be blocked');
    const duration = durationFor(durationSeconds, automatic);
    const why = boundedReason(reason);
    const at = new Date(now()).toISOString();
    const until = new Date(now() + duration * 1000).toISOString();
    const state = await mutate((current) => ({
      ...current,
      blockedSources: [
        ...current.blockedSources.filter((entry) => entry.source !== canonical),
        { source: canonical, until, reason: why, actor, automatic, createdAt: at },
      ],
      updatedAt: at,
    }));
    await audit('security/security_circuit_breaker', canonical, actor, automatic ? 'auto' : 'approved');
    log.warn('source circuit breaker applied', { source: canonical, until, reason: why, actor, automatic });
    return Object.freeze({ state, rule: state.blockedSources.find((entry) => entry.source === canonical) });
  };

  const unblockSource = async ({ source, reason, actor = 'operator' } = {}) => {
    const canonical = normalizeSource(source);
    if (!canonical) throw new Error('source must be one IPv4 or IPv6 address');
    const why = boundedReason(reason);
    const at = new Date(now()).toISOString();
    const state = await mutate((current) => ({
      ...current,
      blockedSources: current.blockedSources.filter((entry) => entry.source !== canonical),
      updatedAt: at,
    }));
    await audit('security/security_circuit_breaker_release', canonical, actor);
    log.info('source circuit breaker released', { source: canonical, reason: why, actor });
    return Object.freeze({ state, released: canonical });
  };

  const lockRemote = async ({ durationSeconds, reason, actor = 'operator' } = {}) => {
    const duration = durationFor(durationSeconds, false);
    const why = boundedReason(reason);
    const at = new Date(now()).toISOString();
    const state = await mutate((current) => ({
      ...current,
      lockdown: {
        until: new Date(now() + duration * 1000).toISOString(), reason: why, actor, createdAt: at,
      },
      updatedAt: at,
    }));
    await audit('security/security_circuit_breaker', 'all non-loopback traffic', actor);
    log.warn('remote lockdown applied', { until: state.lockdown.until, reason: why, actor });
    return Object.freeze({ state, lockdown: state.lockdown });
  };

  const releaseRemote = async ({ reason, actor = 'operator' } = {}) => {
    const why = boundedReason(reason);
    const at = new Date(now()).toISOString();
    const state = await mutate((current) => ({ ...current, lockdown: null, updatedAt: at }));
    await audit('security/security_circuit_breaker_release', 'all non-loopback traffic', actor);
    log.info('remote lockdown released', { reason: why, actor });
    return Object.freeze({ state, released: 'remote_lockdown' });
  };

  const setAutoContain = async ({ enabled, reason, actor = 'operator' } = {}) => {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
    const why = boundedReason(reason);
    const at = new Date(now()).toISOString();
    const state = await mutate((current) => ({ ...current, autoContain: enabled, updatedAt: at }));
    await audit('security/security_auto_containment', enabled ? 'enabled' : 'disabled', actor);
    log.info('automatic containment setting changed', { enabled, reason: why, actor });
    return Object.freeze({ state, autoContain: enabled });
  };

  const evaluate = async (source) => {
    const canonical = normalizeSource(source);
    if (!canonical || isLoopbackSource(canonical)) return Object.freeze({ blocked: false, source: canonical, reason: null });
    const state = await load();
    if (state.lockdown) return Object.freeze({ blocked: true, source: canonical, reason: 'remote_lockdown', until: state.lockdown.until });
    const rule = state.blockedSources.find((entry) => entry.source === canonical);
    return rule
      ? Object.freeze({ blocked: true, source: canonical, reason: 'source_blocked', until: rule.until })
      : Object.freeze({ blocked: false, source: canonical, reason: null });
  };

  const isBlockedNow = (source) => {
    const canonical = normalizeSource(source);
    if (!cache || !canonical || isLoopbackSource(canonical)) return false;
    if (cache.lockdown && Date.parse(cache.lockdown.until) > now()) return true;
    return cache.blockedSources.some((entry) => entry.source === canonical && Date.parse(entry.until) > now());
  };

  const autoContain = async ({ source, signal, durationSeconds = MAX_AUTOMATIC_DURATION_SECONDS } = {}) => {
    const state = await load();
    if (!state.autoContain) return Object.freeze({ contained: false, reason: 'automatic containment disabled' });
    const result = await blockSource({
      source,
      durationSeconds,
      reason: `Automatic containment: ${String(signal || 'critical traffic anomaly').slice(0, 400)}`,
      actor: 'security-watch',
      automatic: true,
    });
    log.warn('critical traffic automatically contained', { source: normalizeSource(source), signal, until: result.rule.until });
    return Object.freeze({ contained: true, ...result });
  };

  const apply = (action) => {
    const name = String(action?.action || '');
    if (name === 'block_source') return blockSource(action);
    if (name === 'unblock_source') return unblockSource(action);
    if (name === 'lock_remote') return lockRemote(action);
    if (name === 'release_remote') return releaseRemote(action);
    if (name === 'set_auto_containment') return setAutoContain(action);
    throw new Error('action must be block_source | unblock_source | lock_remote | release_remote | set_auto_containment');
  };

  return Object.freeze({ load, blockSource, unblockSource, lockRemote, releaseRemote, setAutoContain, evaluate, isBlockedNow, autoContain, apply });
};

export const circuitBreaker = createCircuitBreaker();
