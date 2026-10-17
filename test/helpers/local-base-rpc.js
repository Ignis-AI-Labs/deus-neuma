/**
 * A REAL JSON-RPC node on loopback, answering as Base (#390 tranche 6).
 *
 * Not a mock of `readBaseRpc` — a real HTTP JSON-RPC server that the real
 * `readBaseRpc` really opens a real `ethers.JsonRpcProvider` against. Provider
 * construction, the JSON-RPC envelope, the HTTP round trip, and ethers' own
 * ABI decode of the response all run. Sibling of `rpc-stub.js`, which does the
 * same for chain-reader's hostile-response cases; this one answers correctly
 * instead of badly.
 *
 * It does not merely echo a canned blob back. It DECODES the incoming
 * Multicall3 `aggregate3` call, reads which token each sub-call targets, and
 * answers per token from a balances map. So the call the client really
 * constructed is the thing being answered — a canned return cannot tell a
 * correct call from a malformed one, and would pass either.
 *
 * `wallet-rpc-browser.js` deliberately permits `http://127.0.0.1` ([…]), so pointing the real client here is real configuration,
 * not a bypass.
 */
import { createServer } from 'node:http';
import { ethers } from 'ethers';

export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
export const BASE_CHAIN_ID = '0x2105'; // 8453

const erc20 = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
const mc3 = new ethers.Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])',
]);

/**
 * Start a real Base-speaking JSON-RPC node.
 *
 * @param {object} [opts]
 * @param {Record<string, bigint|null>} [opts.balances] - token address (any
 *   case) → balance. `null` marks a sub-call the node reports as FAILED, which
 *   is what allowFailure exists to survive.
 * @param {string} [opts.ethBalance] - wei hex for eth_getBalance
 * @param {number} [opts.status] - non-200 to exercise the client's real
 *   failure path against a real HTTP error
 * @returns {Promise<{url: string, calls: any[], close: () => Promise<void>}>}
 */
export const startLocalBaseRpc = ({
  balances = {}, ethBalance = '0x' + (10n ** 18n).toString(16), status = 200,
} = {}) => new Promise((resolve) => {
  const calls = [];
  const byAddress = new Map(
    Object.entries(balances).map(([address, value]) => [address.toLowerCase(), value]),
  );

  const answerAggregate3 = (data) => {
    // Decode what the client ACTUALLY sent, and answer that.
    const [requested] = mc3.decodeFunctionData('aggregate3', data);

    const results = requested.map((call) => {
      const target = String(call.target).toLowerCase();
      // The sub-call must really be a balanceOf, or this node cannot serve it.
      try { erc20.decodeFunctionData('balanceOf', call.callData); }
      catch { return { success: false, returnData: '0x' }; }

      const balance = byAddress.has(target) ? byAddress.get(target) : 0n;
      return balance === null
        ? { success: false, returnData: '0x' }
        : { success: true, returnData: erc20.encodeFunctionResult('balanceOf', [balance]) };
    });
    return mc3.encodeFunctionResult('aggregate3', [results]);
  };

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (status !== 200) {
        res.writeHead(status, { 'Content-Type': 'text/plain' });
        res.end('rpc unavailable');
        return;
      }

      let payload = {};
      try { payload = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* {} */ }
      const batch = Array.isArray(payload) ? payload : [payload];

      const replies = batch.map((entry) => {
        const { id, method, params = [] } = entry || {};
        calls.push({ method, params });
        const ok = (result) => ({ jsonrpc: '2.0', id, result });

        switch (method) {
          case 'eth_chainId': return ok(BASE_CHAIN_ID);
          case 'net_version': return ok('8453');
          case 'eth_blockNumber': return ok('0x1');
          case 'eth_getBalance': return ok(ethBalance);
          case 'eth_call': {
            const to = String(params[0]?.to || '').toLowerCase();
            if (to !== MULTICALL3.toLowerCase()) {
              return { jsonrpc: '2.0', id, error: { code: -32000, message: 'unknown contract' } };
            }
            try { return ok(answerAggregate3(params[0].data)); }
            catch (err) {
              return { jsonrpc: '2.0', id, error: { code: -32000, message: err.message } };
            }
          }
          default:
            return { jsonrpc: '2.0', id, error: { code: -32601, message: `no ${method}` } };
        }
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Array.isArray(payload) ? replies : replies[0]));
    });
  });

  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({
      url: `http://127.0.0.1:${port}`,
      calls,
      close: () => new Promise((done) => server.close(done)),
    });
  });
});

/**
 * A real Map-backed localStorage, carrying the custom-RPC pointer the real
 * `getBrowserRpc()` reads. Real storage semantics, real key scoping — the
 * client resolves its endpoint exactly as it does in a browser.
 * @param {string} rpcUrl
 * @param {string} [walletAddress] - scopes the key, as the real app does
 */
export const storageWithRpc = (rpcUrl, walletAddress = null) => {
  const store = new Map();
  if (walletAddress) store.set('walletAddress', walletAddress);
  // The real scoped key from wallet-rpc-browser.js: '<wallet>:base-rpc'.
  store.set(walletAddress ? `${walletAddress.toLowerCase()}:base-rpc` : 'base-rpc', rpcUrl);
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    _store: store,
  };
};

/**
 * A minimal but REAL browser window for modules that legitimately need one at
 * import time (WalletDiscovery registers an EIP-6963 listener the moment it
 * loads). Node's own `EventTarget` supplies real addEventListener /
 * dispatchEvent semantics, so this is a browser-API shim rather than a stand-in
 * for anything under test — nothing here decides an answer.
 *
 * `neuma.wallet` is deliberately ABSENT: readBaseRpc prefers an injected
 * desktop wallet bridge when present, and its absence is what routes the read
 * down the JsonRpcProvider path this suite exercises.
 *
 * (A jsdom devDependency would cover this whole class properly — the open
 * question behind #390 tranche 7.)
 */
export const browserWindow = (storage) => Object.assign(new EventTarget(), {
  localStorage: storage,
  location: { href: 'http://localhost/', origin: 'http://localhost' },
});
