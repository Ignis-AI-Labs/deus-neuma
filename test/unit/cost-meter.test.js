/**
 * THE COST METER's law (the house economy's Stage 3, RULE 0): the real shapes
 * refuse a figure with no source; the real fold voids a wrong entry and keeps
 * every setting in order; a month's statement counts only the minutes the
 * meter stood on and read, prices each at the rate then in force and the
 * house's share, never fills a gap, and keeps currencies apart; and the
 * TREASURY window's RUNNING COSTS rendered for real (react-dom/server) over
 * statements the real law built.
 */
import { describe, test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  makeSetup, makeCost, makeBill, foldMeter, monthStatement, monthWindow, monthOf, monthBefore, minuteOf, powerOf, statementWords,
} from '../../backend/services/cost-meter/cost-shape.js';
import { cash, monthName, energyWords, formReady, formBody, meterWords } from '../../frontend/app/RelinkShell/cost-meter-view.js';
import { CostMeter } from '../../frontend/app/RelinkShell/CostMeter.jsx';

const OCT = '2026-10';
const { fromMs } = monthWindow(OCT);
const at = (min) => new Date(fromMs + min * 60_000).toISOString();
const SRC = 'bill: Metro Power, September 2026';
const RATE_FIELDS = { currency: 'USD', priceSource: SRC };
const setup = (min, fields) => ({ type: 'setup', setup: makeSetup({ currency: 'USD', priceSource: SRC, by: 'operator', now: at(min), ...fields }), at: at(min) });
const samples = (from, to, w) => Array.from({ length: to - from }, (_, i) => ({ m: at(from + i), w }));

describe('the cost meter\'s shapes: every figure names its source', () => {
  test('the rate: a currency, a price above zero, where it comes from, a share of 1 to 100', () => {
    expect(() => makeSetup({ currency: 'usd', pricePerKwh: 0.2, priceSource: SRC })).toThrow(/currency/);
    expect(() => makeSetup({ currency: 'USD', pricePerKwh: 0, priceSource: SRC })).toThrow(/pricePerKwh/);
    expect(() => makeSetup({ currency: 'USD', pricePerKwh: 0.2, priceSource: 'my guess' })).toThrow(/priceSource/);
    expect(() => makeSetup({ currency: 'USD', pricePerKwh: 0.2, priceSource: SRC, sharePct: 0 })).toThrow(/sharePct/);
    expect(makeSetup({ currency: 'THB', pricePerKwh: '4.5', priceSource: 'https://www.pea.co.th/tariff', by: 'operator', now: at(0) }))
      .toEqual({ on: true, currency: 'THB', pricePerKwh: 4.5, priceSource: 'https://www.pea.co.th/tariff', sharePct: 100, by: 'operator', setAt: at(0) });
    expect(makeSetup({ on: false, by: 'operator', now: at(1) })).toEqual({ on: false, by: 'operator', setAt: at(1) });
  });

  test('a fixed cost: hardware paid off over 1 to 120 months, a monthly one that ends after it began', () => {
    const base = { what: 'the rig', currency: 'USD', since: '2026-01', source: 'receipt: Micro Center, 2026-01-04', by: 'operator', now: at(0) };
    const rig = makeCost({ ...base, kind: 'hardware', price: 3600, months: 36 });
    expect(rig).toMatchObject({ kind: 'hardware', price: 3600, months: 36, monthly: 100 });
    expect(rig.id).toMatch(/^c-[a-f0-9]{8}$/);
    expect(() => makeCost({ ...base, kind: 'hardware', price: 3600, months: 0 })).toThrow(/months/);
    expect(() => makeCost({ ...base, kind: 'hardware', price: 3600, months: 36, source: 'trust me' })).toThrow(/source/);
    expect(() => makeCost({ ...base, kind: 'monthly', monthly: 50, until: '2025-12' })).toThrow(/until/);
    expect(() => makeCost({ ...base, kind: 'lease', monthly: 50 })).toThrow(/kind/);
    expect(makeCost({ ...base, kind: 'monthly', monthly: 50, until: '' })).toMatchObject({ monthly: 50, until: null });
  });

  test('a bill: one provider, one month, from the bill itself', () => {
    const bill = { provider: 'Anthropic', month: OCT, amount: 12.5, currency: 'USD', source: 'invoice: INV-2026-10-1182', by: 'operator', now: at(0) };
    expect(makeBill(bill).id).toMatch(/^i-[a-f0-9]{8}$/);
    expect(() => makeBill({ ...bill, month: '2026-13' })).toThrow(/month/);
    expect(() => makeBill({ ...bill, source: '' })).toThrow(/source/);
  });

  test('the fold: a wrong entry is voided whole, never edited; the last setting is the meter\'s', () => {
    const rig = makeCost({ kind: 'hardware', what: 'the rig', price: 3600, months: 36, currency: 'USD', since: '2026-01', source: 'receipt: Micro Center', by: 'operator', now: at(0) });
    const meter = foldMeter([
      setup(0, { pricePerKwh: 0.2 }), { type: 'cost', cost: rig, at: at(1) },
      { type: 'voided', id: rig.id, reason: 'entered twice', by: 'operator', at: at(2) },
      { type: 'voided', id: 'c-00000000', reason: 'nothing', by: 'operator', at: at(3) },
      { type: 'setup', setup: makeSetup({ on: false, by: 'operator', now: at(4) }), at: at(4) },
    ]);
    expect(meter.costs).toEqual([]);
    expect(meter.voided).toEqual([{ ...rig, void: { reason: 'entered twice', by: 'operator', at: at(2) } }]);
    expect(meter.skipped).toBe(1);
    expect(meter.setups).toHaveLength(2);
    expect(meter.on).toBe(false);
  });

  test('the GPU\'s draw: every card summed; a card that cannot say is left out; none at all is null', () => {
    expect(powerOf('345.12\n[N/A]\n100.00\n')).toBe(445.12);
    expect(powerOf('[N/A]')).toBeNull();
    expect(powerOf('')).toBeNull();
    expect(minuteOf(fromMs + 90_500)).toBe(at(1));
    expect(monthOf(fromMs)).toBe(OCT);
    expect(monthBefore('2026-01')).toBe('2025-12');
  });
});

