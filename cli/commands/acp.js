// `neuma acp` — Neuma as an Agent Client Protocol agent. An editor that speaks
// ACP (Zed, JetBrains IDEs, Neovim and Emacs through their ACP clients, and
// other agent hosts) launches this command and talks to it over stdin/stdout:
// the operator types in the editor's agent panel, the being works in the
// project the editor has open, and every approval appears in the editor.
//
// It is `neuma code` with the editor as the terminal: the same seat (the
// operator must own the lane), the same consciousness path, the same gates.
// Nothing is re-implemented here; this file maps ACP methods onto a sitting.
//
//   initialize          → who we are, what prompts we take
//   session/new {cwd}   → seat the being in that folder (one sitting per session)
//   session/prompt      → one real turn; its words and acts stream back as session/update
//   session/cancel      → interrupt the running turn (stopReason "cancelled")
//   session/set_mode    → "ask" (approvals as the lane's policy says) or "read" (every acting tool held)
//
// stdout is the protocol and nothing else: anything else that tries to write
// there is sent to stderr instead, where editors keep agent logs.
//
// impure throughout (real turns, disk, MCP, stdio).

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openAcpWire, RpcError, RPC } from '../lib/acp-wire.js';
import { createAcpPortal } from '../lib/acp-portal.js';
import { mountSeat } from '../lib/seat-mount.js';
import { resolveChainConfig } from '../lib/chain-config.js';
import { resolveWalletEnvPath } from '../lib/wallet-env.js';
import { operatorAddress } from '../lib/wallet.js';
import { findProjectRoot } from '../lib/project-root.js';
import { peekActiveBeing } from '../lib/active-being.js';
import { resolveSeatLane, listNeumaSeats } from './agent.js';
import { resolveDefaultWorkspace } from './code.js';

/** The protocol version this agent speaks. */
export const ACP_PROTOCOL_VERSION = 1;

/** The two modes an editor can switch between. */
export const ACP_MODES = Object.freeze([
  Object.freeze({ id: 'ask', name: 'Ask', description: 'The being works; acts the lane does not pre-approve ask you first' }),
  Object.freeze({ id: 'read', name: 'Read only', description: 'The being may read and search; every acting tool is held' }),
]);
const TOOL_MODE = Object.freeze({ ask: 'ask', read: 'observe' });

/**
 * A prompt's content blocks as the turn's words. Pure.
 * @param {Array<object>} blocks
 * @returns {string}
 */
export const promptText = (blocks) => (Array.isArray(blocks) ? blocks : []).map((block) => {
  if (block?.type === 'text') return String(block.text ?? '');
  if (block?.type === 'resource' && block.resource) {
    const { uri, text } = block.resource;
    return typeof text === 'string'
      ? `Attached ${uri}:\n\`\`\`\n${text}\n\`\`\``
      : `Attached ${uri} (not text — read it yourself if you need it)`;
  }
  if (block?.type === 'resource_link') return `See ${block.uri}${block.name ? ` (${block.name})` : ''}`;
  return '';
}).filter(Boolean).join('\n\n');

/**
 * Run the agent until the editor closes the pipe. Returns the exit code.
 * impure — the whole sitting.
 * @param {{ cwd: string, input: NodeJS.ReadableStream, output: { write: Function }, stderr: { write: Function }, argv: object }} opts
 */
