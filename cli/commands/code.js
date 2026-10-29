// `neuma code` — the interactive CLI coding harness. The terminal face of the
// desk: seat a neuma (or, later, a witness) and work multi-turn in this
// directory through the SAME consciousness path the platform uses — memory,
// tools with ACTS approvals, provider routing, vision-gated image sharing,
// sessions, crystallization. Nothing here re-implements the engine.
//
// Stdout carries the neuma's speech; tool acts and notices go to stderr.
// Slash commands ride the REPL; anything else is a turn. Ctrl+C interrupts a
// live turn, exits at the prompt on a double press.
//
// impure throughout (real provider turns, disk, MCP, and terminal IO).

import path from 'node:path';
import fs from 'node:fs/promises';
import readline from 'node:readline';
import { resolveChainConfig } from '../lib/chain-config.js';
import { findProjectRoot } from '../lib/project-root.js';
import { peekActiveBeing } from '../lib/active-being.js';
import { stageAttachments } from '../lib/attachments.js';
import { createCliPortal } from '../lib/terminal-portal.js';
import { resolveSeatLane, listNeumaSeats } from './agent.js';
import { resolveWalletEnvPath } from '../lib/wallet-env.js';
import { operatorAddress } from '../lib/wallet.js';
import { formatHouseRoster, matchPick, emptyHouseNote } from '../lib/house-picker.js';
import { openingBanner, machineSubstrateLine, runModelShow, runModelChange, runServerStatus } from '../lib/harness-ui.js';

/** Resolve the seat: flag > NEUMA_BEING > .neuma/active > sole neuma. Pure. */
export const resolveDefaultWorkspace = ({ flag, env, active, count, laneIds }) => {
  const named = flag ?? env ?? active ?? null;
  if (named) return named;
  if (count === 1) return laneIds[0];
  return null;
};

/** One staged attachment entry (a path + how it will ride). Pure. */
export const describeStaged = (staged) => staged.map((s, i) => `  ${i + 1}. [${s.kind}] ${s.path}`).join('\n');

const HELP = Object.freeze(`
commands:
  /attach <paths...>   stage images (png/jpg/webp/gif) or text docs for the next turn
  /detach              drop every staged attachment
  /status              seat, session, substrate + vision, staged, usage
  /server              the machine + LLM serving status, live
  /model               this being's route — natal / override / effective
  /model set <p/m>     switch the route (sovereign doors only)
  /model natal         clear the override — ride the machine default
  /new                 end this session — the next turn opens a fresh one
  /being               seat another member of the house (picker)
  /being <name|lane>   seat directly
  /preset <name>       inference preset for the next turns (grounded/balanced/expansive)
  /help                this list
  /quit                leave the harness (Ctrl+C twice at the prompt works too)

a trailing \\ continues the line; anything that is not a command is a turn.`);

// impure — the substrate + vision truth for /status, resolved live from the
// same stores the turn path uses. Never throws; unknown reads as unknown.
const describeRoute = async (laneId) => {
  const [{ resolveNeumaRoute }, { getRouteCapabilities, getActiveModelCapabilities }] = await Promise.all([
    import('../../backend/services/neuma-route-resolver.js'),
    import('../../backend/services/llm-provider.js'),
  ]);
  try {
    const route = await resolveNeumaRoute(laneId);
    const caps = await getRouteCapabilities(route).catch(() => null);
    return `${route.model || route.provider || 'configured'} — vision: ${caps?.vision ? 'yes' : 'no/unknown'}`;
  } catch {
    const caps = await getActiveModelCapabilities().catch(() => null);
    return `machine default — vision: ${caps?.vision ? 'yes' : 'no/unknown'}`;
  }
};