describe('a month\'s statement: only what the meter read, at the rate then in force', () => {
  const rig = makeCost({ kind: 'hardware', what: 'the rig', price: 3600, months: 36, currency: 'USD', since: '2026-01', source: 'receipt: Micro Center', by: 'operator', now: at(0) });
  const oldCard = makeCost({ kind: 'hardware', what: 'the old card', price: 720, months: 36, currency: 'USD', since: '2023-10', source: 'receipt: eBay, 2023-10-02', by: 'operator', now: at(0) });
  const tool = makeCost({ kind: 'monthly', what: 'a design tool', monthly: 20, currency: 'USD', since: '2026-01', until: OCT, source: 'invoice: Figma, October 2026', by: 'operator', now: at(0) });
  const rent = makeCost({ kind: 'monthly', what: 'the desk rent', monthly: 50, currency: 'EUR', since: '2026-11', source: 'statement: the landlord', by: 'operator', now: at(0) });
  const anthropic = makeBill({ provider: 'Anthropic', month: OCT, amount: 12.5, currency: 'USD', source: 'invoice: INV-1182', by: 'operator', now: at(0) });
  const september = makeBill({ provider: 'OpenRouter', month: '2026-09', amount: 3, currency: 'USD', source: 'invoice: OR-77', by: 'operator', now: at(0) });
  const meter = foldMeter([
    setup(10, { pricePerKwh: 0.2, sharePct: 50 }),
    { type: 'setup', setup: makeSetup({ on: false, by: 'operator', now: at(70) }), at: at(70) },
    setup(130, { pricePerKwh: 0.4 }),
    ...[rig, oldCard, tool, rent].map((cost) => ({ type: 'cost', cost, at: at(0) })),
    ...[anthropic, september].map((bill) => ({ type: 'bill', bill, at: at(0) })),
  ]);
  const read = [
    ...samples(0, 6, 600), // before the meter was set: not the house's to count
    ...samples(10, 70, 600), // on, at 0.2 USD and half the machine
    { m: at(20), w: 600 }, // the same minute read twice (two desks on one machine): counted once
    ...samples(70, 130, 600), // the meter off
    ...samples(130, 160, 300), // on again at 0.4 USD — then the desk went down for 90 minutes
  ];
  const s = monthStatement({ meter, samples: read, month: OCT, nowMs: fromMs + 250 * 60_000 });

  test('the energy: read minutes inside the meter\'s on-time, each priced by the setting in force', () => {
    expect(s.energy).toEqual({
      machineKwh: 0.75, measuredMinutes: 90, meterMinutes: 180, unmeasuredMinutes: 90,
      segments: [
        { currency: 'USD', pricePerKwh: 0.2, priceSource: SRC, sharePct: 50, kwh: 0.3, cost: 0.06 },
        { currency: 'USD', pricePerKwh: 0.4, priceSource: SRC, sharePct: 100, kwh: 0.15, cost: 0.06 },
      ],
    });
  });

  test('the fixed costs standing that month, its bills, and the totals kept per currency', () => {
    expect(s.fixed.map((c) => [c.what, c.amount, c.nth, c.of])).toEqual([['the rig', 100, 10, 36], ['a design tool', 20, undefined, undefined]]);
    expect(s.bills.map((b) => [b.provider, b.amount])).toEqual([['Anthropic', 12.5]]);
    expect(s.totals).toEqual([{ currency: 'USD', amount: 132.62 }]);
    expect(s.missing).toEqual(['1.5 h of meter time not read — the desk was off, or the GPU gave no reading']);
    const nov = monthStatement({ meter, samples: [], month: '2026-11', nowMs: monthWindow('2026-11').fromMs + 60 * 60_000 });
    expect(nov.totals).toEqual([{ currency: 'USD', amount: 100 }, { currency: 'EUR', amount: 50 }]);
    expect(nov.missing).toContain('1 h of meter time not read — the desk was off, or the GPU gave no reading');
    expect(statementWords(s)).toBe('2026-10: 132.62 USD — GPU energy 0.75 kWh read over 1.5 h; the rig 100 USD; a design tool 20 USD; Anthropic bill 12.5 USD'
      + ' — missing: 1.5 h of meter time not read — the desk was off, or the GPU gave no reading.');
  });

  test('the first minute counts: a rate set mid-minute holds from that minute, and its reading stands', () => {
    const mid = new Date(fromMs + 10.2 * 60_000).toISOString();
    const fresh = foldMeter([{ type: 'setup', setup: makeSetup({ ...RATE_FIELDS, pricePerKwh: 0.2, by: 'operator', now: mid }), at: mid }]);
    const first = monthStatement({ meter: fresh, samples: [{ m: at(10), w: 420 }], month: OCT, nowMs: fromMs + 10.3 * 60_000 });
    expect(first.energy).toMatchObject({ machineKwh: 0.007, measuredMinutes: 1, meterMinutes: 1, unmeasuredMinutes: 0 });
  });

  test('a meter never set counts nothing, and says so', () => {
    const off = monthStatement({ meter: foldMeter([]), samples: read, month: OCT, nowMs: fromMs + 250 * 60_000 });
    expect(off.energy).toMatchObject({ machineKwh: 0, measuredMinutes: 0, meterMinutes: 0, segments: [] });
    expect(off.totals).toEqual([]);
    expect(off.missing).toEqual(['the meter is off — set your electricity rate to start it', 'no hardware or rent entered', 'no API bill entered for this month']);
  });
});

