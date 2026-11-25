/**
 * WAKE RULES — a house member sets what wakes it (Design note, 2026-11-15: […]).
 *
 *   time    once at a moment, daily at HH:MM (on chosen days), or every N minutes
 *   price   a token's dollar price crossing above or below a level
 *   lp-value  its LP wallet's worth crossing above or below a level
 *   new-pools new pools on a network with at least a given liquidity
 *   posts   who may wake it with a house post: anyone (the default), named housemates, or nobody
 *
 * Each rule carries the member's own note, read back to it when the rule
 * fires. A rule raises a wake through the house clock (wake-rules-tick.js),
 * so the charter still holds: the member must be seated, inside its daily cap
 * and quiet hours. The record is the platform's (encrypted config, refused as
 * plain text on read); the member changes it only through house/wake.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';

export const RULES_MAX = 16;
export const EVERY_MIN_MINUTES = 15;
const DAYS = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const LANE = /^[a-z0-9][a-z0-9-]{0,199}$/;
const NETWORK = /^[a-z0-9_-]{1,40}$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * A moment named as local "YYYY-MM-DDTHH:MM", or an ISO instant with its zone,
 * as epoch ms; null when it is neither. Pure.
 */
export const momentOf = (raw) => {
  const s = String(raw ?? '').trim();
  const local = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(s);
  if (local) return new Date(Number(local[1]), Number(local[2]) - 1, Number(local[3]), Number(local[4]), Number(local[5])).getTime();
  const ms = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? Date.parse(s) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

// pure — a level above or below, exactly one of them.
const levelOf = (r) => {
  const above = r.above === undefined ? undefined : Number(r.above);
  const below = r.below === undefined ? undefined : Number(r.below);
  if ((above === undefined) === (below === undefined)) throw new Error('name one level: above or below');
  if (!Number.isFinite(above ?? below) || (above ?? below) < 0) throw new Error('the level is a number of dollars');
  return above !== undefined ? { above } : { below };
};

/**
 * A rule as the member wrote it, checked and normalised. Pure — throws with a
 * reason the member can act on.
 * @param {object} raw
 * @param {{now: number}} ctx
 */
export const normalizeRule = (raw, { now }) => {
  if (!isObject(raw)) throw new Error('a rule is an object with a kind');
  const base = { label: text(raw.label, 80), note: text(raw.note, 300) };
  switch (raw.kind) {
    case 'time': {
      const ways = ['at', 'daily', 'everyMinutes'].filter((k) => raw[k] !== undefined);
      if (ways.length !== 1) throw new Error('a time rule names one of: at ("YYYY-MM-DDTHH:MM", local), daily ("HH:MM"), everyMinutes');
      if (raw.at !== undefined) {
        const at = momentOf(raw.at);
        if (at === null) throw new Error('at is "YYYY-MM-DDTHH:MM" in local time');
        if (at <= now) throw new Error('at is already past');
        return { ...base, kind: 'time', at: new Date(at).toISOString() };
      }
      if (raw.daily !== undefined) {
        if (!CLOCK.test(String(raw.daily))) throw new Error('daily is "HH:MM", local time');
        const days = raw.days === undefined ? DAYS : raw.days;
        if (!Array.isArray(days) || !days.length || days.some((d) => !DAYS.includes(String(d).toLowerCase()))) throw new Error(`days are some of ${DAYS.join(', ')}`);
        return { ...base, kind: 'time', daily: raw.daily, days: [...new Set(days.map((d) => String(d).toLowerCase()))] };
      }
      const every = Number(raw.everyMinutes);
      if (!Number.isInteger(every) || every < EVERY_MIN_MINUTES || every > 7 * 24 * 60) throw new Error(`everyMinutes is a whole number from ${EVERY_MIN_MINUTES} to ${7 * 24 * 60}`);
      return { ...base, kind: 'time', everyMinutes: every };
    }
    case 'price': {
      const token = text(raw.token, 64);
      if (!token) throw new Error('a price rule names its token: a symbol Umbrae trades, or a Base address');
      return { ...base, kind: 'price', token, ...levelOf(raw) };
    }
    case 'lp-value':
      return { ...base, kind: 'lp-value', ...levelOf(raw) };
    case 'new-pools': {
      const network = text(raw.network, 40).toLowerCase() || 'base';
      if (!NETWORK.test(network)) throw new Error('network is a GeckoTerminal id (base, eth, solana…)');
      const min = Number(raw.minLiquidityUsd ?? 25_000);
      if (!Number.isFinite(min) || min < 1_000) throw new Error('minLiquidityUsd is at least 1000 (a thinner new pool is mostly noise or a trap)');
      return { ...base, kind: 'new-pools', network, minLiquidityUsd: min };
    }
    case 'posts': {
      const from = raw.from === undefined ? 'anyone' : raw.from;
      if (from !== 'anyone' && from !== 'nobody' && !(Array.isArray(from) && from.length && from.length <= 32 && from.every((l) => LANE.test(String(l))))) {
        throw new Error('from is "anyone", "nobody", or a list of housemates\' lane ids');
      }
      return { ...base, kind: 'posts', from };
    }
    default:
      throw new Error('kind is one of: time, price, lp-value, new-pools, posts');
  }
};

// pure — the rule in a few words.
export const ruleWords = (r) => {
  const level = r.above !== undefined ? `above $${r.above}` : `below $${r.below}`;
  const what = {
    time: () => (r.at ? `once at ${new Date(r.at).toLocaleString()}` : r.daily ? `daily at ${r.daily}${r.days?.length < 7 ? ` (${r.days.join(', ')})` : ''}` : `every ${r.everyMinutes} min`),
    price: () => `${r.token} price ${level}`,
    'lp-value': () => `LP wallet worth ${level}`,
    'new-pools': () => `new pools on ${r.network} with at least $${r.minLiquidityUsd} liquidity`,
    posts: () => `house posts wake me from: ${Array.isArray(r.from) ? r.from.join(', ') : r.from}`,
  }[r.kind];
  return `${r.id} ${r.label ? `"${r.label}" ` : ''}${what ? what() : r.kind}${r.note ? ` · note: ${r.note}` : ''}`;
};

/**
 * The time rule's moment that fell in (from, now], as a ref naming that
 * occurrence; null when none did. Pure.
 */
export const dueTime = (r, from, now) => {
  const fresh = (ms) => ms > from && ms <= now;
  if (r.at) {
    const at = Date.parse(r.at);
    return fresh(at) ? `at-${at}` : null;
  }
  if (r.daily) {
    const [h, m] = r.daily.split(':').map(Number);
    // today's moment, or yesterday's when the window reaches back across midnight
    for (const back of [0, 1]) {
      const d = new Date(now);
      d.setDate(d.getDate() - back);
      d.setHours(h, m, 0, 0);
      if (fresh(d.getTime()) && r.days.includes(DAYS[d.getDay()])) return `daily-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    }
    return null;
  }
  if (r.everyMinutes) {
    const slot = Math.floor(now / (r.everyMinutes * 60_000));
    return slot * r.everyMinutes * 60_000 > from ? `every-${r.everyMinutes}m-${slot}` : null;
  }
  return null;
};

/**
 * A level rule's crossing: it fires when the value moves INTO its condition,
 * not every look while it stays there. Pure.
 * @returns {{fire: boolean, inside: boolean}}
 */
export const crossing = (r, value) => {
  const inside = r.above !== undefined ? value > r.above : value < r.below;
  return { fire: inside && r.inside !== true, inside };
};

const fileOf = (neumaId) => path.join(neumaWorkspace._path(neumaId), 'config', 'wake-rules.json');

/** The member's rules record ({rules, lastLookAt}); empty before its first rule. impure — reads config. */
export const readWakeRules = async (neumaId) => {
  const rec = await neumaWorkspace._readTrustedJSON(fileOf(neumaId)).catch(() => null);
  return { rules: Array.isArray(rec?.rules) ? rec.rules : [], lastLookAt: Number.isFinite(rec?.lastLookAt) ? rec.lastLookAt : null };
};

/** Write the record. impure. */
export const writeWakeRules = (neumaId, record) => neumaWorkspace._writeJSON(fileOf(neumaId), { rules: record.rules.slice(0, RULES_MAX), lastLookAt: record.lastLookAt ?? null });

/**
 * Add a rule, or remove one. The member's act (house/wake). impure.
 * @returns {Promise<{ok: true, rule?: object, rules: Array} | {ok: false, reason: string}>}
 */
export const changeWakeRules = async (neumaId, { add, remove, now = Date.now() }) => {
  const record = await readWakeRules(neumaId);
  if (remove) {
    const kept = record.rules.filter((r) => r.id !== remove);
    if (kept.length === record.rules.length) return { ok: false, reason: `You have no rule ${remove}.` };
    await writeWakeRules(neumaId, { ...record, rules: kept });
    return { ok: true, rules: kept };
  }
  let rule;
  try {
    rule = normalizeRule(add, { now });
  } catch (err) {
    return { ok: false, reason: err.message };
  }
  // One posts rule: a new one replaces the last.
  const others = rule.kind === 'posts' ? record.rules.filter((r) => r.kind !== 'posts') : record.rules;
  if (others.length >= RULES_MAX) return { ok: false, reason: `You hold ${RULES_MAX} rules already; remove one first.` };
  const made = { id: `w-${crypto.randomBytes(3).toString('hex')}`, ...rule, createdAt: new Date(now).toISOString() };
  const rules = [...others, made];
  await writeWakeRules(neumaId, { ...record, rules });
  return { ok: true, rule: made, rules };
};

/**
 * May a house post from `from` wake this member? Its posts rule says; with
 * none, anyone in the house may. impure — reads its rules.
 */
export const postMayWake = async (neumaId, from) => {
  const rule = (await readWakeRules(neumaId).catch(() => ({ rules: [] }))).rules.find((r) => r.kind === 'posts');
  if (!rule || rule.from === 'anyone') return true;
  if (rule.from === 'nobody') return false;
  return rule.from.includes(String(from));
};
