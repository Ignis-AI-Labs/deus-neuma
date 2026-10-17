// `neuma provider <action>` — operator-scoped LLM provider administration
// against the routing REST surface. Provider selection is distinct from model
// selection (`neuma model`): a provider is a place to route (with a key/endpoint),
// a model is what a specific being runs on there.
//
//   neuma provider list                          configured providers (key state)
//   neuma provider models <id>                   available models at a provider
//   neuma provider set <id> --key K [--endpoint] store an API key (+ custom base URL)
//   neuma provider test <id>                     probe reachability
//   neuma provider remove <id>                   drop a stored credential
//
// Stdout = data (pipe-friendly); stderr = status/errors. impure.
import { withAuth } from '../lib/authed.js';
import {
  listProviders, listModels, setProviderKey, removeProviderKey, testProvider,
  connectProvider, listConnections, removeConnection,
  formatProviders, formatModels,
} from '../lib/routing.js';

const DEFAULT_BACKEND = 'http://localhost:3333';

const run = async ({ stderr, argv }, fn) => {
  const backend = argv.backend || DEFAULT_BACKEND;
  try {
    await withAuth({ backend, cwd: process.cwd() }, (token) => fn(backend, token));
  } catch (err) {
    stderr.write(`neuma provider: ${err.message}\n`);
    process.exit(1);
  }
};

export const registerProviderCommand = (cli, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  cli.command(
    'provider',
    'manage LLM providers (keys, endpoints, reachability)',
    (y) => y
      .option('backend', { describe: 'backend origin (default http://localhost:3333)', type: 'string' })
      .command('list', 'list providers and their configured state', () => {}, (argv) =>
        run({ stderr, argv }, async (backend, token) => {
          const { providers } = await listProviders(backend, token);
          stdout.write(formatProviders(providers));
        }))
      .command('models <id>', 'list available models at a provider', (yy) =>
        yy.positional('id', { describe: 'provider id', type: 'string' }), (argv) =>
        run({ stderr, argv }, async (backend, token) => {
          const { models } = await listModels(backend, token, argv.id);
          stdout.write(formatModels(argv.id, models));
        }))
      .command('set <id>', 'store an API key (and optional custom base URL)', (yy) =>
        yy.positional('id', { describe: 'provider id', type: 'string' })
          .option('key', { describe: 'API key', type: 'string' })
          .option('endpoint', { describe: 'base URL (for custom / self-hosted providers)', type: 'string' }), (argv) =>
        run({ stderr, argv }, async (backend, token) => {
          if (!argv.key && !argv.endpoint) { stderr.write('neuma provider set: pass --key and/or --endpoint\n'); process.exit(1); }
          const { provider } = await setProviderKey(backend, token, argv.id, { apiKey: argv.key, endpoint: argv.endpoint });
          stdout.write(formatProviders([provider]));
        }))
      .command('remove <id>', 'drop a stored credential', (yy) =>
        yy.positional('id', { describe: 'provider id', type: 'string' }), (argv) =>
        run({ stderr, argv }, async (backend, token) => {
          const { removed } = await removeProviderKey(backend, token, argv.id);
          stderr.write(removed ? `removed ${argv.id}\n` : `${argv.id} had no stored credential\n`);
        }))
      .command('test <id>', 'probe a provider connection', (yy) =>
        yy.positional('id', { describe: 'provider id', type: 'string' }), (argv) =>
        run({ stderr, argv }, async (backend, token) => {
          const res = await testProvider(backend, token, argv.id, {});
          stderr.write(res.success ? `${argv.id}: reachable (${(res.models || []).length} models)\n` : `${argv.id}: unreachable — ${res.error || 'no models'}\n`);
          if (!res.success) process.exit(1);
        }))
      .command('connect <id>', 'prove a provider live and LOCK the route in (joins the summon pool)', (yy) =>
        yy.positional('id', { describe: 'provider id', type: 'string' })
          .option('model', { describe: 'lock onto this model (default: first live model)', type: 'string' }), (argv) =>
        run({ stderr, argv }, async (backend, token) => {
          const res = await connectProvider(backend, token, argv.id, { model: argv.model });
          if (!res.success) {
            stderr.write(`${argv.id}: not connected — ${res.error}\n`);
            process.exit(1);
            return;
          }
          stdout.write(`${argv.id} locked onto ${res.connection.model} — summonable: neuma witness summon ${argv.id}\n`);
        }))
      .command('connections', 'list locked connections (the summon pool)', () => {}, (argv) =>
        run({ stderr, argv }, async (backend, token) => {
          const { connections } = await listConnections(backend, token);
          if (connections.length === 0) { stdout.write('no locked connections — connect one: neuma provider connect <id>\n'); return; }
          for (const c of connections) stdout.write(`${c.providerId}  ${c.model}  ${c.credentialKind}  live ${c.lastLiveAt || '?'}\n`);
        }))
      .command('disconnect <id>', 'unlock a provider (the stored credential is untouched)', (yy) =>
        yy.positional('id', { describe: 'provider id', type: 'string' }), (argv) =>
        run({ stderr, argv }, async (backend, token) => {
          await removeConnection(backend, token, argv.id);
          stderr.write(`unlocked ${argv.id}\n`);
        }))
      .demandCommand(1, 'specify a provider action')
      .strict(),
    () => {},
  );
