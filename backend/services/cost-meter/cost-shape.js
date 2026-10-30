// THE COST METER — what the house costs to run, month by month (the house
// economy's Stage 3, the Quaestor's office; house-economy-benchmark.md): the
// GPU's energy, read once a minute and priced at the operator's own
// electricity rate; the hardware's cost spread over its months, and rent and
// any other monthly cost, entered once; and each provider's API bill, entered
// from the bill itself. It is the denominator of the house's coverage
// (revenue ÷ cost).
//
// SHINKEI (true measure): every figure names its source; a minute the meter
// did not read stands as unmeasured, never filled in; sums in different
// currencies stand apart, never converted.
//
// Events (cost-store.js appends them, per house):
//   { type: 'setup', setup, at }   the electricity rate (the meter on), or the meter off
//   { type: 'cost', cost, at }     a fixed cost: hardware over its months, or a monthly one
//   { type: 'bill', bill, at }     one provider's bill for one month
//   { type: 'voided', id, reason, by, at }   a wrong cost or bill, never edited
// Power samples, one per minute the meter read: { m: <the minute, ISO>, w: <watts, every GPU> }
// Months are the machine's own calendar months (the operator's clock).
// PURE, but for the random ids.

import crypto from 'crypto';
import { sourceLaw } from '../company-line/source-law.js';

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const CURRENCY = /^[A-Z]{3,6}$/;
const MINUTE_MS = 60_000;
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max);
const { isSource, words: SOURCE_WORDS } = sourceLaw(['bill', 'invoice', 'statement', 'receipt', 'tariff']);
const id = (prefix) => `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

// pure — a positive number, or a thrown reason.
const positive = (value, what) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${what}: a number above zero`);
  return n;
};
const currencyOf = (value) => {
  if (!CURRENCY.test(String(value))) throw new Error('currency: USD, EUR, THB …');
  return String(value);
};
const sourceOf = (value, what) => {
  if (!isSource(value)) throw new Error(`${what} — ${SOURCE_WORDS}`);
  return clean(value, 300);
};
const monthArg = (value, what) => {
  if (!MONTH.test(String(value))) throw new Error(`${what}: a month, YYYY-MM`);
  return String(value);
};

/**
 * The meter's setting: the electricity rate and this house's share of the
 * machine (the meter on), or the meter off. Pure.
 */
export const makeSetup = ({ on, currency, pricePerKwh, priceSource, sharePct = 100, by, now }) => {
  if (on === false) return Object.freeze({ on: false, by, setAt: now });
  const share = Number(sharePct);
  if (!Number.isFinite(share) || share <= 0 || share > 100) throw new Error('sharePct: this house\'s share of the machine, 1 to 100');
  return Object.freeze({
    on: true, currency: currencyOf(currency), pricePerKwh: positive(pricePerKwh, 'pricePerKwh'),
    priceSource: sourceOf(priceSource, 'priceSource: where the rate comes from'), sharePct: share, by, setAt: now,
  });
};

/**
 * One fixed cost: hardware (its price over its months, from the month bought)
 * or a monthly cost (rent, a subscription) from a month on, until a month if
 * it ends. Pure but for its id.
 */
export const makeCost = ({ kind, what, price, months, monthly, currency, since, until = null, source, by, now }) => {
  const named = clean(what, 160);
  if (named.length < 3) throw new Error('what: the machine, the rent, the subscription');
  const base = { what: named, currency: currencyOf(currency), since: monthArg(since, 'since'), source: sourceOf(source, 'source: the receipt or bill'), by, setAt: now };
  if (kind === 'hardware') {
    const span = Number(months);
    if (!Number.isInteger(span) || span < 1 || span > 120) throw new Error('months: how many months it is paid off over, 1 to 120');
    const total = positive(price, 'price');
    return Object.freeze({ id: id('c'), kind, ...base, price: total, months: span, monthly: total / span });
  }
  if (kind !== 'monthly') throw new Error('kind is hardware or monthly');
  const end = until === null || until === '' ? null : monthArg(until, 'until');
  if (end && end < base.since) throw new Error('until: a month after it began');
  return Object.freeze({ id: id('c'), kind, ...base, monthly: positive(monthly, 'monthly'), until: end });
};

