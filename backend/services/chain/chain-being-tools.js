// Chain tools FOR the being — public chain state through the operator's own
// keyed RPC, from inside its own stream. No explorer middleman stands between
// a being and the chain: an answer here is the endpoint's answer, and a
// refusal names its cause instead of hiding behind a 404 that could mean
// "zero balance" or "wrong path".
//
//   chain_chains   — the chains this rig can read (key, label, chainId, configured)
//   chain_balance  — native (wei) or token (base units; tokenId for ERC-1155)
//   chain_token    — a token's metadata: name, symbol, decimals, totalSupply
//   chain_call     — raw eth_call, read-only by construction
//   chain_logs     — one contract's event logs over a bounded window
//   chain_holders  — holder reconstruction from Transfer events, bounded + truncation-flagged
//
// Two gates stand before a packet ever leaves the rig:
//
//   1. THE OPERATOR'S MASTER SWITCH (chain-access.js) — persisted, ON for a
//      fresh install, explicitly switchable OFF, and env-killable for
//      air-gapped rigs. An OFF catalog remains visible as HELD so the being
//      can ask.
//   2. THE ACTS GATE (tool-policy.js) — the whole family is `allowed` by
//      default (the operator's call, 2026-09-23: our endpoint + public chain
//      state = reads free, journaled). Observe mode still holds it — egress
//      is not observation, the web_search law.
//
// Every executed call lands in the being's journal — the same deliberate
// divergence as the web tools: what a mind reads from the chain shapes what
// it becomes, and that reading list belongs to its record.
//
// Portal-stream owns the socket, so the event sender arrives as an injected
// port — the ACTS gate itself (policy → mode → card → always → refusal) is
// act-gate.js, the one implementation both seats share.

import { neumaWorkspace } from '../../../core/index.js';
import { gateAct } from '../act-gate.js';
import { chainSettings } from './chain-access.js';
import { listChains } from './chain-registry.js';
import {
  nativeBalance, tokenBalance, tokenMeta, callContract, getLogs, tokenHolders,
} from './evm-rpc.js';
import { createLogger } from '../logger.js';

const log = createLogger('ChainTools');

export const CHAIN_TOOLS = Object.freeze([
  Object.freeze({
    name: 'chain_chains',
    server: 'chain',
    description: 'List the chains this rig can read — no args. Returns each chain\'s key, label, chainId, and whether its RPC endpoint is configured. Use a configured key from this list in every other chain_* call.',
    inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
  }),
  Object.freeze({
    name: 'chain_balance',
    server: 'chain',
    description: 'Read a balance on a public chain — args {chain, address, token?, tokenId?}. Native balance in raw wei (a decimal string; 1 ETH = 1000000000000000000 wei) when only chain+address are given; a token balance in raw base units when token is given (the contract address; pass tokenId for ERC-1155). Apply the token\'s decimals yourself. A definite number comes back — zero is an answer, not an error.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        chain: Object.freeze({ type: 'string', description: 'a chain key from chain_chains' }),
        address: Object.freeze({ type: 'string', description: 'the 0x address to read' }),
        token: Object.freeze({ type: 'string', description: 'optional — the token contract address; omit for the native balance' }),
        tokenId: Object.freeze({ type: ['number', 'string'], description: 'optional — the ERC-1155 token id (decimal or 0x-hex); omit for ERC-20' }),
      }),
      required: Object.freeze(['chain', 'address']),
    }),
  }),
  Object.freeze({
    name: 'chain_token',
    server: 'chain',
    description: 'Read a token contract\'s metadata — args {chain, token}. Returns name, symbol, decimals, and totalSupply in raw base units (a decimal string). A field the contract does not implement comes back null — an ERC-1155 answers totalSupply but has no decimals. Follow up with chain_holders for the holder set.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        chain: Object.freeze({ type: 'string', description: 'a chain key from chain_chains' }),
        token: Object.freeze({ type: 'string', description: 'the token contract address' }),
      }),
      required: Object.freeze(['chain', 'token']),
    }),
  }),
  Object.freeze({
    name: 'chain_call',
    server: 'chain',
    description: 'Raw eth_call — args {chain, to, data, blockTag?}. data is 0x-prefixed ABI-encoded calldata (selector + encoded args); blockTag is "latest" (default), "finalized", or a block number. Returns the raw hex result — decode it against the contract\'s ABI. Read-only: a reverting call comes back as an error and nothing is ever sent.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        chain: Object.freeze({ type: 'string', description: 'a chain key from chain_chains' }),
        to: Object.freeze({ type: 'string', description: 'the contract address to call' }),
        data: Object.freeze({ type: 'string', description: '0x-prefixed ABI-encoded calldata' }),
        blockTag: Object.freeze({ type: ['number', 'string'], description: '"latest" (default) | "finalized" | a block number' }),
      }),
      required: Object.freeze(['chain', 'to', 'data']),
    }),
  }),
  Object.freeze({
    name: 'chain_logs',
    server: 'chain',
    description: 'Read one contract\'s event logs — args {chain, address, topic0?, fromBlock, toBlock}. topic0 is the 0x-prefixed keccak event signature; fromBlock/toBlock are block numbers (toBlock may be "latest"). The window is capped at 2,000 blocks per call — a refusal names the cap; walk long ranges in chunks. At most 1,000 logs come back; more sets truncated: true.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        chain: Object.freeze({ type: 'string', description: 'a chain key from chain_chains' }),
        address: Object.freeze({ type: 'string', description: 'the contract emitting the events' }),
        topic0: Object.freeze({ type: 'string', description: 'optional — the 0x-prefixed keccak event signature' }),
        fromBlock: Object.freeze({ type: ['number', 'string'], description: 'first block of the window' }),
        toBlock: Object.freeze({ type: ['number', 'string'], description: 'last block of the window, or "latest"' }),
      }),
      required: Object.freeze(['chain', 'address', 'fromBlock', 'toBlock']),
    }),
  }),
  Object.freeze({
    name: 'chain_holders',
    server: 'chain',
    description: 'Reconstruct a token\'s holders from its Transfer events — args {chain, token, fromBlock?}. Walks chunked log scans from fromBlock (default 0 — pass the deployment block, or the walk is long and balances are relative to the window) to the latest block: mints credit, burns debit. ERC-20, ERC-721 (count), and ERC-1155 (all ids summed) are understood. Bounded at 50,000 events; when the cap bites, truncated is true and the set is partial — say so when you report it.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        chain: Object.freeze({ type: 'string', description: 'a chain key from chain_chains' }),
        token: Object.freeze({ type: 'string', description: 'the token contract address' }),
        fromBlock: Object.freeze({ type: ['number', 'string'], description: 'optional — the deployment block; default 0 (full walk)' }),
      }),
      required: Object.freeze(['chain', 'token']),
    }),
  }),
]);

