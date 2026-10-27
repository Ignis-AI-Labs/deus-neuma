#!/usr/bin/env node
// mandate.mjs — the operator's CLI over the CMO's MANDATE, at the machine
// (Design note, 2026-10-24: […]).
// It works with the desk closed or the backend down: it acts on the house's
// own files under the realm root, through the same lifecycle the desk's
// routes use, and every running scheduler re-reads the mandate before it
// sends, so a withdrawal here stops the next send everywhere.
//
//   node scripts/mandate.mjs status   --house 0x…
//   node scripts/mandate.mjs withdraw --house 0x… [--reason "…"]
//
// OFF FROM ANYWHERE, ON FROM THE DESK (ruling, 2026-10-24): this CLI only
// reads and withdraws. Granting, resuming and renewing happen at the desk.
//
// impure — the realm root, the post queue file.

import { applyRealmSettings } from '../backend/services/user-realm-settings.js';
import { houseKey } from '../backend/services/staff/cos-designation.js';
import { readMandateRecord } from '../backend/services/marketing/mandate/mandate-store.js';
import { mandateStanding, plainWords } from '../backend/services/marketing/mandate/mandate-shape.js';
import { withdrawMandate } from '../backend/services/marketing/mandate/mandate-lifecycle.js';

const USAGE = 'usage: node scripts/mandate.mjs <status|withdraw> --house 0x… [--reason "…"]\n(a mandate is turned on — granted, resumed, renewed — only at the desk)';

const argOf = (argv, name) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] ?? null : null;
};

const main = async (argv) => {
  const [command] = argv;
  const house = houseKey(argOf(argv, 'house'));
  if (!['status', 'withdraw'].includes(command) || !house) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  await applyRealmSettings();
  if (command === 'status') {
    const { current } = await readMandateRecord(house);
    const standing = mandateStanding(current);
    process.stdout.write(`${standing.toUpperCase()}\n${current ? `${plainWords(current).join('\n')}\n` : ''}`);
    return 0;
  }
  const out = await withdrawMandate(house, { by: `cli:${house}`, reason: argOf(argv, 'reason') || 'withdrawn at the machine' });
  if (!out.ok) {
    process.stderr.write(`${out.error}\n`);
    return 1;
  }
  process.stdout.write(`WITHDRAWN ${out.mandate.id} — ${out.cancelled.length} queued post(s) cancelled, ${out.inFlight.length} already leaving.\n`);
  return 0;
};

main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
  process.stderr.write(`mandate: ${err.message}\n`);
  process.exit(1);
});