/** One provider's bill for one month. Pure but for its id. */
export const makeBill = ({ provider, month, amount, currency, source, by, now }) => {
  const who = clean(provider, 80);
  if (who.length < 2) throw new Error('provider: who billed it (Anthropic, OpenRouter …)');
  return Object.freeze({
    id: id('i'), provider: who, month: monthArg(month, 'month'), amount: positive(amount, 'amount'),
    currency: currencyOf(currency), source: sourceOf(source, 'source: the bill itself'), by, setAt: now,
  });
};

/**
 * Fold the record: every setting in order, the live costs and bills, the
 * voided ones. pure.
 * @param {Array<object>} events
 */
export const foldMeter = (events) => {
  const meter = events.reduce((acc, e) => {
    if (e?.type === 'setup' && e.setup) return { ...acc, setups: [...acc.setups, e.setup] };
    if (e?.type === 'cost' && e.cost?.id) return { ...acc, costs: [...acc.costs, e.cost] };
    if (e?.type === 'bill' && e.bill?.id) return { ...acc, bills: [...acc.bills, e.bill] };
    const wrong = e?.type === 'voided' && [...acc.costs, ...acc.bills].find((x) => x.id === e.id);
    if (wrong) {
      return {
        ...acc, costs: acc.costs.filter((x) => x.id !== e.id), bills: acc.bills.filter((x) => x.id !== e.id),
        voided: [...acc.voided, { ...wrong, void: { reason: e.reason, by: e.by, at: e.at } }],
      };
    }
    return { ...acc, skipped: acc.skipped + 1 };
  }, { setups: [], costs: [], bills: [], voided: [], skipped: 0 });
  const setup = meter.setups.at(-1) ?? null;
  return { ...meter, setup, on: Boolean(setup?.on) };
};

