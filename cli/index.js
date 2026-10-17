// NEUMA CLI — operator-side entry. Thin shim over cli/lib/dispatch.js so
// the dispatcher (and its yargs config) stays unit-testable without spawning
// a subprocess. All real work lives in cli/lib/.
//
// C-01 wires yargs (--version, --help, default-command scaffold).
// Subsequent slices add subcommands via the same builder:
//   C-03 → talk · C-04 → edit · C-05 → proof · C-06 → active-being lib ·
//   C-07 → enrich no-arg with active-being + daemon health · C-08 → upgrade.
//
// impure (process IO)

import { hideBin } from 'yargs/helpers';
import { run } from './lib/dispatch.js';

run(hideBin(process.argv));
