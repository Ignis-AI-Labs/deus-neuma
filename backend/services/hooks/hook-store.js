/**
 * THE HOOKS A HOUSE HAS GIVEN OUT — each one an address a service (GitHub,
 * Slack, Linear, a script) may deliver events to, the secret it signs them
 * with, the house it belongs to and the seat it wakes.
 *
 *   <data root>/hooks/hooks.json          the hooks, their secrets, the deliveries seen
 *   <data root>/hooks/events/<id>.jsonl   what each delivered, newest last, bounded
 *
 * The secret is kept because a signature cannot be checked without it; the
 * file is the operator's alone (0600) and the secret is shown once, when it is
 * made or rotated. Every read for a person (listHooks) leaves it out.
 *
 * impure — the data root, one write at a time.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { getDataRoot } from '../data-root.js';
import { HOOK_SOURCES } from './hook-verify.js';

/** Hooks one house may hold. */
export const HOOKS_PER_HOUSE_MAX = 32;
/** Delivery ids remembered per hook, to refuse a replay. */
export const DELIVERIES_REMEMBERED = 500;
/** Events kept per hook. */
export const EVENTS_KEPT = 200;

const LANE_ID = /^[a-zA-Z0-9_-]{1,200}$/;
const HOOK_ID = /^hk_[a-f0-9]{16}$/;

const dir = () => path.join(getDataRoot(), 'hooks');
const storeFile = () => path.join(dir(), 'hooks.json');
const eventsFile = (id) => path.join(dir(), 'events', `${id}.jsonl`);

export class HookError extends Error {}

const read = async () => {
  try {
    const parsed = JSON.parse(await fs.readFile(storeFile(), 'utf8'));
    return Array.isArray(parsed?.hooks) ? parsed : { hooks: [] };
  } catch (error) {
    if (error.code === 'ENOENT') return { hooks: [] };
    throw error;
  }
};

