// Pure helpers for EIP-1193 request handling — the fiddly, correctness-critical
// parsing kept out of the Electron-bound wiring so it can be unit-tested:
// disambiguating personal_sign argument order and parsing signTypedData_v4.
// No Electron, no network.

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// pure — personal_sign is spec'd [data, address], but some dapps send
// [address, data]. Pick the data: if the first arg is an address and the second
// is present and is NOT an address, the data is the second arg.
const pickPersonalSignMessage = (params) => {
  if (!Array.isArray(params) || params.length === 0) throw new Error('personal_sign: missing message');
  const [a, b] = params;
  if (ADDRESS_RE.test(String(a)) && b !== undefined && !ADDRESS_RE.test(String(b))) return b;
  return a;
};

// pure — ethers.signTypedData wants {domain, types, value} WITHOUT the
// EIP712Domain entry in types (it derives that itself). Parse the wire payload
// (a JSON string or an object) into that shape.
const parseTypedData = (params) => {
  if (!Array.isArray(params) || params.length < 2) throw new Error('signTypedData: expected [address, payload]');
  const raw = params[1];
  const td = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!td || typeof td !== 'object' || !td.types || !td.domain) throw new Error('signTypedData: malformed payload');
  const types = {};
  for (const k of Object.keys(td.types)) {
    if (k !== 'EIP712Domain') types[k] = td.types[k];
  }
  return { domain: td.domain, types, value: td.message };
};

// Read-only JSON-RPC methods the embedded provider forwards straight to the RPC
// node — no key, no confirmation needed.
const READ_METHODS = Object.freeze(
  new Set([
    'eth_call',
    'eth_getBalance',
    'eth_estimateGas',
    'eth_gasPrice',
    'eth_getTransactionReceipt',
    'eth_getTransactionByHash',
    'eth_getTransactionCount',
    'eth_blockNumber',
    'eth_getBlockByNumber',
    'eth_getCode',
    'eth_getLogs',
  ])
);

const isReadMethod = (method) => READ_METHODS.has(method);

// pure — normalize a chain id (number or 0x string) to a 0x-prefixed hex string
const toChainIdHex = (chainId) => {
  const n = typeof chainId === 'string' && chainId.startsWith('0x') ? parseInt(chainId, 16) : Number(chainId);
  if (!Number.isFinite(n) || n <= 0) throw new Error('invalid chainId');
  return '0x' + n.toString(16);
};

module.exports = { pickPersonalSignMessage, parseTypedData, isReadMethod, READ_METHODS, toChainIdHex };