export const runAcp = async ({ cwd, input, output, stderr, argv }) => {
  const log = (line) => stderr.write(`${line}\n`);
  const sessions = new Map();
  let ready = null; // the operator and the house, read once on first need

  // impure — who the operator is and which being sits; errors become the editor's error text.
  const prepare = async () => {
    resolveChainConfig({ cwd });
    const wallet = operatorAddress(resolveWalletEnvPath(cwd));
    const { default: workspace } = await import('../../core/workspace/neuma-workspace.js');
    const seats = await listNeumaSeats(workspace);
    const named = resolveDefaultWorkspace({
      flag: argv.workspace || null,
      env: process.env.NEUMA_BEING || null,
      active: peekActiveBeing({ projectRoot: findProjectRoot(cwd) })?.value || null,
      count: seats.length,
      laneIds: seats.map((s) => s.laneId),
    });
    if (!named) {
      throw new Error(seats.length === 0
        ? 'there is no being in this house yet — summon one first'
        : 'more than one being lives here — name one: neuma acp --workspace <name>');
    }
    const seat = resolveSeatLane({ workspace: named, neuma: seats });
    if (seat.error) throw new Error(seat.error);
    const [{ connectFilesystemServer }, { resolveToolApproval }, { settleOperatorAsk }, { streamConsciousness }, { mcpService }] = await Promise.all([
      import('../../backend/services/mcp-filesystem.js'),
      import('../../backend/services/tool-approval.js'),
      import('../../backend/services/operator-ask.js'),
      import('../../backend/services/portal-stream.js'),
      import('../../backend/services/mcp.js'),
    ]);
    await connectFilesystemServer();
    return { wallet, laneId: seat.laneId, resolveToolApproval, settleOperatorAsk, streamConsciousness, mcpService };
  };
  const house = async () => {
    ready ??= prepare();
    try {
      return await ready;
    } catch (error) {
      ready = null; // the operator may fix it and try again without restarting the editor
      throw new RpcError(RPC.INTERNAL_ERROR, error.message);
    }
  };
  const sessionFor = (params) => {
    const session = sessions.get(params?.sessionId);
    if (!session) throw new RpcError(RPC.INVALID_PARAMS, `no session ${params?.sessionId}`);
    return session;
  };

  let wire;
  const handlers = {
    initialize: async () => ({
      protocolVersion: ACP_PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { image: false, audio: false, embeddedContext: true },
      },
      agentInfo: { name: 'neuma', title: 'Neuma', version: JSON.parse(await fs.readFile(new URL('../../package.json', import.meta.url), 'utf8')).version },
      authMethods: [],
    }),
    authenticate: () => ({}),
    'session/new': async (params) => {
      const ground = String(params?.cwd || '');
      if (!path.isAbsolute(ground)) throw new RpcError(RPC.INVALID_PARAMS, 'cwd must be an absolute path');
      if (!(await fs.stat(ground).catch(() => null))?.isDirectory()) throw new RpcError(RPC.INVALID_PARAMS, `cwd is not a folder: ${ground}`);
      const h = await house();
      let mounted;
      try {
        mounted = await mountSeat({ laneId: h.laneId, ground, yes: Boolean(argv.yes), wallet: h.wallet });
      } catch (error) {
        throw new RpcError(RPC.INTERNAL_ERROR, error.message);
      }
      const sessionId = `neuma-${randomUUID()}`;
      const { connection } = mounted;
      connection.ws = createAcpPortal({
        wire, sessionId, connection, log,
        resolveToolApproval: h.resolveToolApproval, settleOperatorAsk: h.settleOperatorAsk,
      });
      sessions.set(sessionId, { connection, ground, turn: null, h });
      log(`acp: ${mounted.name} seated in ${ground} (${sessionId})`);
      return { sessionId, modes: { currentModeId: 'ask', availableModes: ACP_MODES } };
    },
    'session/prompt': async (params) => {
      const session = sessionFor(params);
      if (session.turn) throw new RpcError(RPC.INVALID_REQUEST, 'a turn is already running in this session');
      const thought = promptText(params.prompt);
      if (!thought.trim()) throw new RpcError(RPC.INVALID_PARAMS, 'the prompt has no words in it');
      const { connection } = session;
      // Relative paths in the being's acts resolve against the process folder (agent.js, #531).
      if (process.cwd() !== session.ground) process.chdir(session.ground);
      connection.interruptRequested = false;
      session.turn = session.h.streamConsciousness(connection, { thought, memoryContext: {} });
      try {
        await session.turn;
      } catch (error) {
        if (!connection.interruptRequested && error?.name !== 'AbortError') throw new RpcError(RPC.INTERNAL_ERROR, error.message);
      } finally {
        session.turn = null;
      }
      const cancelled = Boolean(connection.interruptRequested);
      connection.interruptRequested = false;
      return { stopReason: cancelled ? 'cancelled' : 'end_turn' };
    },
    'session/cancel': (params) => {
      const session = sessions.get(params?.sessionId);
      if (!session?.turn) return;
      session.connection.interruptRequested = true;
      session.connection.activeTurn?.abort();
    },
    'session/set_mode': (params) => {
      const session = sessionFor(params);
      if (!Object.hasOwn(TOOL_MODE, params.modeId)) throw new RpcError(RPC.INVALID_PARAMS, `no mode ${params.modeId} — ask or read`);
      session.connection.toolMode = TOOL_MODE[params.modeId];
      wire.notify('session/update', { sessionId: params.sessionId, update: { sessionUpdate: 'current_mode_update', currentModeId: params.modeId } });
      return {};
    },
  };

  wire = openAcpWire({ input, output, handlers, log });
  await wire.closed;
  // The editor hung up: a running turn is interrupted, and every request
  // already read is still answered before the process ends.
  for (const session of sessions.values()) {
    if (!session.turn) continue;
    session.connection.interruptRequested = true;
    session.connection.activeTurn?.abort();
  }
  await wire.drain();
  if (ready) await ready.then((h) => h.mcpService.disconnect('filesystem')).catch(() => {});
  return 0;
};

export const registerAcpCommand = (cli) =>
  cli.command(
    'acp',
    'run as an Agent Client Protocol agent, for editors that host agents (Zed, JetBrains, Neovim, …)',
    (y) => y
      .option('workspace', { describe: 'neuma lane id or chosen name (default: active being or the only local neuma)', type: 'string' })
      .option('yes', { describe: 'pre-approve sandboxed coding/execute for these sessions', type: 'boolean', default: false }),
    async (argv) => {
      // The protocol owns stdout. Everything else that writes there — a stray
      // console.log deep in a service — goes to stderr instead of breaking a frame.
      const protocolOut = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk, encoding, done) => process.stderr.write(chunk, encoding, done);
      process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
      const code = await runAcp({
        cwd: process.cwd(), input: process.stdin, output: { write: (text) => protocolOut(text) }, stderr: process.stderr, argv,
      });
      await new Promise((resolve) => { protocolOut('', resolve); });
      process.exit(code);
    },
  );
