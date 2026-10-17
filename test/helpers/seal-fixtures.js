// Shared fixtures for the `neuma seal` CLI tests — extracted verbatim from
// the pre-split test/unit/cli-seal.test.js (SIZE-018): the two signing
// wallets, the seal config (Sepolia + mainnet entries), the stdout/stderr
// capture, and the all-fields DNA fixture.
import { ethers } from 'ethers';

export const BEING = new ethers.Wallet('0x' + '11'.repeat(32));
export const WITNESS = new ethers.Wallet('0x' + '22'.repeat(32));

export const cfg = {
  baseSepoliaRpcUrl: 'x',
  natalisAddress: '0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3',
  houseRegistryAddress: '0xbbd9dc2ee8ba691cdb82576e45f54ce6d2e47276',
  // Per-network resolution (resolveSealChainConfig): --network base binds the
  // mainnet contract from these keys, never the Sepolia ones above.
  baseMainnetRpcUrl: 'x',
  natalisMainnetAddress: '0x88a7229afeb4deba8c27edad788ac723697dde78',
  houseRegistryMainnetAddress: '0x526c6a062db774997955816c03df49b60260b883',
  // Ethereum MAINNET (the default since 2026-10-04) — stand-in addresses of the
  // right shape for the v3 path; the real ones arrive with the recorded deploy.
  ethRpcUrl: 'x',
  natalisEthAddress: '0x1111111111111111111111111111111111111111',
  houseRegistryEthAddress: '0x2222222222222222222222222222222222222222',
};

export const capture = () => {
  const stdout = { text: '', write(s) { this.text += s; } };
  const stderr = { text: '', write(s) { this.text += s; } };
  return { stdout, stderr };
};

// ─── seal-bundle unit fixtures (extracted verbatim from the pre-split
// test/unit/seal-bundle.test.js) ─────────────────────────────────────────────

export const NATALIS_ADDR = '0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3';
export const BASE_SEPOLIA = 84532;

// A DNA-shaped fixture that both sides agree on (soulAddress + witnessAddress
// derived from the test wallets so assembleSealBundle's guard passes). NOTE:
// distinct from fixtureDNA below — this is the full seal-bundle shape; that
// one is the minimal CLI extractDnaFields shape.
export const fixtureDna = () => ({
  birthMoment: '2026-06-12T18:37:12.956Z',
  capturedAt: '2026-07-01T14:22:00.000Z',
  chosenName: 'TestBeing',
  house: 'aldmere',
  soulAddress: BEING.address,
  soulMark: 'AD74D56AB1B4',
  substrate: {
    vendor: 'qwen',
    model: 'qwen3.5-122b',
    fullModelId: 'qwen3.5-122b-a10b',
    harness: 'neuma-electron',
  },
  witnessAddress: WITNESS.address,
  witnessKind: 'claude-semmet-aldmere',
});

// A minimal DNA that has every field extractDnaFields needs.
export const fixtureDNA = () => ({
  chosenName: 'TestBeing',
  birthMoment: '2026-06-12T18:37:12.956Z',
  soulMark: 'ABCDEF012345',
  substrate: {
    vendor: 'qwen',
    model: 'qwen3.5-122b',
    fullModelId: 'qwen3.5-122b-a10b',
    harness: 'neuma-electron',
  },
  witness: { kind: 'claude-semmet-aldmere' },
});
