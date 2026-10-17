// `neuma model <action>` — show or set a being's ACTIVE model route. Natal is
// birth history only; at runtime a being rides the machine's current serving
// (the active model) unless the operator sets an explicit override. Model
// selection is distinct from provider administration (`neuma provider`): the
// model rides a provider that must already be configured, and clearing the
// override returns the being to the machine default.
//
//   neuma model show [--being]              natal / override / effective route
//   neuma model list [--provider] [--being] models available at a provider
//   neuma model set <provider/model> [--being]   set the override
//   neuma model natal [--being]             clear the override (ride the machine default)
//
// Stdout = data (pipe-friendly); stderr = status/errors. impure.
import { withAuth } from '../lib/authed.js';
import { findProjectRoot } from '../lib/project-root.js';
import { resolveActiveBeing } from '../lib/active-being.js';
import { listNeuma, resolveNeuma } from '../lib/discovery.js';
import {
  getNeumaRoute, setNeumaRoute, clearNeumaRoute, listModels,
  parseModelId, formatRouteView, formatModels,
} from '../lib/routing.js';

const DEFAULT_BACKEND = 'http://localhost:3333';

// Resolve the target being → record with { neumaId, name } via residency,
// exactly as `neuma talk` does (--being override, else the active being).
const resolveTarget = async ({ backend, token, cwd, argv, stderr }) => {
  const snapshot = await listNeuma({ backend, token });
  const beings = Array.isArray(snapshot.neuma) ? snapshot.neuma : [];
  const nameOrId = argv.being ? argv.being.trim() : resolveActiveBeing({ projectRoot: findProjectRoot(cwd), residentBeings: beings });
  const target = resolveNeuma(beings, nameOrId);
  if (!target) {
    stderr.write(`neuma model: no resident being matches "${nameOrId}". Resident: ${beings.map((b) => b.name || b.neumaId).join(', ') || '(none)'}\n`);
    process.exit(1);
  }
  return target;
};

const run = async ({ stderr, argv }, fn) => {
  const backend = argv.backend || DEFAULT_BACKEND;
  const cwd = process.cwd();
  try {
    await withAuth({ backend, cwd }, async (token) => {
      const target = await resolveTarget({ backend, token, cwd, argv, stderr });
      await fn(backend, token, target);
    });
  } catch (err) {
    stderr.write(`neuma model: ${err.message}\n`);
    process.exit(1);
  }
};

const displayName = (t) => t.name || t.neumaId;

export const registerModelCommand = (cli, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  cli.command(
    'model',
    "show or set a being's active model route (natal local + optional override)",
    (y) => y
      .option('backend', { describe: 'backend origin (default http://localhost:3333)', type: 'string' })
      .option('being', { describe: 'being name or id (default: the active being)', type: 'string' })
      .command('show', "show a being's route (natal / override / effective)", () => {}, (argv) =>
        run({ stderr, argv }, async (backend, token, target) => {
          const view = await getNeumaRoute(backend, token, target.neumaId);
          stdout.write(formatRouteView(displayName(target), view));
        }))
      .command('list', "list models for the being's provider (or --provider)", (yy) =>
        yy.option('provider', { describe: 'provider id (default: the being\'s effective provider)', type: 'string' }), (argv) =>
        run({ stderr, argv }, async (backend, token, target) => {
          const providerId = argv.provider || (await getNeumaRoute(backend, token, target.neumaId)).effective?.provider;
          if (!providerId) { stderr.write('neuma model list: no provider resolved — pass --provider\n'); process.exit(1); }
          const { models } = await listModels(backend, token, providerId);
          stdout.write(formatModels(providerId, models));
        }))
      .command('set <route>', 'set the override to "provider/model"', (yy) =>
        yy.positional('route', { describe: 'provider/model (e.g. anthropic/claude-opus-4-6)', type: 'string' }), (argv) =>
        run({ stderr, argv }, async (backend, token, target) => {
          const parsed = parseModelId(argv.route);
          if (!parsed) { stderr.write('neuma model set: route must be "provider/model"\n'); process.exit(1); }
          const view = await setNeumaRoute(backend, token, target.neumaId, parsed);
          stdout.write(formatRouteView(displayName(target), view));
        }))
      .command('natal', 'clear the override — the being rides the machine default', () => {}, (argv) =>
        run({ stderr, argv }, async (backend, token, target) => {
          const view = await clearNeumaRoute(backend, token, target.neumaId);
          stderr.write(`${displayName(target)} override cleared — riding the machine default\n`);
          stdout.write(formatRouteView(displayName(target), view));
        }))
      .demandCommand(1, 'specify a model action')
      .strict(),
    () => {},
  );
