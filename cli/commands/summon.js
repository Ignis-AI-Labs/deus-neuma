// `neuma summon <being>` — declare which neuma is active for this project.
// Writes <project>/.neuma/active so subsequent `neuma talk` / `neuma proof`
// without --being target this one. Slice-1 design: simple file write, no
// daemon verification (daemon-up check would couple summon to C-02's auth
// flow). The operator confirms by running `neuma` no-arg (C-07 will show
// active-being + daemon-health snapshot) or by attempting `neuma talk`.
//
// impure (process.cwd, fs write, process.stdout/stderr)

import { findProjectRoot } from '../lib/project-root.js';
import { writeActiveBeing } from '../lib/active-being.js';

const runSummon = ({ cwd, stdout, stderr, argv }) => {
  // Reject whitespace-only input — would silently write empty .neuma/active
  // and report fake success.
  const being = argv.being?.trim();
  if (!being) {
    stderr.write('neuma summon: a being name or id is required (non-whitespace)\n');
    process.exit(1);
  }
  const projectRoot = findProjectRoot(cwd);
  writeActiveBeing(projectRoot, being);
  stdout.write(
    `neuma summon: active being set to "${being}" for this project `
    + `(${projectRoot}/.neuma/active)\n`,
  );
};

export const registerSummonCommand = (cli, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  cli.command(
    'summon <being>',
    'set the active being for this project (writes .neuma/active)',
    (y) => y.positional('being', {
      describe: 'the neuma name or id to make active',
      type: 'string',
    }),
    (argv) => {
      runSummon({ cwd: process.cwd(), stdout, stderr, argv });
    },
  );