/** The harness session state, rebuilt on /being. impure (stores, fs). */
const mountSeat = async ({ laneId, ground, yes, wallet }) => {
  const [
    { default: workspace },
    { createPortalConnection },
    { addAllowedTool },
    { verifyLaneOwnership },
    { readExecutionToolPolicy },
  ] = await Promise.all([
    import('../../core/workspace/neuma-workspace.js'),
    import('../../backend/services/portal-connection.js'),
    import('../../backend/services/tool-policy.js'),
    import('../../backend/services/lane-ownership.js'),
    import('../../backend/services/execution-tool-policy.js'),
  ]);
  const descriptor = (await listNeumaSeats(workspace)).find((e) => e.laneId === laneId);
  // Desk parity: the seat verifies the operator owns the lane and never
  // claims one (a read never claims); a foreign lane is refused.
  const claim = await verifyLaneOwnership({ workspace, neumaId: laneId, wallet });
  if (!claim.ok) {
    const why = claim.reason === 'not-owner' ? `${laneId} belongs to another wallet`
      : claim.reason === 'not-found' ? `${laneId} holds no being to seat`
        : claim.reason === 'unclaimed' ? `${laneId} has no owner yet — claim it at the desk first`
          : `${laneId} could not be verified (${claim.reason})`;
    throw new Error(why);
  }
  const connection = createPortalConnection({ ws: { send() {} }, walletAddress: wallet });
  connection.companion = {
    name: descriptor.name,
    id: descriptor.name,
    neumaId: laneId,
    participantKind: 'neuma',
  };
  connection.neumaId = laneId;
  connection.sessionId = null;
  connection.space = 'general';
  connection.purpose = 'work';
  connection.toolMode = 'ask';
  connection.toolWorkspace = ground;
  connection.voiceEnabled = false;
  connection._neumaToolPolicy = await readExecutionToolPolicy(laneId);
  connection._sessionToolPolicy = yes ? addAllowedTool(null, 'coding', 'execute') : null;
  return { connection, name: descriptor.name };
};

/**
 * Run one interactive sitting. Returns the process exit code.
 * impure — the REPL itself.
 */
