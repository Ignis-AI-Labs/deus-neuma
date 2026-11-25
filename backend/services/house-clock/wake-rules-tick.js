/**
 * THE WAKE RULES' TICK — each house clock tick (house-clock.js clockTick), the
 * rules every member of this house set for itself (wake-rules.js) are looked
 * at, and each that fires becomes a wake (reason 'rule') in the house's queue.
 *
 *   time rules  every tick, against the window since this member's last look
 *               (never further back than 12 hours: a desk down for days does
 *               not wake a member for last week's moment)
 *   event rules at most every 5 minutes each: a price from Umbrae's pool list
 *               (a symbol it trades) or DexScreener (an address); the LP
 *               wallet's worth from its book; new pools from GeckoTerminal.
 *               A level rule fires when the value crosses INTO its condition.
 *
 * Event reads use the clients that hold the switches (Umbrae liquidity, Market
 * data): with a switch off, the rule waits and says why in its record.
 * Only the houses this backend serves, only their own lanes. impure.
 */
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { servesLane } from '../house-served.js';
import { createLogger } from '../logger.js';
import { callUmbrae } from '../umbrae-lp/umbrae-lp-client.js';
import { poolTokens } from '../umbrae-lp/lp-holdings.js';
import { readBook } from '../umbrae-lp/lp-book.js';
import { tokenMarkets, networkPools } from '../market-map/market-data.js';
import { enqueueWake } from './wake-queue.js';
import { readWakeRules, writeWakeRules, dueTime, crossing } from './wake-rules.js';

