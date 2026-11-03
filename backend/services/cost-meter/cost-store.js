// The cost meter's record, per house, in the Quaestor's office
// (`<realm>/<wallet>/offices/treasury/`): `cost-meter.jsonl` holds the
// settings, the fixed costs and the bills (cost-shape.js folds it), and
// `power-<YYYY-MM>.jsonl` the month's power samples, one per minute the meter
// read. A house reads only its own; two houses are never confused.
// impure.

import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { officeFile } from '../house-office.js';
import { foldMeter, minuteOf, monthBefore, monthOf, monthStatement } from './cost-shape.js';

const serialize = createWriteChain();
const meterFile = (wallet) => officeFile(wallet, 'treasury', 'cost-meter.jsonl');
const powerFile = (wallet, month) => officeFile(wallet, 'treasury', `power-${month}.jsonl`);

/** The house's meter, folded. */
export const readMeter = async (wallet) => {
  const { records, torn } = await readJsonLines(meterFile(wallet));
  return { ...foldMeter(records), torn };
};

/** Set the meter (its rate, or off). */
export const setMeter = (wallet, setup) => serialize(async () => {
  await appendJsonLine(meterFile(wallet), { type: 'setup', setup, at: setup.setAt });
  return { ok: true, setup };
});

/** Enter a fixed cost or a bill. @param {'cost'|'bill'} type */
export const enterCost = (wallet, type, item) => serialize(async () => {
  await appendJsonLine(meterFile(wallet), { type, [type]: item, at: item.setAt });
  return { ok: true, [type]: item };
});

/** Void a live cost or bill, with why. */
export const voidCost = (wallet, itemId, { reason, by, at }) => serialize(async () => {
  const meter = await readMeter(wallet);
  if (![...meter.costs, ...meter.bills].some((x) => x.id === itemId)) return { ok: false, reason: `no live cost or bill "${itemId}" on this meter` };
  await appendJsonLine(meterFile(wallet), { type: 'voided', id: itemId, reason, by, at });
  return { ok: true };
});

/** One power sample at this moment. */
export const recordPower = (wallet, watts, nowMs) => appendJsonLine(powerFile(wallet, monthOf(nowMs)), { m: minuteOf(nowMs), w: watts });

/** A month's statement for the house. */
export const statementOf = async (wallet, month, nowMs) => {
  const [meter, { records }] = await Promise.all([readMeter(wallet), readJsonLines(powerFile(wallet, month))]);
  return monthStatement({ meter, samples: records, month, nowMs });
};

/** The meter as the TREASURY window and the Quaestor read it: its setting, its items, this month and the last. */
export const costBoard = async (wallet, nowMs) => {
  const meter = await readMeter(wallet);
  const month = monthOf(nowMs);
  const months = await Promise.all([month, monthBefore(month)].map((m) => statementOf(wallet, m, nowMs)));
  return { on: meter.on, setup: meter.setup, costs: meter.costs, bills: meter.bills, months };
};