const write = async (state) => {
  await fs.mkdir(dir(), { recursive: true, mode: 0o700 });
  const tmp = `${storeFile()}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, storeFile());
};

// One change at a time: two deliveries landing together must not lose a seen id.
let chain = Promise.resolve();
const serialize = (fn) => {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
};

const sameWallet = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/** What a person may see of a hook: never its secret. Pure. */
export const publicHook = (h) => ({
  id: h.id, name: h.name, source: h.source, seat: h.seat, createdAt: h.createdAt, secretFrom: h.secretFrom ?? 'neuma',
  lastDeliveryAt: h.lastDeliveryAt ?? null, deliveries: h.deliveries ?? 0, path: `/api/v1/hooks/in/${h.id}`,
});

/**
 * Give out a new hook. The caller has already proven the seat is the wallet's own.
 * impure.
 * @returns {Promise<{ hook: object, secret: string }>}
 */
export const createHook = ({ wallet, seat, source, name }) => serialize(async () => {
  if (!wallet) throw new HookError('a hook belongs to a house — no wallet');
  if (!HOOK_SOURCES.includes(source)) throw new HookError(`source is one of: ${HOOK_SOURCES.join(', ')}`);
  if (!LANE_ID.test(String(seat || ''))) throw new HookError('name the being the hook wakes (its lane id)');
  const label = String(name || '').trim();
  if (!label || label.length > 60) throw new HookError('give the hook a name of 1 to 60 characters');
  const state = await read();
  if (state.hooks.filter((h) => sameWallet(h.wallet, wallet)).length >= HOOKS_PER_HOUSE_MAX) {
    throw new HookError(`a house holds at most ${HOOKS_PER_HOUSE_MAX} hooks — remove one first`);
  }
  const hook = {
    id: `hk_${randomBytes(8).toString('hex')}`,
    wallet: String(wallet).toLowerCase(),
    seat, source, name: label,
    secret: randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
    deliveries: 0, lastDeliveryAt: null, seen: [],
  };
  state.hooks.push(hook);
  await write(state);
  return { hook: publicHook(hook), secret: hook.secret };
});

/** impure — the house's hooks, as a person may see them. */
export const listHooks = async (wallet) => (await read()).hooks.filter((h) => sameWallet(h.wallet, wallet)).map(publicHook);

/** impure — take a hook back; its address stops answering at once. */
export const removeHook = (wallet, id) => serialize(async () => {
  const state = await read();
  const before = state.hooks.length;
  state.hooks = state.hooks.filter((h) => !(h.id === id && sameWallet(h.wallet, wallet)));
  if (state.hooks.length === before) return false;
  await write(state);
  await fs.rm(eventsFile(id), { force: true });
  return true;
});

/** impure — a new secret; the old one stops verifying at once. */
export const rotateHookSecret = (wallet, id) => serialize(async () => {
  const state = await read();
  const hook = state.hooks.find((h) => h.id === id && sameWallet(h.wallet, wallet));
  if (!hook) throw new HookError(`no hook ${id} in this house`);
  hook.secret = randomBytes(32).toString('hex');
  await write(state);
  return { hook: publicHook(hook), secret: hook.secret };
});

/** A service's own signing secret is at least this long (Slack's and Linear's are 32 characters or more). */
export const SECRET_MIN_CHARS = 16;

/**
 * Use the service's own signing secret. Slack and Linear make theirs and do not
 * take one from us; GitHub and the generic form take ours, so they never need this.
 * impure.
 */
export const setHookSecret = (wallet, id, secret) => serialize(async () => {
  const value = String(secret ?? '').trim();
  if (value.length < SECRET_MIN_CHARS || /\s/.test(value)) throw new HookError(`a signing secret is one word of at least ${SECRET_MIN_CHARS} characters`);
  const state = await read();
  const hook = state.hooks.find((h) => h.id === id && sameWallet(h.wallet, wallet));
  if (!hook) throw new HookError(`no hook ${id} in this house`);
  hook.secret = value;
  hook.secretFrom = 'service';
  await write(state);
  return publicHook(hook);
});

/** impure — the hook a delivery names, secret included; null for anything not a hook. */
export const hookForDelivery = async (id) => {
  if (!HOOK_ID.test(String(id || ''))) return null;
  return (await read()).hooks.find((h) => h.id === id) ?? null;
};

/**
 * Note a verified delivery. A delivery id already seen is a replay (or a
 * service's retry of one already taken) and is not taken again.
 * impure.
 * @returns {Promise<{ fresh: boolean }>}
 */
export const noteDelivery = (id, deliveryId) => serialize(async () => {
  const state = await read();
  const hook = state.hooks.find((h) => h.id === id);
  if (!hook) return { fresh: false };
  hook.seen = Array.isArray(hook.seen) ? hook.seen : [];
  if (hook.seen.includes(deliveryId)) return { fresh: false };
  hook.seen = [...hook.seen, deliveryId].slice(-DELIVERIES_REMEMBERED);
  hook.deliveries = (hook.deliveries ?? 0) + 1;
  hook.lastDeliveryAt = new Date().toISOString();
  await write(state);
  return { fresh: true };
});

/** impure — keep what a delivery said, the newest EVENTS_KEPT. */
export const appendHookEvent = (id, record) => serialize(async () => {
  await fs.mkdir(path.dirname(eventsFile(id)), { recursive: true, mode: 0o700 });
  const prior = await fs.readFile(eventsFile(id), 'utf8').catch(() => '');
  const lines = [...prior.split('\n').filter(Boolean), JSON.stringify(record)].slice(-EVENTS_KEPT);
  await fs.writeFile(eventsFile(id), `${lines.join('\n')}\n`, { mode: 0o600 });
});

/** impure — a hook's events, newest first, for its own house only. */
export const readHookEvents = async (wallet, id, limit = 50) => {
  const hook = (await read()).hooks.find((h) => h.id === id && sameWallet(h.wallet, wallet));
  if (!hook) throw new HookError(`no hook ${id} in this house`);
  const lines = (await fs.readFile(eventsFile(id), 'utf8').catch(() => '')).split('\n').filter(Boolean);
  return lines.slice(-limit).reverse().map((l) => JSON.parse(l));
};
