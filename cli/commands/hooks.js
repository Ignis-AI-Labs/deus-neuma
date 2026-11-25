// `neuma hooks` — the house's webhooks, from the terminal:
//
//   neuma hooks                                   list them (never their secrets)
//   neuma hooks add <being> <source> <name>       give one out → its address and secret, shown once
//   neuma hooks rotate <id>                       a new secret; the old one stops at once
//   neuma hooks secret <id>                       use the service's own signing secret (Slack,
//                                                 Linear make their own), read from your input
//   neuma hooks remove <id>                       take it back; its address stops answering
//   neuma hooks events <id>                       what it delivered, newest first
//
// <source> is github, slack, linear or generic. The address answers only while
// the Webhooks connection is on (Settings → Security → Connections), and only
// to a delivery signed with the hook's secret. What a delivery does is the
// house clock's to decide: the being it names wakes only as its charter allows.
//
// impure (the hooks store, the house's lanes).

import { readOneLine } from '../lib/read-one-line.js';
import { resolveWalletEnvPath } from '../lib/wallet-env.js';
import { operatorAddress } from '../lib/wallet.js';

// Where each service takes the address, and whose secret signs.
const SOURCES_HELP = Object.freeze({
  github: 'GitHub: repository Settings → Webhooks → Add webhook. Payload URL = the address, Content type = application/json, Secret = the secret above.',
  slack: 'Slack: your app → Event Subscriptions → Request URL = the address. Slack signs with ITS OWN Signing Secret (Basic Information): give it to this hook with `neuma hooks secret <id>` BEFORE you save the URL, so Slack\'s check passes.',
  linear: 'Linear: Settings → API → Webhooks → New webhook, URL = the address. Linear shows ITS OWN signing secret once it is saved: give it to this hook with `neuma hooks secret <id>`.',
  generic: 'Any script: POST JSON to the address with X-Neuma-Timestamp (unix seconds) and X-Neuma-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + body)>.',
});
const SERVICE_SIGNS = Object.freeze(['slack', 'linear']);

const line = (h) => `${h.id}  ${h.source.padEnd(7)}  ${h.seat}  "${h.name}"  ${h.deliveries} deliveries${h.lastDeliveryAt ? `, last ${h.lastDeliveryAt}` : ''}`;

/**
 * Run one `neuma hooks` action. Returns the exit code.
 * impure.
 */
export const runHooks = async ({ cwd, stdin = process.stdin, stdout, stderr, argv }) => {
  const fail = (message) => { stderr.write(`neuma hooks: ${message}\n`); return 1; };
  let wallet;
  try {
    wallet = operatorAddress(resolveWalletEnvPath(cwd));
  } catch (error) {
    return fail(error.message);
  }
  const [store, { isConnectionOn }, { ownedLanes }, { default: workspace }, { listNeumaSeats, resolveSeatLane }] = await Promise.all([
    import('../../backend/services/hooks/hook-store.js'),
    import('../../backend/services/connections/connection-switches.js'),
    import('../../backend/services/house-deadlines.js'),
    import('../../core/workspace/neuma-workspace.js'),
    import('./agent.js'),
  ]);
  const on = isConnectionOn('webhooks');
  const offNote = 'Webhooks are OFF: every hook address answers 404 until you turn them on (Settings → Security → Connections).';
  const [action = 'list', ...rest] = (argv.args || []).map(String);
  try {
    if (action === 'list') {
      const hooks = await store.listHooks(wallet);
      stdout.write(hooks.length ? `${hooks.map(line).join('\n')}\n` : 'this house has given out no hooks — neuma hooks add <being> <source> <name>\n');
      if (!on) stdout.write(`${offNote}\n`);
      return 0;
    }
    if (action === 'add') {
      const [being, source, ...nameWords] = rest;
      if (!being || !source || nameWords.length === 0) return fail('usage: neuma hooks add <being> <github|slack|linear|generic> <name>');
      // A being by its chosen name or its lane id, the way neuma code seats one; the house's own only.
      const lanes = await ownedLanes(wallet);
      const named = resolveSeatLane({ workspace: being, neuma: await listNeumaSeats(workspace) });
      const laneId = lanes.some((l) => l.laneId === being) ? being : named.laneId;
      if (!laneId || !lanes.some((l) => l.laneId === laneId)) return fail(`${being} is not a being of this house (${lanes.map((l) => l.laneId).join(', ') || 'it has none'})`);
      const { hook, secret } = await store.createHook({ wallet, seat: laneId, source, name: nameWords.join(' ') });
      const serviceSigns = SERVICE_SIGNS.includes(hook.source);
      stdout.write([
        `hook ${hook.id} wakes ${hook.seat} on ${hook.source} events`,
        `  address: <this computer>${hook.path}`,
        serviceSigns ? `  secret:  ${hook.source} makes its own — give it to this hook: neuma hooks secret ${hook.id}` : `  secret:  ${secret}`,
        serviceSigns ? '' : '  The secret is shown this once. Put it in the service now; `neuma hooks rotate` makes a new one.',
        `  ${SOURCES_HELP[hook.source]}`,
        '  The being wakes only as the house charter allows (seat named, not paused, outside quiet hours, under its daily cap).',
        on ? '' : `  ${offNote}`,
      ].filter(Boolean).join('\n') + '\n');
      return 0;
    }
    if (action === 'rotate') {
      if (!rest[0]) return fail('usage: neuma hooks rotate <id>');
      const { hook, secret } = await store.rotateHookSecret(wallet, rest[0]);
      stdout.write(`hook ${hook.id} has a new secret (the old one no longer verifies):\n  secret:  ${secret}\n`);
      return 0;
    }
    if (action === 'secret') {
      if (!rest[0]) return fail('usage: neuma hooks secret <id>   (then paste the service\'s signing secret and press Enter)');
      if (stdin.isTTY) stderr.write('paste the service\'s signing secret, then Enter: ');
      const hook = await store.setHookSecret(wallet, rest[0], await readOneLine(stdin));
      stdout.write(`hook ${hook.id} now checks deliveries against ${hook.source}'s own secret\n`);
      return 0;
    }
    if (action === 'remove') {
      if (!rest[0]) return fail('usage: neuma hooks remove <id>');
      if (!(await store.removeHook(wallet, rest[0]))) return fail(`no hook ${rest[0]} in this house`);
      stdout.write(`hook ${rest[0]} removed — its address no longer answers\n`);
      return 0;
    }
    if (action === 'events') {
      if (!rest[0]) return fail('usage: neuma hooks events <id>');
      const events = await store.readHookEvents(wallet, rest[0], 20);
      stdout.write(events.length ? `${events.map((e) => `${e.receivedAt}  ${e.summary?.kind ?? e.event}${e.summary?.title ? `  "${e.summary.title}"` : ''}${e.woke ? '' : `  (${e.note ?? 'no wake'})`}`).join('\n')}\n` : 'nothing delivered yet\n');
      return 0;
    }
    return fail(`unknown action ${action} — list, add, secret, rotate, remove, events`);
  } catch (error) {
    return fail(error.message);
  }
};

export const registerHooksCommand = (cli, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  cli.command(
    'hooks [args..]',
    'the house\'s webhooks: list · add <being> <source> <name> · secret <id> · rotate <id> · remove <id> · events <id>',
    (y) => y.positional('args', { type: 'string', array: true }),
    async (argv) => {
      const code = await runHooks({ cwd: process.cwd(), stdout, stderr, argv });
      if (code !== 0) process.exitCode = code;
    },
  );