const log = createLogger('HouseClock.Rules');
const EVENT_EVERY_MS = 5 * 60_000;
const LOOKBACK_MAX_MS = 12 * 3_600_000;
const SEEN_KEPT = 100;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const clip = (s, n) => String(s ?? '').slice(0, n);
const usd = (v) => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: Number(v) < 1 ? 6 : 2 })}`;

// impure — one read per tick of each source, shared by every rule that needs it.
const sources = () => {
  let pools;
  const umbraeTokens = async () => {
    pools ??= callUmbrae('pools').then((out) => (out.ok ? poolTokens(out.payload) : { error: out.error }));
    return pools;
  };
  return {
    // a token's dollar price: a symbol Umbrae trades, or a Base address (the deepest DexScreener market where it is the base token)
    price: async (token) => {
      if (ADDRESS.test(token)) {
        const out = await tokenMarkets(token, 'base');
        if (!out.ok) return { error: out.error };
        const own = out.data.filter((p) => String(p.baseToken?.address ?? '').toLowerCase() === token.toLowerCase())
          .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0];
        return own && Number(own.priceUsd) > 0 ? { value: Number(own.priceUsd) } : { error: 'no market prices it' };
      }
      const book = await umbraeTokens();
      if (book.error) return { error: book.error };
      const hit = [...book.values()].find((t) => t.symbol.toLowerCase() === token.toLowerCase());
      return hit?.priceUsd ? { value: hit.priceUsd } : { error: `Umbrae trades no ${token}; name it by its Base address` };
    },
  };
};

// impure — one event rule looked at; returns {fire, what, patch}.
const lookAt = async (lane, rule, src, nowMs) => {
  if (rule.kind === 'price' || rule.kind === 'lp-value') {
    let read;
    if (rule.kind === 'price') read = await src.price(rule.token);
    else {
      const days = (await readBook(lane).catch(() => null))?.days ?? {};
      const last = Object.keys(days).sort().pop();
      read = last && Number.isFinite(days[last]?.valueUsd) ? { value: days[last].valueUsd } : { error: 'no LP wallet book yet' };
    }
    if (read.error) return { fire: false, patch: { waiting: clip(read.error, 160) } };
    const { fire, inside } = crossing(rule, read.value);
    const level = rule.above !== undefined ? `above ${usd(rule.above)}` : `below ${usd(rule.below)}`;
    return { fire, what: `${rule.kind === 'price' ? `${rule.token} is at ${usd(read.value)}` : `your LP wallet is worth ${usd(read.value)}`}, ${level}`, patch: { inside, lastValue: read.value, waiting: null } };
  }
  if (rule.kind === 'new-pools') {
    const out = await networkPools(rule.network, 'new');
    if (!out.ok) return { fire: false, patch: { waiting: clip(out.error, 160) } };
    const since = Date.parse(rule.createdAt);
    const seen = new Set(rule.seen ?? []);
    const fresh = out.data.map((p) => ({ name: p.attributes?.name, address: p.attributes?.address, tvl: Number(p.attributes?.reserve_in_usd), created: Date.parse(p.attributes?.pool_created_at) }))
      .filter((p) => p.address && !seen.has(p.address) && p.tvl >= rule.minLiquidityUsd && !(p.created < since));
    const patch = { seen: [...seen, ...fresh.map((p) => p.address)].slice(-SEEN_KEPT), waiting: null };
    if (!fresh.length) return { fire: false, patch };
    return { fire: true, what: `${fresh.length} new pool(s) on ${rule.network}: ${fresh.slice(0, 3).map((p) => `${p.name} (${usd(p.tvl)})`).join('; ')}`, patch };
  }
  return { fire: false, patch: {} };
};

// pure — the wake's detail, kept inside the queue's 400-character bound.
const detailOf = (rule, what) => {
  const d = { label: clip(rule.label, 60), what: clip(what, 170), note: clip(rule.note, 150) };
  while (JSON.stringify(d).length > 380 && d.note.length > 20) d.note = `${d.note.slice(0, -21)}…`;
  return d;
};

/**
 * One house's wake rules, looked at once. impure, never throws per member.
 * @param {string} wallet
 * @param {number} now - epoch ms
 * @returns {Promise<Array<object>>} the wakes offered
 */
export const wakeRulesTick = async (wallet, now) => {
  const lanes = (await neumaWorkspace.listNeumaByOwner(wallet).catch(() => [])).map((o) => o.neumaId);
  const src = sources();
  const offered = [];
  for (const lane of lanes) {
    try {
      const record = await readWakeRules(lane);
      if (!record.rules.length || !(await servesLane(lane, wallet))) continue;
      const from = Math.max(record.lastLookAt ?? now - 60_000, now - LOOKBACK_MAX_MS);
      const rules = [];
      for (const rule of record.rules) {
        let fired = null;
        let next = rule;
        if (rule.kind === 'time' && !rule.done) {
          const ref = dueTime(rule, from, now);
          if (ref) fired = { ref, what: rule.at ? `the moment you set (${new Date(rule.at).toLocaleString()})` : rule.daily ? `your daily ${rule.daily}` : `your every-${rule.everyMinutes}-minutes look` };
          if (ref && rule.at) next = { ...rule, done: true };
        } else if (['price', 'lp-value', 'new-pools'].includes(rule.kind) && now - (rule.lastCheckedAt ?? 0) >= EVENT_EVERY_MS) {
          const look = await lookAt(lane, rule, src, now);
          next = { ...rule, ...look.patch, lastCheckedAt: now };
          if (look.fire) fired = { ref: `${rule.kind}-${now}`, what: look.what };
        }
        if (fired) {
          const taken = await enqueueWake(wallet, { seat: lane, reason: 'rule', ref: `${rule.id}:${fired.ref}`, detail: detailOf(rule, fired.what) });
          next = { ...next, lastFiredAt: new Date(now).toISOString(), lastFired: clip(fired.what, 200), ...(taken.queued ? { held: null } : { held: clip(taken.why, 160) }) };
          offered.push(taken);
        }
        rules.push(next);
      }
      await writeWakeRules(lane, { rules, lastLookAt: now });
    } catch (err) {
      log.warn('wake rules not looked at', { lane, error: err.message });
    }
  }
  return offered;
};
