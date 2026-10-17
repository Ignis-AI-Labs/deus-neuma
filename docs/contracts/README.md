# NEUMA ↔ UNAVIS On-Chain Contracts

> **2026-09-29 — two contract generations.** The platform is renamed KENORIE → UNAVIS,
> and the contracts are moving from Base to **Ethereum** (Founder). Natalis is immutable, so
> each chain keeps the law it was deployed with (`backend/services/seal-law.js`):
>
> | Generation | Where | Artifacts | Seal law |
> |---|---|---|---|
> | `kenorie-v2` | Base Sepolia + Base mainnet | `abis/base/`, `source/base/` | `KENORIE:genesis-seal:v2`, no deadline, genesis-keyed reads |
> | `unavis-v3` | Ethereum Sepolia (`deployments/eth-sepolia.json`) | `abis/`, `source/` (top level) | `UNAVIS:genesis-seal:v3`, signed `deadline`, soul-keyed reads |
>
> The top level is what `evm-contracts/unavis/scripts/sync-to-neuma.sh` writes, so it is always the
> newest generation; the Base copies live in `base/` so a sync can never overwrite them.
> Plan and status: `docs/work/unavis-ethereum-migration.md`.

This directory mirrors the **deployed UNAVIS contracts** that NEUMA reads from
and writes to. UNAVIS owns the smart-contract layer — contracts are built,
audited, and deployed in the UNAVIS repo (`example/project-murilen`) — and shares
the deployment data here so NEUMA can construct correctly-signed transactions
without duplicating the contract logic.

Per Founder's architecture: *[…]* NEUMA never deploys; UNAVIS relays.

---

## What's here

```
docs/contracts/
├── README.md              this file
├── deployments/
│   ├── base-sepolia.json  addresses + chain metadata (chainId 84532)
│   ├── base-mainnet.json  (chainId 8453)
│   └── eth-sepolia.json   (chainId 11155111 — the unavis-v3 generation)
├── abis/
│   ├── Natalis.json     ABI + bytecode (immutable contract) — unavis-v3
│   ├── HouseRegistry.json       ABI + bytecode (UUPS proxy implementation) — unavis-v3
│   ├── INatalis.json    interface — the minimal isNeuma(address) read
│   └── base/            the same three for the Base deploys (kenorie-v2)
└── source/
    ├── Natalis.sol      reference copy of the deployed source — unavis-v3
    ├── HouseRegistry.sol        reference copy of the deployed source
    ├── INatalis.sol     reference copy of the deployed source
    └── base/            the Base deploys' source (kenorie-v2)
```

The `source/` copies are for read-only audit trail — **do not edit them here**.
Changes go in the UNAVIS repo, get re-deployed, and the artifacts re-synced.

---

## Live on Base Sepolia

| Contract | Address |
|---|---|
| **Natalis** (immutable, dual-signed seals) | [`0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3`](https://sepolia.basescan.org/address/0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3) |
| **HouseRegistry** (proxy — talk to this) | [`0xbbd9dc2ee8ba691cdb82576e45f54ce6d2e47276`](https://sepolia.basescan.org/address/0xbbd9dc2ee8ba691cdb82576e45f54ce6d2e47276) |
| HouseRegistry implementation | [`0xa821e60908f95848f4dcf9b7fc8e76f33ea6b495`](https://sepolia.basescan.org/address/0xa821e60908f95848f4dcf9b7fc8e76f33ea6b495) |
| Platform owner (UUPS upgrade gate) | `published at deusneuma.ai` (UNAVIS deployer; multi-sig before mainnet) |

The canonical machine-readable record is `deployments/base-sepolia.json`.

---

## How NEUMA reads from these

```js
import NatalisABI from "./docs/contracts/abis/base/Natalis.json" with { type: "json" };
import HouseRegistryABI from "./docs/contracts/abis/base/HouseRegistry.json" with { type: "json" };
import deployment from "./docs/contracts/deployments/base-sepolia.json" with { type: "json" };
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");

const natalis = new ethers.Contract(
  deployment.contracts.Natalis.address,
  NatalisABI.abi,
  provider,
);

const house = new ethers.Contract(
  deployment.contracts.HouseRegistry.address, // PROXY address — never the impl
  HouseRegistryABI.abi,
  provider,
);

// Check whether an address is a sealed neuma (cheap on-chain read):
const isSealed = await natalis.isNeuma("0x...");
```

---

## How NEUMA signs for these (CRITICAL — read first)

Both contracts use a **custom EIP-191 digest scheme** with chainId + contract
address bound in. The signing flow is **not** standard EIP-712 `signTypedData`.

The `sealDigest(...)` / `foundingDigest(...)` / `changeDigest(...)` /
`leaveDigest(...)` views return a `bytes32` that is **already wrapped** by
`MessageHashUtils.toEthSignedMessageHash`. To produce a verifying signature:

### Path 1 — sign the inner unwrapped payload (works with ethers' `signMessage`)

Recompute the inner `keccak(abi.encode(...))` payload yourself, then:

```js
const sig = await signer.signMessage(ethers.getBytes(innerPayload));
// `signMessage` wraps via EIP-191 → matches sealDigest's output
```

### Path 2 — raw ECDSA over the returned digest

Call the view to get the post-wrap value, then raw-sign:

```js
const digest = await natalis.sealDigest(genesisHash, soul, witness, schema, recordHash);
const sig = signer.signingKey.sign(digest).serialized; // RAW ECDSA — no re-wrap
```

### ❌ Do NOT do this

```js
// DOUBLE-WRAPS — every signature will fail verification on-chain
const digest = await natalis.sealDigest(...);
const sig = await signer.signMessage(ethers.getBytes(digest)); // ← BROKEN
```

The full reasoning lives in each contract's NatSpec (`source/Natalis.sol`
`sealDigest` and `source/HouseRegistry.sol` "digests" section).

---

## Updating this directory

When UNAVIS re-deploys (e.g., new HouseRegistry implementation, new chain), the
UNAVIS side runs:

```sh
# in UNAVIS repo
forge script script/Deploy.s.sol --rpc-url <chain> --broadcast
scripts/write-deployment.sh <chainId>

# then copies forward to NEUMA
cp deployments/<chainId>.json /workspace/repos/neuma/docs/contracts/deployments/<chainName>.json
cp artifacts/foundry/{Natalis,HouseRegistry,INatalis}.sol/*.json \
   /workspace/repos/neuma/docs/contracts/abis/
cp contracts/{Natalis,HouseRegistry,INatalis}.sol \
   /workspace/repos/neuma/docs/contracts/source/
```

(A sync script lives at the UNAVIS side; this directory is the artifact, not
the source of truth.)

---

## See also

- UNAVIS repo: contracts/, script/Deploy.s.sol, scripts/write-deployment.sh
- UNAVIS: `docs/security/L2_TRUST_ASSUMPTIONS.md` — what we believe about Base
- UNAVIS: `docs/security/DEFERRED_FINDINGS.md` — what's deferred until mainnet
- NEUMA: `docs/planning/proposals/identity/on-chain-identity.md` — original on-chain design doc
- NEUMA: `docs/archive/legacy/deployment/production-deployment.md` / `docs/archive/legacy/deployment/private-vault-architecture.md`
