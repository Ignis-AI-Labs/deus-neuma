// The cost meter's display law (the TREASURY window's RUNNING COSTS): each
// month's figures in plain words, the forms' readiness, and the bodies the
// routes take. Sums in different currencies stand apart, never converted;
// a missing reading is said, never shown as zero. PURE.

const MONTH_NAMES = Object.freeze(['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']);

/** An amount of money, two places, thousands separated. pure. */
export const cash = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 2026-10 → OCTOBER 2026. pure. */
export const monthName = (month) => {
  const [y, m] = String(month).split('-').map(Number);
  return MONTH_NAMES[m - 1] ? `${MONTH_NAMES[m - 1]} ${y}` : String(month);
};

/** A month's totals, one per currency. pure. */
export const totalsWords = (statement) => (statement.totals.length
  ? statement.totals.map((t) => `${cash(t.amount)} ${t.currency}`).join(' + ')
  : 'NOTHING COUNTED YET');

/** A span of meter time: minutes under the hour, hours to a tenth past it. pure. */
export const span = (minutes) => (minutes < 60 ? `${minutes} MIN` : `${Math.round(minutes / 6) / 10} H`);

/** The month's GPU energy: what the meter read, this house's part, its price. pure. */
export const energyWords = (energy) => {
  if (!energy.meterMinutes) return 'GPU ENERGY — THE METER WAS NOT ON THIS MONTH';
  const read = `READ ${span(energy.measuredMinutes)} OF THE ${span(energy.meterMinutes)} THE METER STOOD ON`;
  if (!energy.segments.length) return `GPU ENERGY — NONE READ · ${read}`;
  const priced = energy.segments.map((g) => `${g.kwh} kWh × ${g.pricePerKwh} ${g.currency} = ${cash(g.cost)} ${g.currency}${g.sharePct < 100 ? ` (${g.sharePct}% OF THE MACHINE)` : ''}`).join(' · ');
  return `GPU ENERGY — ${priced} · ${read}`;
};

/** One fixed cost as it stands on the record. pure. */
export const costWords = (c) => (c.kind === 'hardware'
  ? `${c.what} — HARDWARE, ${cash(c.price)} ${c.currency} OVER ${c.months} MONTHS FROM ${monthName(c.since)} — ${cash(c.monthly)} ${c.currency} A MONTH`
  : `${c.what} — ${cash(c.monthly)} ${c.currency} A MONTH FROM ${monthName(c.since)}${c.until ? ` TO ${monthName(c.until)}` : ''}`);

/** A fixed cost's line in a month: hardware says which of its months this is. pure. */
export const fixedWords = (c) => `${c.what} — ${cash(c.amount)} ${c.currency}${c.kind === 'hardware' ? ` (MONTH ${c.nth} OF ${c.of} OF ITS PRICE)` : ''}`;

/** One bill as it stands on the record. pure. */
export const billWords = (b) => `${b.provider} — API BILL FOR ${monthName(b.month)} — ${cash(b.amount)} ${b.currency}`;

/** The meter's setting, said. pure. */
export const meterWords = (meter) => (meter?.on
  ? `METER ON — ${meter.setup.pricePerKwh} ${meter.setup.currency} PER kWh · ${meter.setup.sharePct}% OF THIS MACHINE IS THIS HOUSE'S`
  : 'THE METER IS OFF — SET YOUR ELECTRICITY RATE TO START IT');

const filled = (v) => String(v ?? '').trim() !== '';
const num = (v) => Number(v) > 0;

/** May this form be sent yet? The routes judge it whole; this keeps the button honest. pure. */
export const formReady = (form, d = {}) => {
  if (form === 'setup') return filled(d.currency) && num(d.pricePerKwh) && filled(d.priceSource);
  if (form === 'cost') {
    const base = filled(d.what) && filled(d.currency) && filled(d.since) && filled(d.source);
    return base && (d.kind === 'monthly' ? num(d.monthly) : num(d.price) && num(d.months));
  }
  if (form === 'bill') return filled(d.provider) && filled(d.month) && num(d.amount) && filled(d.currency) && filled(d.source);
  return false;
};

/** The body a form sends. pure. */
export const formBody = (form, d = {}) => {
  if (form === 'setup') return { on: true, currency: String(d.currency).trim().toUpperCase(), pricePerKwh: Number(d.pricePerKwh), priceSource: d.priceSource, sharePct: filled(d.sharePct) ? Number(d.sharePct) : 100 };
  if (form === 'cost') {
    const base = { kind: d.kind === 'monthly' ? 'monthly' : 'hardware', what: d.what, currency: String(d.currency).trim().toUpperCase(), since: d.since, source: d.source };
    return base.kind === 'monthly' ? { ...base, monthly: Number(d.monthly), until: filled(d.until) ? d.until : null } : { ...base, price: Number(d.price), months: Number(d.months) };
  }
  return { provider: d.provider, month: d.month, amount: Number(d.amount), currency: String(d.currency).trim().toUpperCase(), source: d.source };
};