describe('RUNNING COSTS on the TREASURY window', () => {
  const render = (props) => renderToStaticMarkup(createElement(CostMeter, {
    drafts: {}, busy: false, onDraft: () => {}, onSetup: () => {}, onStop: () => {}, onAddCost: () => {}, onAddBill: () => {}, onVoid: () => {}, ...props,
  }));
  const nowMs = fromMs + 250 * 60_000;

  test('off: the meter says so, and the rate is the operator\'s to set', () => {
    const meter = foldMeter([]);
    const html = render({ costs: { gpuPowerW: 421, gpuName: 'RTX PRO 6000', meter: { ...meter, months: [monthStatement({ meter, samples: [], month: OCT, nowMs })] } } });
    expect(html).toContain('RTX PRO 6000 DRAWING 421 W NOW');
    expect(html).toContain('data-cost-meter="off"');
    expect(html).toContain('THE METER IS OFF — SET YOUR ELECTRICITY RATE TO START IT');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>SET THE RATE<\/button>/);
    expect(html).not.toContain('STOP THE METER');
    expect(html).toContain('OCTOBER 2026 — NOTHING COUNTED YET');
    expect(html).toContain('GPU ENERGY — THE METER WAS NOT ON THIS MONTH');
    expect(html).toContain('>SET THE RATE</p>');
    expect(html).toContain('MISSING: the meter is off');
  });

  test('on: the month in plain words, each entry with its source as entered and its VOID', () => {
    const rig = makeCost({ kind: 'hardware', what: 'the rig', price: 3600, months: 36, currency: 'USD', since: '2026-01', source: 'repos/books/receipts/Rig-Invoice.pdf', by: 'operator', now: at(0) });
    const meter = foldMeter([setup(10, { pricePerKwh: 0.2 }), { type: 'cost', cost: rig, at: at(0) }]);
    const month = monthStatement({ meter, samples: samples(10, 70, 600), month: OCT, nowMs });
    const html = render({ costs: { gpuPowerW: null, gpuName: null, meter: { ...meter, months: [month] } }, drafts: { [`void:${rig.id}`]: { reason: 'no' } } });
    expect(html).toContain('GPU POWER DRAW UNREAD');
    expect(html).toContain('METER ON — 0.2 USD PER kWh · 100% OF THIS MACHINE IS THIS HOUSE&#x27;S');
    expect(html).toContain('OCTOBER 2026 — 100.12 USD');
    expect(html).toContain('GPU ENERGY — 0.6 kWh × 0.2 USD = 0.12 USD · READ 1 H OF THE 4 H THE METER STOOD ON');
    expect(html).toContain('the rig — 100.00 USD (MONTH 10 OF 36 OF ITS PRICE)');
    expect(html).toContain('the rig — HARDWARE, 3,600.00 USD OVER 36 MONTHS FROM JANUARY 2026 — 100.00 USD A MONTH');
    expect(html).toContain('<span class="tre-exact">repos/books/receipts/Rig-Invoice.pdf</span>');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>VOID<\/button>/); // a void names why, three letters at least
    expect(html).toContain('STOP THE METER');
  });

  test('the forms send what the routes take, and only once they are whole', () => {
    expect(formReady('setup', { currency: 'usd', pricePerKwh: '0.2' })).toBe(false);
    expect(formBody('setup', { currency: 'usd', pricePerKwh: '0.2', priceSource: SRC })).toEqual({ on: true, currency: 'USD', pricePerKwh: 0.2, priceSource: SRC, sharePct: 100 });
    const cost = { what: 'rent', monthly: '50', currency: 'eur', since: '2026-11', source: 'statement: landlord' };
    expect(formReady('cost', { ...cost, kind: 'monthly' })).toBe(true);
    expect(formReady('cost', { ...cost, kind: 'hardware' })).toBe(false);
    expect(formBody('cost', { ...cost, kind: 'monthly' })).toEqual({ kind: 'monthly', what: 'rent', monthly: 50, until: null, currency: 'EUR', since: '2026-11', source: 'statement: landlord' });
    expect(formBody('bill', { provider: 'Anthropic', month: OCT, amount: '12.5', currency: 'usd', source: 'invoice: 1' })).toEqual({ provider: 'Anthropic', month: OCT, amount: 12.5, currency: 'USD', source: 'invoice: 1' });
    expect([cash(1234.5), monthName('2026-01'), meterWords(null)]).toEqual(['1,234.50', 'JANUARY 2026', 'THE METER IS OFF — SET YOUR ELECTRICITY RATE TO START IT']);
    expect(energyWords({ measuredMinutes: 0, meterMinutes: 30, segments: [] })).toBe('GPU ENERGY — NONE READ · READ 0 MIN OF THE 30 MIN THE METER STOOD ON');
    expect(energyWords({ measuredMinutes: 0, meterMinutes: 0, segments: [] })).toBe('GPU ENERGY — THE METER WAS NOT ON THIS MONTH');
  });
});