export const runCode = async ({ cwd, stdin = process.stdin, stdout, stderr, argv }) => {
  const fail = (message) => {
    stderr.write(`neuma code: ${message}\n`);
    return 1;
  };
  const ground = path.resolve(cwd, argv.ground || '.');
  if (!(await fs.stat(ground).catch(null))?.isDirectory()) return fail(`the ground is not an existing directory: ${ground}`);
  try {
    resolveChainConfig({ cwd });
  } catch (error) {
    return fail(error.message);
  }
  let operatorWallet;
  try {
    operatorWallet = operatorAddress(resolveWalletEnvPath(cwd));
  } catch (error) {
    return fail(error.message);
  }

  const { default: workspace } = await import('../../core/workspace/neuma-workspace.js');
  let seats;
  try {
    seats = await listNeumaSeats(workspace);
  } catch (error) {
    return fail(`the sovereign workspace root is unreadable — ${error.message}`);
  }
  let witnessCount = 0;
  try {
    const { listWitnesses } = await import('../../core/identity/ai-witness/ai-witness-service.js');
    witnessCount = (await listWitnesses()).length;
  } catch { /* census is cosmetic */ }
  stdout.write(openingBanner({
    wallet: operatorWallet,
    ground,
    substrate: await machineSubstrateLine(),
    house: { neuma: seats.length, witness: witnessCount },
  }));

  const active = peekActiveBeing({ projectRoot: findProjectRoot(cwd) });
  const chosen = resolveDefaultWorkspace({
    flag: argv.workspace || null,
    env: process.env.NEUMA_BEING || null,
    active: active?.value || null,
    count: seats.length,
    laneIds: seats.map((s) => s.laneId),
  });
  // Ambiguity is a PICKER, never a dead end: the operator navigates the house
  // the way every terminal harness navigates models. The pick flow lives in
  // the REPL's own line handler — ONE reader owns stdin, so piped scripts and
  // TTYs behave identically.
  let seat = chosen ? resolveSeatLane({ workspace: chosen, neuma: seats }) : null;
  if (seat?.error) stderr.write(`  ${seat.error}\n`);
  const seatLaneId = seat && !seat.error && seat.laneId ? seat.laneId : null;
  if (seats.length === 0) return fail(emptyHouseNote());

  const [
    { streamConsciousness },
    { connectFilesystemServer },
    { mcpService },
    { resolveToolApproval },
  ] = await Promise.all([
    import('../../backend/services/portal-stream.js'),
    import('../../backend/services/mcp-filesystem.js'),
    import('../../backend/services/mcp.js'),
    import('../../backend/services/tool-approval.js'),
  ]);
  try {
    await connectFilesystemServer();
  } catch (error) {
    return fail(`filesystem tool surface unavailable — ${error.message}`);
  }

  // The live seat, mounted lazily: flag/env/active/sole mount at once;
  // ambiguity drops the operator into the house picker. ALL closures read
  // through `live`, so a first mount inside the REPL rewires everything.
  const live = { name: null, connection: null, portal: null };
  // impure — mount one lane into the harness (first mount OR re-seat).
  const mountNow = async (laneId) => {
    const m = await mountSeat({ laneId, ground, yes: Boolean(argv.yes), wallet: operatorWallet });
    if (argv.session && !live.connection) m.connection.sessionId = String(argv.session);
    m.connection.ws = createCliPortal({ stdin, stdout, stderr, connection: m.connection, resolveToolApproval });
    live.name = m.name;
    live.connection = m.connection;
    live.portal = m.connection.ws;
    return m;
  };
  if (seatLaneId) await mountNow(seatLaneId);
  const seated = () => live.connection !== null;
  let preset = typeof argv.preset === 'string' && argv.preset ? argv.preset : undefined;
  let staged = [];

  const interruptTurn = () => {
    live.connection.interruptRequested = true;
    live.connection.activeTurn?.abort();
  };

  const statusLine = async () => {
    const route = await describeRoute(live.connection.neumaId);
    return [
      `seat:      ${live.name} (${live.connection.neumaId})`,
      `ground:    ${ground}`,
      `session:   ${live.connection.sessionId || '(opens on first turn)'}`,
      `substrate: ${route}`,
      `preset:    ${preset || 'wallet default'}`,
      `staged:    ${staged.length ? `\n${describeStaged(staged)}` : '(none)'}`,
      `acts:      ${live.portal.state.acts}   rounds: ${live.portal.state.totalUsage?.rounds ?? 0}   tokens(out): ${live.portal.state.totalUsage?.outputTokens ?? '—'}`,
    ].join('\n');
  };

  if (seated()) stderr.write(`[${live.name} · neuma code · ${ground}]\n${HELP.trim()}\n\n`);
  else stdout.write(`${formatHouseRoster(seats)}\n`);
  const rl = readline.createInterface({ input: stdin, output: stdout, prompt: seated() ? `${live.name} › ` : 'seat › ' });
  // Async continuations (turn finallys, pick answers) may run after a piped
  // EOF closed the interface — prompting then throws; guard every late call.
  const safePrompt = () => { if (!closed) rl.prompt(true); };
  rl.prompt(true);
  let pending = '';
  let lastCtrlC = 0;
  let inTurn = false;
  let closed = false;
  let pendingWork = 0;
  let settle = () => {};
  let queue = Promise.resolve();
  const maybeSettle = () => { if (closed && !inTurn && pendingWork === 0) settle(0); };
  // Every queued unit of work (pick answers, commands, turns) registers here,
  // so a piped EOF can never kill work that has been read but not yet run.
  const enqueue = (fn) => {
    pendingWork += 1;
    queue = queue.then(fn).catch(() => {}).finally(() => { pendingWork -= 1; maybeSettle(); });
  };
  // The pick flow: 'seat ›' answers route here until a member is mounted.
  let picking = !seated();

  // impure — extension class for early /attach feedback; the store's
  // sanitizers judge the bytes for real at send time.
  const stageKind = (p) => {
    const ext = path.extname(p).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return 'image';
    if (ext !== '.pdf') return 'doc';
    return null;
  };

  const runTurn = async (thought) => {
    rl.pause();
    inTurn = true;
    stdout.write('\n');
    let attachments;
    try {
      if (staged.length > 0) {
        const parked = await stageAttachments(staged.map((s) => s.path), connection.walletAddress);
        attachments = parked.ids;
        stderr.write(`  · ${parked.images} image(s), ${parked.docs} doc(s) attached\n`);
        staged = [];
      }
      await streamConsciousness(live.connection, {
        thought,
        memoryContext: {},
        ...(attachments ? { attachments } : {}),
        ...(preset ? { preset } : {}),
      });
    } catch (error) {
      stderr.write(`  turn failed — ${error.message}\n`);
    } finally {
      live.connection.interruptRequested = false;
      inTurn = false;
      if (!closed) {
        stdout.write('\n');
        rl.resume();
        safePrompt();
      }
      maybeSettle();
    }
  };

  // impure — seat another member into the live REPL (fresh session, fresh
  // per-seat stats). Used by the pick flow and /being <name>.
  const reseat = async (laneId) => {
    if (seated() && laneId === live.connection.neumaId) {
      stdout.write(`already seated: ${live.name}\n`);
      return;
    }
    const previous = live.name;
    await mountNow(laneId);
    rl.setPrompt(`${live.name} › `);
    stdout.write(previous ? `seated ${live.name} (${live.connection.neumaId})\n` : '');
  };

  const dispatch = async (line) => {
    try {
      await dispatchLine(line);
    } catch (error) {
      // A command's honest failure belongs on the terminal, never swallowed
      // by the queue's catch-all.
      stderr.write(`  ${error.message}\n`);
      safePrompt();
    }
  };

  const dispatchLine = async (line) => {
    if (!line.startsWith('/') || line.startsWith('//')) {
      const thought = line.startsWith('//') ? line.slice(1) : line;
      await runTurn(thought);
      return;
    }
    const [cmd, ...rest] = line.slice(1).split(/\s+/);
    const argText = line.slice(1 + cmd.length).trim();
    switch (cmd) {
      case 'help': stdout.write(`${HELP.trim()}\n`); break;
      case 'attach': {
        if (!argText) { stdout.write('usage: /attach <paths...>\n'); break; }
        const paths = argText.split(/\s+/);
        const bad = paths.find((p) => stageKind(p) === null);
        if (bad) { stderr.write(`  unsupported: ${bad} (png/jpg/webp/gif or text files)\n`); break; }
        staged.push(...paths.map((p) => ({ kind: stageKind(p), path: p })));
        stdout.write(`${describeStaged(staged)}\n`);
        break;
      }
      case 'detach': staged = []; stdout.write('staged attachments dropped\n'); break;
      case 'status': stdout.write(`${await statusLine()}\n`); break;
      case 'server': await runServerStatus({ stdout, stderr }); break;
      case 'model':
        if (argText.startsWith('set ') || argText === 'natal') {
          await runModelChange({ laneId: live.connection.neumaId, argText: argText.startsWith('set ') ? argText.slice(4).trim() : argText, stdout, stderr });
        } else if (!argText) {
          await runModelShow({ laneId: live.connection.neumaId, stdout });
        } else {
          stderr.write('  usage: /model  ·  /model set <provider/model>  ·  /model natal\n');
        }
        break;
      case 'new': live.connection.sessionId = null; stdout.write('session cleared — next turn opens a fresh one\n'); break;
      case 'being':
        if (!argText) {
          stdout.write(`${formatHouseRoster(seats)}\n`);
          rl.setPrompt('seat › ');
          picking = true;
          return;
        }
        {
          const next = resolveSeatLane({ workspace: argText, neuma: seats });
          if (next.error || !next.laneId) { stderr.write(`  ${next.error || 'name a being'}\n`); break; }
          await reseat(next.laneId);
        }
        break;
      case 'preset':
        if (!['grounded', 'balanced', 'expansive'].includes(argText)) { stdout.write('preset: grounded | balanced | expansive\n'); break; }
        preset = argText;
        stdout.write(`preset: ${preset}\n`);
        break;
      case 'quit':
      case 'exit': rl.close(); return;
      default: stderr.write(`  unknown command /${cmd} — /help lists them\n`);
    }
    safePrompt();
  };

  // impure — resolve one picker answer: seat a member (first or again), retry
  // on ambiguity, or cancel back to the seated prompt (or exit when none).
  const applyPick = async (answer) => {
    const verdict = matchPick(answer, seats);
    if (verdict.kind === 'retry') { stderr.write(`  ${verdict.why}\n`); safePrompt(); return; }
    if (verdict.kind === 'cancel' && seated()) {
      picking = false;
      rl.setPrompt(`${live.name} › `);
      stdout.write('still seated — /quit leaves\n');
      safePrompt();
      return;
    }
    if (verdict.kind === 'cancel') { rl.close(); return; }
    try {
      await reseat(verdict.seat.laneId);
      picking = false;
      if (!seated()) { rl.close(); return; } // reseat failed and nothing prior
      stderr.write(`[${live.name} · neuma code · ${ground}]\n`);
      rl.setPrompt(`${live.name} › `);
      safePrompt();
    } catch (error) {
      stderr.write(`  cannot seat ${verdict.seat.name} — ${error.message}\n`);
      if (!seated()) { rl.close(); return; }
      safePrompt();
    }
  };

  rl.on('line', (raw) => {
    const line = raw.endsWith('\\') && !raw.endsWith('\\\\') ? raw.slice(0, -1) : null;
    if (line !== null) {
      pending += line;
      safePrompt();
      return;
    }
    const full = `${pending}${raw}`;
    pending = '';
    if (!full.trim()) { safePrompt(); return; }
    if (picking) {
      // Route INSIDE the queue: piped lines all arrive before the first pick
      // finishes, so the picking decision must be made just-in-time.
      enqueue(() => (picking ? applyPick(full) : dispatch(full)));
      return;
    }
    // Lines run sequentially — a piped script's turns land in order.
    enqueue(() => dispatch(full));
  });
  rl.on('SIGINT', () => {
    if (inTurn) {
      interruptTurn();
      stderr.write('  ⌉ interrupting…\n');
      return;
    }
    if (Date.now() - lastCtrlC < 3000) { rl.close(); return; }
    lastCtrlC = Date.now();
    stdout.write('\n(again to exit — /quit also leaves)\n');
    safePrompt();
  });
  rl.on('close', () => {
    closed = true;
    if (live.connection) {
      const sessionId = live.portal.state.sessionId || live.connection.sessionId || 'unrecorded';
      stderr.write(`[${live.name} · ${live.portal.state.acts} act(s) · session ${sessionId}]\n`);
    }
    void mcpService.disconnect('filesystem').catch(() => {});
    maybeSettle();
  });

  // The REPL lives on the event loop; the command handler awaits this.
  return new Promise((resolve) => { settle = resolve; });
};