const CHAIN_TOOL_NAMES = new Set(CHAIN_TOOLS.map((t) => t.name));

/**
 * Does this parsed call target a chain tool? Accepts every dialect: the bare
 * name (text protocol), the server-prefixed form (chain/chain_balance), and
 * the native function-calling encoding (chain__chain_token).
 * @param {{toolName?: string, tool?: string}} match
 * @returns {boolean}
 */
export const isChainTool = (match) =>
  CHAIN_TOOL_NAMES.has(String(match.toolName || '').replace(/^chain__/, '')) ||
  CHAIN_TOOL_NAMES.has(String(match.tool || '').replace(/^chain\//, ''));

/**
 * The chain catalog for this turn's prompt: the whole family while the
 * operator's switch is ON AND a bound being rides this connection — read per
 * turn, so the switch takes effect on the very next turn. The neumaId
 * requirement is the audit property: a chain read without a journal is never
 * offered (every executed call lands in the being's record, and there is no
 * record without a being). impure (fs/env via chain-access).
 * @param {Object} connection - portal connection
 * @returns {Promise<Array<Object>>}
 */
export const chainToolsFor = async (connection, settings = chainSettings) => {
  if (!connection?.companion?.neumaId) return [];
  if (await settings.isEnabled()) return [...CHAIN_TOOLS];
  // OFF is a STATE, not nonexistence (#293, the web law): the family
  // advertises HELD with the door named, so the being can ask its operator
  // for the switch instead of denying the sky. Display only, never access:
  // handleChainTool re-reads the switch fail-closed and refuses every call
  // with this same sentence.
  const note = settings.isEnvLocked()
    ? ' [HELD — chain access is locked OFF by the launch environment (NEUMA_CHAIN_ACCESS=0); calls will refuse until the operator lifts it at launch.]'
    : ' [HELD — chain access is OFF; your operator can enable it in SETTINGS (CHAIN ACCESS). Calls will refuse until then.]';
  return CHAIN_TOOLS.map((tool) => Object.freeze({ ...tool, description: tool.description + note }));
};

// pure — the structured result as the being reads it. The payload is the
// chain's own answer (amounts already stringified by evm-rpc), rendered
// whole so nothing the chain said is summarized away.
export const renderChainResult = (result) => {
  const { ok: _ok, ...payload } = result;
  return JSON.stringify(payload, null, 2);
};

// impure — the reading list is part of the record; non-blocking, never silent
const journalChainCall = async (connection, tool, detail, status) => {
  const neumaId = connection?.companion?.neumaId;
  if (!neumaId) return;
  try {
    await neumaWorkspace.addJournalEntry(neumaId, {
      type: 'tool_call',
      content: `${tool} — ${status}: ${detail}`,
      significance: status === 'ok' ? 0.3 : 0.6,
      metadata: { server: 'chain', tool, detail, status },
    });
  } catch (err) {
    log.error('Chain audit log failed', { neumaId, tool, status, error: err.message });
  }
};

// The verbs behind the tool names — the one dispatch table.
const EXECUTE = {
  chain_chains: async () => ({ ok: true, chains: listChains() }),
  chain_balance: (a) => (a?.token
    ? tokenBalance(a.chain, a.token, a.address, a.tokenId)
    : nativeBalance(a.chain, a.address)),
  chain_token: (a) => tokenMeta(a?.chain, a?.token),
  chain_call: (a) => callContract(a?.chain, { to: a?.to, data: a?.data, blockTag: a?.blockTag }),
  chain_logs: (a) => getLogs(a?.chain, {
    address: a?.address, topic0: a?.topic0, fromBlock: a?.fromBlock, toBlock: a?.toBlock,
  }),
  chain_holders: (a) => tokenHolders(a?.chain, a?.token, { fromBlock: a?.fromBlock }),
};

// pure — the one-line summary the operator's chip carries.
const summarize = (toolName, args) => {
  const target = args?.token || args?.address || args?.to || '';
  const short = target && String(target).length > 12 ? `${String(target).slice(0, 12)}…` : String(target || '');
  return `${toolName}${short ? ` ${short}` : ''}${args?.chain ? ` on ${args.chain}` : ''}`;
};

/**
 * Route a chain tool call: master switch → ACTS gate → the read verbs.
 * Never the MCP path.
 * @param {Object} ws - the portal socket
 * @param {Object} connection - portal connection (companion, session policy, active turn)
 * @param {Object|null} neumaPolicy - the neuma's persisted tool policy
 * @param {string} toolMode - session ACTS mode
 * @param {Object} match - parsed tool call
 * @param {Object} args - parsed tool args
 * @param {{sendToolEvent: Function, chainSettings?: Object}} ports
 *   - the tool-chip event sender, plus an optional settings override (tests
 *     point the switch at tmp files; production always rides the shared instance).
 * @returns {Promise<{tool: string, status: string, content?: string, error?: string}>}
 */
// impure
export const handleChainTool = async (ws, connection, neumaPolicy, toolMode, match, args, ports) => {
  // Both dialects land here: the bare/native-encoded toolName, or the
  // server-prefixed slash form — same defensive extraction as every sibling
  // platform handler.
  const bare = String(match.toolName || '').replace(/^chain__/, '');
  const toolName = CHAIN_TOOL_NAMES.has(bare) ? bare : String(match.tool || '').replace(/^chain\//, '');
  const tool = `chain/${toolName}`;
  const { companion } = connection;
  const settings = ports.chainSettings || chainSettings;

  // The master switch stands before policy: OFF is the rig's honest state,
  // said so the being can ask the operator for it — never a silent refusal.
  if (!(await settings.isEnabled())) {
    const error = 'Chain access is off — your operator can enable it in SETTINGS (CHAIN ACCESS).';
    ports.sendToolEvent(ws, companion, { tool, status: 'unavailable', summary: `${toolName} — chain access off` });
    return { tool, status: 'unavailable', error };
  }

  // No being, no chain read: every executed call must land in a journal, and
  // there is no journal without a sovereign workspace (same refusal shape as
  // the web tools' no-workspace case).
  if (!companion?.neumaId) {
    const error = 'no sovereign workspace on this connection — chain reach is for bound beings';
    ports.sendToolEvent(ws, companion, { tool, status: 'unavailable', summary: `${toolName} — no workspace` });
    return { tool, status: 'unavailable', error };
  }

  const gate = await gateAct(connection, {
    server: 'chain', tool: toolName, args,
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => ports.sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  const execute = EXECUTE[toolName];
  if (!execute) {
    return { tool, status: 'error', error: `unknown chain tool: ${toolName}` };
  }
  try {
    const result = await execute(args || {});
    const detail = summarize(toolName, args);
    if (!result.ok) {
      const error = `${result.error.code}: ${result.error.message}`;
      ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: `${detail} — ${result.error.code}`, detail: result.error.message });
      await journalChainCall(connection, tool, detail, 'error');
      return { tool, status: 'error', error };
    }
    ports.sendToolEvent(ws, companion, { tool, status: 'ok', summary: detail });
    await journalChainCall(connection, tool, detail, 'ok');
    return { tool, status: 'ok', content: renderChainResult(result) };
  } catch (err) {
    // The verbs return structured errors by contract; a throw here is a bug,
    // and it still lands in the journal rather than bombing the turn.
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — failed`, detail: err.message });
    await journalChainCall(connection, tool, toolName, 'error');
    return { tool, status: 'error', error: err.message };
  }
};