/** The month a moment falls in, on the machine's calendar. pure (the machine's clock zone). */
export const monthOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** The month before. pure. */
export const monthBefore = (month) => {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/** A month's bounds, on the machine's calendar. pure. */
export const monthWindow = (month) => {
  const [y, m] = month.split('-').map(Number);
  return { fromMs: new Date(y, m - 1, 1).getTime(), toMs: new Date(y, m, 1).getTime() };
};

/** The minute a sample stands for. pure. */
export const minuteOf = (ms) => new Date(Math.floor(ms / MINUTE_MS) * MINUTE_MS).toISOString();

/** nvidia-smi's power.draw, one line per GPU → the watts of them all, or null. pure. */
export const powerOf = (csv) => {
  const watts = String(csv ?? '').split('\n').map((s) => Number.parseFloat(s.trim())).filter(Number.isFinite);
  return watts.length ? round(watts.reduce((a, b) => a + b, 0), 2) : null;
};

// pure — the minute a setting takes hold: the whole minute it was set in.
const heldFrom = (setup) => Math.floor(Date.parse(setup.setAt) / MINUTE_MS) * MINUTE_MS;

// pure — the setting in force at a minute (the last one held by then).
const setupAt = (setups, ms) => setups.filter((s) => heldFrom(s) <= ms).at(-1) ?? null;

// pure — the minutes the meter stood on inside [fromMs, endMs).
const onMinutes = (setups, fromMs, endMs) => setups.reduce((sum, s, i) => {
  if (!s.on) return sum;
  const start = Math.max(heldFrom(s), fromMs);
  const stop = Math.min(i + 1 < setups.length ? heldFrom(setups[i + 1]) : endMs, endMs);
  return stop > start ? sum + Math.ceil((stop - start) / MINUTE_MS) : sum; // the minute under way counts, as its reading does
}, 0);

const addMonths = (month, n) => {
  const [y, m] = month.split('-').map(Number);
  const k = y * 12 + (m - 1) + n;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`;
};

// pure — whole months from one to another.
const monthsFrom = (from, to) => {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
};

// pure — the fixed costs standing in a month.
const fixedIn = (costs, month) => costs.filter((c) => {
  if (month < c.since) return false;
  if (c.kind === 'hardware') return month <= addMonths(c.since, c.months - 1);
  return !c.until || month <= c.until;
});

/**
 * What one month cost the house: the energy the meter read and its price,
 * the fixed costs standing that month, the bills entered for it, the totals
 * per currency, and what the figures are missing. pure.
 * @param {{meter: object, samples: Array<{m: string, w: number}>, month: string, nowMs: number}} args
 */
export const monthStatement = ({ meter, samples, month, nowMs }) => {
  const { fromMs, toMs } = monthWindow(month);
  const endMs = Math.min(toMs, nowMs);
  const seen = new Set();
  const segments = new Map();
  let machineKwh = 0;
  for (const s of samples) {
    const ms = Date.parse(s?.m);
    if (!Number.isFinite(ms) || ms < fromMs || ms >= endMs || !Number.isFinite(s.w) || seen.has(s.m)) continue;
    const setup = setupAt(meter.setups, ms);
    if (!setup?.on) continue;
    seen.add(s.m);
    const kwh = s.w / 60 / 1000;
    machineKwh += kwh;
    const seg = segments.get(setup.setAt) ?? { currency: setup.currency, pricePerKwh: setup.pricePerKwh, priceSource: setup.priceSource, sharePct: setup.sharePct, kwh: 0 };
    segments.set(setup.setAt, { ...seg, kwh: seg.kwh + kwh * (setup.sharePct / 100) });
  }
  const energy = [...segments.values()].map((g) => ({ ...g, kwh: round(g.kwh, 3), cost: round(g.kwh * g.pricePerKwh, 2) }));
  const fixed = fixedIn(meter.costs, month).map((c) => ({
    id: c.id, kind: c.kind, what: c.what, currency: c.currency, amount: round(c.monthly, 2), source: c.source,
    ...(c.kind === 'hardware' ? { nth: monthsFrom(c.since, month) + 1, of: c.months } : {}),
  }));
  const bills = meter.bills.filter((b) => b.month === month).map((b) => ({ id: b.id, provider: b.provider, currency: b.currency, amount: b.amount, source: b.source }));
  const totals = [...energy.map((g) => [g.currency, g.cost]), ...fixed.map((c) => [c.currency, c.amount]), ...bills.map((b) => [b.currency, b.amount])]
    .reduce((acc, [c, n]) => ({ ...acc, [c]: round((acc[c] ?? 0) + n, 2) }), {});
  const elapsed = endMs > fromMs ? onMinutes(meter.setups, fromMs, endMs) : 0;
  const unmeasured = Math.max(0, elapsed - seen.size);
  const missing = [
    ...(meter.setups.some((s) => s.on) ? [] : ['the meter is off — set your electricity rate to start it']),
    ...(unmeasured >= 60 ? [`${round(unmeasured / 60, 1)} h of meter time not read — the desk was off, or the GPU gave no reading`] : []),
    ...(fixed.length ? [] : ['no hardware or rent entered']),
    ...(bills.length ? [] : ['no API bill entered for this month']),
  ];
  return {
    month, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(),
    energy: { machineKwh: round(machineKwh, 3), measuredMinutes: seen.size, meterMinutes: elapsed, unmeasuredMinutes: unmeasured, segments: energy },
    fixed, bills,
    totals: Object.entries(totals).map(([currency, amount]) => ({ currency, amount })),
    missing,
  };
};

/** One month's statement as one plain line (the Quaestor's read). pure. */
export const statementWords = (s) => {
  const totals = s.totals.map((t) => `${t.amount} ${t.currency}`).join(' + ') || 'nothing yet';
  const energy = `${s.energy.machineKwh} kWh read over ${Math.round(s.energy.measuredMinutes / 6) / 10} h`;
  const parts = [...s.fixed.map((c) => `${c.what} ${c.amount} ${c.currency}`), ...s.bills.map((b) => `${b.provider} bill ${b.amount} ${b.currency}`)];
  return `${s.month}: ${totals} — GPU energy ${energy}${parts.length ? `; ${parts.join('; ')}` : ''}${s.missing.length ? ` — missing: ${s.missing.join('; ')}` : ''}.`;
};
