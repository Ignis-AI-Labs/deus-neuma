/**
 * listTokenBalances — against a REAL JSON-RPC node on loopback (#390 tranche 6).
 *
 * `readBaseRpc` used to be mocked, on two stated grounds: no network, and
 * avoiding wallet-client's browser-only deps. Neither needed a stub.
 * `wallet-rpc-browser.js` deliberately permits `http://127.0.0.1` ([…]), and a real Map-backed `localStorage` is enough for the
 * client to resolve its endpoint exactly as a browser would. So the real
 * `readBaseRpc` now opens a real `ethers.JsonRpcProvider` against a real
 * server: provider construction, the JSON-RPC envelope, the HTTP round trip,
 * and ethers' own decode all run.
 *
 * The node does not echo a canned blob. It DECODES the `aggregate3` call the
 * client really sent, checks each sub-call really is a `balanceOf`, and
 * answers per token. A canned return cannot tell a correct call from a
 * malformed one and would certify either — which is exactly what the old
 * `readBaseRpc.mockResolvedValue(...)` did: the request was never examined, so
 * a client asking for the WRONG ADDRESS decoded identically.
 *
 * Locks: non-zero filtering, per-token decimals, allowFailure skipping,
 * coingeckoId pass-through, one-round-trip batching, and graceful degrade to [].
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ethers } from 'ethers';
import {
  startLocalBaseRpc, storageWithRpc, browserWindow, MULTICALL3,
} from '../helpers/local-base-rpc.js';

const OWNER = '0x' + '11'.repeat(20);
const AAA = { address: '0x' + 'a1'.repeat(20), symbol: 'AAA', name: 'A coin', decimals: 6, coingeckoId: 'aaa' };
const BBB = { address: '0x' + 'b2'.repeat(20), symbol: 'BBB', name: 'B coin', decimals: 18, coingeckoId: 'bbb' };

const mc3 = new ethers.Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])',
]);
const erc20 = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);

let node;

/** Point the real client at a real node, then import it fresh. */
const withNode = async (options) => {
  node = await startLocalBaseRpc(options);
  const storage = storageWithRpc(node.url, OWNER);
  vi.stubGlobal('localStorage', storage);
  // WalletDiscovery registers a real EIP-6963 listener at import; Node's own
  // EventTarget gives it real event machinery to register against.
  vi.stubGlobal('window', browserWindow(storage));
  vi.resetModules();
  const { listTokenBalances } = await import('../../frontend/app/RelinkShell/wallet-tokens.js');
  return listTokenBalances;
};

afterEach(async () => {
  vi.unstubAllGlobals();
  if (node) await node.close();
  node = null;
});

describe('listTokenBalances', () => {
  it('returns only non-zero holdings, with correct decimals + coingeckoId', async () => {
    const listTokenBalances = await withNode({
      balances: { [AAA.address]: 1500000n, [BBB.address]: 0n }, // AAA = 1.5 (6dp)
    });

    const out = await listTokenBalances(OWNER, [AAA, BBB]);
    expect(out).toEqual([
      { address: AAA.address, symbol: 'AAA', name: 'A coin', decimals: 6, coingeckoId: 'aaa', balance: '1.5' },
    ]);

    // The call really went out, to the real Multicall3 address, over the wire.
    const call = node.calls.find((c) => c.method === 'eth_call');
    expect(call.params[0].to.toLowerCase()).toBe(MULTICALL3.toLowerCase());
  });

  it('formats 18-decimal balances correctly', async () => {
    const listTokenBalances = await withNode({
      balances: { [AAA.address]: 0n, [BBB.address]: 2000000000000000000n },
    });
    const out = await listTokenBalances(OWNER, [AAA, BBB]);
    expect(out).toEqual([
      { address: BBB.address, symbol: 'BBB', name: 'B coin', decimals: 18, coingeckoId: 'bbb', balance: '2.0' },
    ]);
  });

  it('skips a failed (allowFailure) sub-call without poisoning the list', async () => {
    const listTokenBalances = await withNode({
      balances: { [AAA.address]: null, [BBB.address]: 5000000000000000000n },
    });
    const out = await listTokenBalances(OWNER, [AAA, BBB]);
    expect(out.map((t) => t.symbol)).toEqual(['BBB']);
  });

  it('asks for the OWNER\'s balance at the right token — really, in the call data', async () => {
    // The assertion a canned return makes impossible: with the request never
    // examined, `balanceOf(someoneElse)` decoded exactly the same.
    const listTokenBalances = await withNode({ balances: { [AAA.address]: 1000000n } });
    await listTokenBalances(OWNER, [AAA]);

    const call = node.calls.find((c) => c.method === 'eth_call');
    const [requested] = mc3.decodeFunctionData('aggregate3', call.params[0].data);
    expect(requested).toHaveLength(1);
    expect(requested[0].target.toLowerCase()).toBe(AAA.address.toLowerCase());
    expect(requested[0].allowFailure).toBe(true);

    const [asked] = erc20.decodeFunctionData('balanceOf', requested[0].callData);
    expect(asked.toLowerCase()).toBe(OWNER.toLowerCase());
  });

  it('batches the whole token list into ONE eth_call', async () => {
    // The module's reason for existing — one round trip, not N. Countable only
    // because a real server is counting real requests.
    const listTokenBalances = await withNode({
      balances: { [AAA.address]: 1n, [BBB.address]: 1n },
    });
    await listTokenBalances(OWNER, [AAA, BBB]);
    expect(node.calls.filter((c) => c.method === 'eth_call')).toHaveLength(1);
  });

  it('degrades to [] when the RPC really answers 500', async () => {
    const listTokenBalances = await withNode({ status: 500 });
    expect(await listTokenBalances(OWNER, [AAA, BBB])).toEqual([]);
  });

  it('degrades to [] when the node is really unreachable', async () => {
    const listTokenBalances = await withNode({ balances: {} });
    await node.close();
    node = null;
    expect(await listTokenBalances(OWNER, [AAA, BBB])).toEqual([]);
  });

  it('returns [] for a missing owner, without asking the node anything', async () => {
    const listTokenBalances = await withNode({ balances: {} });
    expect(await listTokenBalances(null, [AAA])).toEqual([]);
    expect(node.calls.filter((c) => c.method === 'eth_call')).toHaveLength(0);
  });
});
