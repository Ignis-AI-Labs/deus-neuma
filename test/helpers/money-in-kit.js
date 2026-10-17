/**
 * money-in kit — a REAL local chain for the money-in suites: anvil on an
 * ephemeral port, answering as Base (chainId 8453) so chain-registry's
 * wrong-chain defense accepts it exactly as it accepts the operator's
 * endpoint, plus two contracts assembled here, byte by byte, because this
 * machine has no solc:
 *
 *   - MINI_ERC20: a minimal, real ERC-20 — balanceOf, decimals (6), and a
 *     transfer that moves storage balances and emits the standard
 *     Transfer(address,address,uint256) event. The deployer is minted the
 *     whole supply. It reverts on an unknown selector or an overdraft.
 *   - FORWARDER: forwards its call value to the address in calldata by an
 *     INTERNAL call — the native blind spot the ledger must name as a gap.
 *
 * Nothing here stands in for the chain: anvil executes the bytecode, and
 * the ledger reads it through ethers over HTTP like any node.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ethers } from 'ethers';

// ── A tiny assembler: opcodes, PUSHes, labels (2-byte jump targets) ────────
const OP = Object.freeze({
  STOP: 0x00, ADD: 0x01, SUB: 0x03, LT: 0x10, EQ: 0x14, SHR: 0x1c, CALLVALUE: 0x34, CALLDATALOAD: 0x35,
  CALLER: 0x33, CODECOPY: 0x39, POP: 0x50, MSTORE: 0x52, SLOAD: 0x54, SSTORE: 0x55, JUMPI: 0x57,
  GAS: 0x5a, JUMPDEST: 0x5b, DUP1: 0x80, DUP2: 0x81, DUP3: 0x82, SWAP1: 0x90, LOG3: 0xa3,
  CALL: 0xf1, RETURN: 0xf3, REVERT: 0xfd,
});

const push = (hex) => {
  const bytes = ethers.getBytes(hex);
  return [0x5f + bytes.length, ...bytes];
};

// items: opcode names, ['push', hex], ['label', name], ['ref', name]
const assemble = (items) => {
  const size = (it) => (typeof it === 'string' ? 1 : it[0] === 'label' ? 1 : it[0] === 'ref' ? 3 : push(it[1]).length);
  const labels = new Map();
  let at = 0;
  for (const it of items) {
    if (Array.isArray(it) && it[0] === 'label') labels.set(it[1], at);
    at += size(it);
  }
  const out = [];
  for (const it of items) {
    if (typeof it === 'string') out.push(OP[it]);
    else if (it[0] === 'label') out.push(OP.JUMPDEST);
    else if (it[0] === 'ref') out.push(0x61, labels.get(it[1]) >> 8, labels.get(it[1]) & 0xff);
    else out.push(...push(it[1]));
  }
  return ethers.hexlify(Uint8Array.from(out));
};

const selector = (sig) => ethers.id(sig).slice(0, 10);
const returnWord = [['push', '0x00'], 'MSTORE', ['push', '0x20'], ['push', '0x00'], 'RETURN'];
const TRANSFER = ethers.id('Transfer(address,address,uint256)');

const ERC20_RUNTIME = assemble([
  ['push', '0x00'], 'CALLDATALOAD', ['push', '0xe0'], 'SHR',
  'DUP1', ['push', selector('transfer(address,uint256)')], 'EQ', ['ref', 'transfer'], 'JUMPI',
  'DUP1', ['push', selector('balanceOf(address)')], 'EQ', ['ref', 'balanceOf'], 'JUMPI',
  'DUP1', ['push', selector('decimals()')], 'EQ', ['ref', 'decimals'], 'JUMPI',
  ['label', 'fail'], ['push', '0x00'], 'DUP1', 'REVERT',
  ['label', 'decimals'], ['push', '0x06'], ...returnWord,
  ['label', 'balanceOf'], ['push', '0x04'], 'CALLDATALOAD', 'SLOAD', ...returnWord,
  ['label', 'transfer'],
  ['push', '0x24'], 'CALLDATALOAD', // amount
  'CALLER', 'SLOAD', // bal amount
  'DUP2', 'DUP2', 'LT', ['ref', 'fail'], 'JUMPI', // overdraft reverts
  'DUP2', 'SWAP1', 'SUB', 'CALLER', 'SSTORE', // bal[caller] -= amount
  ['push', '0x04'], 'CALLDATALOAD', 'DUP1', 'SLOAD', 'DUP3', 'ADD', 'SWAP1', 'SSTORE', // bal[to] += amount
  ['push', '0x00'], 'MSTORE', // memory[0] = amount
  ['push', '0x04'], 'CALLDATALOAD', 'CALLER', ['push', TRANSFER], ['push', '0x20'], ['push', '0x00'], 'LOG3',
  ['push', '0x01'], ...returnWord,
]);

/** Creation code: mint `supply` to the deployer, then return the runtime. */
export const miniErc20Initcode = (supply) => {
  const runtimeLen = ethers.getBytes(ERC20_RUNTIME).length;
  const prefix = (offset) => assemble([
    ['push', ethers.toBeHex(supply, 32)], 'CALLER', 'SSTORE',
    ['push', ethers.toBeHex(runtimeLen, 2)], 'DUP1', ['push', ethers.toBeHex(offset, 2)], ['push', '0x00'], 'CODECOPY',
    ['push', '0x00'], 'RETURN',
  ]);
  const offset = ethers.getBytes(prefix(0)).length;
  return ethers.concat([prefix(offset), ERC20_RUNTIME]);
};

const FORWARDER_RUNTIME = assemble([
  ['push', '0x00'], 'DUP1', 'DUP1', 'DUP1', 'CALLVALUE', ['push', '0x00'], 'CALLDATALOAD', 'GAS', 'CALL', 'POP', 'STOP',
]);

/** Creation code for the forwarder. */
export const forwarderInitcode = () => {
  const len = ethers.getBytes(FORWARDER_RUNTIME).length;
  const prefix = (offset) => assemble([
    ['push', ethers.toBeHex(len, 2)], 'DUP1', ['push', ethers.toBeHex(offset, 2)], ['push', '0x00'], 'CODECOPY',
    ['push', '0x00'], 'RETURN',
  ]);
  return ethers.concat([prefix(ethers.getBytes(prefix(0)).length), FORWARDER_RUNTIME]);
};

export const MINI_ERC20_ABI = Object.freeze([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address who) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

/**
 * Start anvil on an ephemeral loopback port. impure (child process).
 * @param {{ chainId?: number }} [opts]
 * @returns {Promise<{ url: string, pid: number, stop: () => Promise<void> }>}
 */
export const startAnvil = async ({ chainId = 8453 } = {}) => {
  const child = spawn('anvil', ['--port', '0', '--host', '127.0.0.1', '--chain-id', String(chainId)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('anvil did not announce its port')), 15000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`anvil exited before readiness: ${code}`)); });
    child.stdout.on('data', (chunk) => {
      output = (output + chunk.toString()).slice(-32768);
      const match = output.match(/Listening on 127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    });
    child.stderr.resume();
  });
  child.stdout.resume();
  return {
    url,
    pid: child.pid,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    },
  };
};