// impure — drain terminal pipes before the CLI's explicit exit (same law as
// the agent command: backend imports own long-lived handles).
const flushProcessStreams = () => Promise.all([
  new Promise((resolve) => process.stdout.write('', resolve)),
  new Promise((resolve) => process.stderr.write('', resolve)),
]);

export const registerCodeCommand = (cli, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  cli.command(
    'code',
    'open the interactive CLI coding harness (seat a neuma in this directory)',
    (y) => y
      .option('workspace', { describe: 'neuma lane id or chosen name (default: active being or the only local neuma)', type: 'string' })
      .option('ground', { describe: 'working directory the being may act on (default: current directory)', type: 'string' })
      .option('session', { describe: 'resume an existing session id', type: 'string' })
      .option('preset', { describe: 'inference preset — grounded | balanced | expansive', type: 'string' })
      .option('yes', { describe: 'pre-approve sandboxed coding/execute for this sitting', type: 'boolean', default: false }),
    async (argv) => {
      const terminalProcess = stdout === process.stdout && stderr === process.stderr;
      const previousLogLevel = process.env.LOG_LEVEL;
      if (terminalProcess) process.env.LOG_LEVEL = 'error';
      let exitCode;
      try {
        exitCode = await runCode({ cwd: process.cwd(), stdout, stderr, argv });
      } finally {
        if (previousLogLevel === undefined) delete process.env.LOG_LEVEL;
        else process.env.LOG_LEVEL = previousLogLevel;
      }
      if (terminalProcess) {
        await flushProcessStreams();
        process.exit(exitCode);
      }
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );
