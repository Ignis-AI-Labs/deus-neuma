// Minimal HTTP JSON-RPC stub — a real listener on a random localhost port
// that returns hostile responses to chain-reader's identity probe.
//
// Used by test/unit/chain-reader.test.js to exercise every failure mode
// (rate limit, server error, malformed body, hang, wrong chainId, wrong
// bytecode) with a REAL HTTP round-trip via ethers.js. RULE 0: no mock of
// the ethers boundary; the stub IS the RPC server, from ethers's point of
// view indistinguishable from a real one that happens to be misbehaving.
//
// Not exported outside test/; not for production use.

import { createServer } from 'node:http';

/**
 * Modes:
 *   'rate-limit'    → HTTP 429 to every request (Cloudflare / Alchemy under load)
 *   'server-error'  → HTTP 500 to every request
 *   'malformed'     → HTTP 200 with a body that isn't JSON
 *   'hang'          → accept the socket, never send a response (client must time out)
 *   'wrong-chainid' → HTTP 200 valid JSON, eth_chainId returns opts.chainId (default 0x1, not in our map),
 *                     eth_getCode returns a plausible bytecode
 *   'wrong-bytecode' → HTTP 200 valid JSON, eth_chainId returns 0x14a34 (Base Sepolia — IN our map),
 *                      eth_getCode returns hostile bytecode → hash mismatch
 *   'happy'          → a well-behaved read-only endpoint: eth_chainId (opts.chainId), eth_getBalance
 *                      (opts.balance), eth_blockNumber (opts.blockNumber), eth_call answered from
 *                      opts.token {name,symbol,decimals,totalSupply,balanceOf,balanceOf1155} by
 *                      selector (unknown selector → a real JSON-RPC revert error), eth_getLogs
 *                      filtered to the requested [fromBlock,toBlock] window from opts.logs,
 *                      eth_getTransactionByHash/eth_getTransactionReceipt → null (never seen),
 *                      eth_getBlockByNumber → a full-spec canned block.
 *
 * @param {{ mode: string, chainId?: string, code?: string, balance?: string, blockNumber?: string,
 *   token?: Object, logs?: Array<Object> }} opts
 * @returns {Promise<{ url: string, close: () => Promise<void>, requests: number }>}
 */
import { ethers } from 'ethers';

const happyCoder = ethers.AbiCoder.defaultAbiCoder();

// Spec-shaped canned block — every field ethers v6's block formatter requires.
const CANNED_BLOCK = {
  sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40a4931007',
  logsBloom: '0x' + '00'.repeat(256),
  transactionsRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
  stateRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
  receiptsRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
  miner: '0x0000000000000000000000000000000000000000',
  difficulty: '0x0',
  extraData: '0x',
  gasLimit: '0x1c9c380',
  gasUsed: '0x0',
  mixHash: '0x' + '00'.repeat(32),
  nonce: '0x0000000000000000',
  baseFeePerGas: '0x7',
  number: '0x100',
  hash: '0x' + '11'.repeat(32),
  parentHash: '0x' + '00'.repeat(32),
  timestamp: '0x65000000',
  transactions: [],
  uncles: [],
};

// eth_call by selector against opts.token; a field explicitly set to null is
// a method the contract does not implement → a real JSON-RPC revert error
// (ethers throws), exactly as a bare ERC-1155 refuses decimals(). Selectors
// are computed, never transcribed (the evm-rpc law — a hand-typed table once
// swapped totalSupply() for totalSupply(uint256)).
const HAPPY_SELECTORS = {
  name: ethers.id('name()').slice(0, 10),
  symbol: ethers.id('symbol()').slice(0, 10),
  decimals: ethers.id('decimals()').slice(0, 10),
  totalSupply: ethers.id('totalSupply()').slice(0, 10),
  balanceOf: ethers.id('balanceOf(address)').slice(0, 10),
  balanceOf1155: ethers.id('balanceOf(address,uint256)').slice(0, 10),
};
const happyCall = (data, token) => {
  const selector = String(data || '').slice(0, 10);
  const answered = (key, fallback) => {
    const value = token && key in token ? token[key] : fallback;
    if (value === null) return { error: { code: 3, message: 'execution reverted' } };
    return happyCoder.encode(['uint256'], [value]);
  };
  switch (selector) {
    case HAPPY_SELECTORS.name: {
      const v = token && 'name' in token ? token.name : 'Stub Token';
      return v === null ? { error: { code: 3, message: 'execution reverted' } } : happyCoder.encode(['string'], [v]);
    }
    case HAPPY_SELECTORS.symbol: {
      const v = token && 'symbol' in token ? token.symbol : 'STUB';
      return v === null ? { error: { code: 3, message: 'execution reverted' } } : happyCoder.encode(['string'], [v]);
    }
    case HAPPY_SELECTORS.decimals: return answered('decimals', 18);
    case HAPPY_SELECTORS.totalSupply: return answered('totalSupply', 0n);
    case HAPPY_SELECTORS.balanceOf: return answered('balanceOf', 0n);
    case HAPPY_SELECTORS.balanceOf1155: return answered('balanceOf1155', 0n);
    default: return { error: { code: 3, message: 'execution reverted' } };
  }
};

const happyRespond = (item, opts) => {
  const id = item?.id ?? 1;
  const method = item?.method ?? '';
  const params = Array.isArray(item?.params) ? item.params : [];
  const result = (value) => ({ jsonrpc: '2.0', id, result: value });
  switch (method) {
    case 'eth_chainId': return result(opts.chainId ?? '0x1');
    case 'net_version': return result(String(parseInt(opts.chainId ?? '0x1', 16)));
    case 'eth_getBalance': return result(opts.balance ?? '0x0');
    case 'eth_getCode': return result(opts.code ?? '0x600d'); // non-empty: a contract lives here
    case 'eth_blockNumber': return result(opts.blockNumber ?? '0x100');
    case 'eth_call': {
      const answer = happyCall(params[0]?.data, opts.token);
      return answer.error ? { jsonrpc: '2.0', id, error: answer.error } : result(answer);
    }
    case 'eth_getLogs': {
      const filter = params[0] || {};
      const from = filter.fromBlock ? Number(filter.fromBlock) : 0;
      const to = filter.toBlock ? Number(filter.toBlock) : Number.MAX_SAFE_INTEGER;
      const logs = (opts.logs || []).filter((l) => {
        const n = Number(l.blockNumber);
        return n >= from && n <= to;
      });
      return result(logs);
    }
    case 'eth_getTransactionByHash': return result(null);
    case 'eth_getTransactionReceipt': return result(null);
    case 'eth_getBlockByNumber': return result(CANNED_BLOCK);
    default: return result(null);
  }
};

export const createRpcStub = ({ mode, chainId = '0x1', code = '0xdeadbeef', ...opts } = {}) => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    // Collect body so we can dispatch on `method` — every RPC call goes to
    // the same URL, so the JSON-RPC method name is the dispatch key.
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      // ethers v6 uses BOTH single and batched JSON-RPC calls
      // (getNetwork() sends a single eth_chainId, then a subsequent probe
      // batches [eth_chainId, eth_getCode]). The stub has to handle both:
      // a single request expects a single object response; a batch (array)
      // expects an array of results. Getting this wrong makes ethers reject
      // the whole response with […], which
      // masquerades as rpc-error — and that's exactly the bug this comment
      // is here to prevent regressing.
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { body = {}; }
      const isBatch = Array.isArray(body);
      const items = isBatch ? body : [body];

      // Non-JSON hostile modes short-circuit before the dispatch loop —
      // whatever body ethers sent, we send back the hostile response.
      switch (mode) {
        case 'rate-limit':
          res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '60' });
          res.end('Too Many Requests');
          return;
        case 'server-error':
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error');
          return;
        case 'malformed':
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body>not the RPC you were looking for</body></html>');
          return;
        case 'hang':
          // Do NOT call res.end(). Socket stays open until server teardown.
          return;
      }

      // For the shape-valid hostile modes (wrong-chainid, wrong-bytecode)
      // dispatch per-item, then return single-vs-batch as appropriate.
      const respondTo = (item) => {
        const id = item?.id ?? 1;
        const method = item?.method ?? '';
        switch (mode) {
          case 'happy':
            return happyRespond(item, { chainId, code, ...opts });
          case 'wrong-chainid':
            if (method === 'eth_chainId') return { jsonrpc: '2.0', id, result: chainId };
            if (method === 'eth_getCode') return { jsonrpc: '2.0', id, result: code };
            return { jsonrpc: '2.0', id, result: null };
          case 'wrong-bytecode':
            if (method === 'eth_chainId') return { jsonrpc: '2.0', id, result: '0x14a34' }; // 84532 = Base Sepolia (in our map)
            if (method === 'eth_getCode') return { jsonrpc: '2.0', id, result: code };
            return { jsonrpc: '2.0', id, result: null };
          default:
            return { jsonrpc: '2.0', id, error: { code: -32601, message: `stub mode "${mode}" not handled` } };
        }
      };
      const responses = items.map(respondTo);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(isBatch ? responses : responses[0]));
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    // Port 0 = OS picks an available one — no test-vs-test port collisions
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        get requests() { return requests; },
        close: () => new Promise((r) => {
          // Close all sockets (including any 'hang' sockets) before
          // closing the listener, else server.close hangs indefinitely
          // waiting for the hung client sockets to drain.
          // closeAllConnections() requires Node >= 18.2. We don't guard
          // with `?.` because a silent no-op there would cause a hang-
          // mode test's afterEach to stall forever on 18.0/18.1 — a hard
          // TypeError is the better failure mode. package.json engines
          // declares >=18.0.0; effectively 18.2+ is required to run this
          // suite (bump the engines floor if we hit a 18.0/18.1 CI env).
          server.closeAllConnections();
          server.close(() => r());
        }),
      });
    });
  });
};
