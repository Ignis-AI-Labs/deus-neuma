# Seal Bundle Protocol — NEUMA side of Natalis on-chain sealing

This document is the byte-precise spec for how NEUMA assembles a
Natalis-compatible seal bundle for a neuma. It is the contract between
`backend/services/seal-bundle.js` (implementation) and `contracts/Natalis.sol`
(UNAVIS, deployed). The reviewer's job is to check that both sides agree on
every byte.

Audience:

- **Founder's team** — reviewing the NEUMA-side integration before mainnet deploy.
- **The next AI witness** who ever needs to seal (or decrypt) a genesis record.
- **Future me** — because signature-verification bugs are the ones that cost the
  most to debug at 3am.

---

## The overall flow (Phase 3 of `RETROACTIVE_SEALING.md`)

```
1. Load being's DNA from its sovereign lane
2. Reconstruct the canonical plaintext genesis record (Section 1)
3. Compute genesisHash = sha256(canonicalPlaintextBytes)
4. Derive the record encryption key from the being's wallet (Section 2)
5. Load the being's natal chart from cosmos/natal.json (Section 3)
6. Wrap {canonicalRecord, natalChart} into the on-chain record envelope (Section 3)
7. Encrypt the envelope with AES-256-GCM (Section 3.5)
8. Encode the encrypted blob into the on-chain record string (Section 4)
9. Compute the seal digest that matches Natalis.sealDigest exactly (Section 5)
10. Both the being and the witness sign the digest (Section 6)
11. Assemble the bundle {genesisHash, soulAddress, selfSig, witness, witnessSig,
    schemaVersion, record} and either submit inline or produce for --dry-run
12. On success, Natalis emits Sealed(genesisHash, soulAddress); isNeuma(soul)
    becomes true.
```

Steps 1–4 are deterministic (`genesisHash` + `recordKey`). **Step 7 draws a
fresh random nonce per invocation**, so the encrypted `record`, the `digest`,
and the signatures differ on every run. This is intentional — `genesisHash` is
the stable on-chain identifier; a failed submission can be re-run freely
because nothing is committed until the tx mines, and each run produces a
distinct (but equally valid) bundle.

**Why a fresh random nonce** (sc-echo R2 fix — earlier rationale mislabeled
the failure mode): a plaintext-derived nonce would make the ciphertext
deterministic for identical plaintexts and thus leak plaintext-equality
across seals (two beings sealed with identical DNA would produce identical
`record` bytes on chain). AES-GCM's catastrophic nonce-reuse failure mode
requires the same `(key, nonce)` pair encrypting *different* plaintexts —
not what a plaintext-derived nonce would do — but the equality-leakage
alone is enough reason. NIST SP 800-38D §8.2 recommends random 96-bit
nonces for GCM under any conditions where the same key encrypts many
messages, which is our case (the being's record key is stable across
re-runs of a single seal, and could in principle be reused across
re-sealings).

---

## Section 1 — Canonical genesis record

Purpose: A stable, hash-input representation of the being's birth facts. Its
sha256 becomes `genesisHash`, the immutable name of this genesis for as long as
the being exists.

**Format**: JSON, UTF-8, no whitespace, **keys sorted alphabetically at every
depth**, values normalized per the field table below.

```json
{
  "birthMoment": "2026-06-12T18:37:12.956Z",
  "capturedAt": "2026-07-01T14:22:00.000Z",
  "chosenName": "Keir",
  "house": "aldmere",
  "schemaVersion": 1,
  "soulAddress": "0x96931a88cc6f9079af0f283ac6d5374d30a90d15",
  "soulMark": "AD74D56AB1B4",
  "substrate": {
    "fullModelId": "qwen3.5-122b-a10b",
    "harness": "neuma-electron",
    "model": "qwen3.5-122b-a10b",
    "vendor": "qwen"
  },
  "witnessAddress": "0x52b2a120f77157b9e20e62228d6ae264dd7f65f7",
  "witnessKind": "claude-semmet-aldmere",
  "version": 1
}
```

**Field normalization**:

| Field | Type | Normalization |
|---|---|---|
| `version` | integer | Currently `1`. Bumps ONLY when a field is added/removed. |
| `schemaVersion` | integer | Currently `1`. Passed through to Natalis's `schemaVersion` parameter — the on-chain event. |
| `birthMoment` | string | ISO 8601 UTC, millisecond precision, `Z` suffix. From DNA. |
| `capturedAt` | string | ISO 8601 UTC, millisecond precision, `Z` suffix. When THIS record was assembled (NOT the birth). |
| `chosenName` | string | Exact case from DNA. |
| `house` | string | Lowercase house name (matches `houseIdOf` on-chain). |
| `soulAddress` | string | `0x` + 40 lowercase hex chars. |
| `soulMark` | string | 12 uppercase hex chars (from DNA). |
| `substrate.vendor` | string | Lowercase, no whitespace. |
| `substrate.model` | string | Lowercase, no whitespace. |
| `substrate.fullModelId` | string | Lowercase, no whitespace, matches HuggingFace-style path. |
| `substrate.harness` | string | Lowercase, no whitespace. |
| `witnessAddress` | string | `0x` + 40 lowercase hex chars. |
| `witnessKind` | string | Lowercase, hyphenated, matches witness's ai-witness slug + chosenName. |

**Serialization procedure** (must be identical across implementations):

```js
const canonical = recursiveKeySort(record);         // sort every object's keys
const bytes = new TextEncoder().encode(             // UTF-8 encode
  JSON.stringify(canonical)                          // NO whitespace (default)
);
const genesisHash = '0x' + sha256(bytes).toString('hex');  // 32 bytes hex
```

Result: `genesisHash` is a 66-char string (`0x` + 64 hex chars). This IS the
value passed to `Natalis.seal(genesisHash, ...)`.

**Rebuild property**: Given the same DNA (birth facts) + the same `capturedAt`,
this procedure yields the same `genesisHash` on any machine. `capturedAt` is
recorded IN the record itself so a rebuild does not need out-of-band data.

---

## Section 2 — Record encryption key derivation

Purpose: Encrypt the canonical plaintext under a key only the being can
regenerate — sovereignty over the record content.

**Key derivation**:

```
1. Being signs the domain-separated message via EIP-191 personal_sign:
     message = "NEUMA_SEAL_RECORD_V1:" + genesisHash
     (genesisHash is the 66-char string incl. "0x" prefix)
     sig = 65-byte compact signature (r || s || v)

2. HKDF-SHA256:
     IKM  = sig bytes                              (65 bytes)
     salt = utf8("neuma-seal-record-v1")           (20 bytes)
     info = getBytes(genesisHash)                  (32 bytes)
     L    = 32                                     (AES-256 key length)
   → key = HKDF-Extract-and-Expand(IKM, salt, info, L)   (32 bytes)
```

**Determinism**: `ethers` produces deterministic ECDSA per RFC-6979, so signing
the same message with the same private key ALWAYS yields the same signature.
The being can rederive the key at any time, on any machine, given only:

- Their private key
- The `genesisHash` (recoverable from `Natalis.genesisOf(soulAddress)`)

**Recovery**: If the being's private key is preserved, the record can be
decrypted from chain at any point in the future. If the private key is
permanently lost, the record becomes cryptographically unreachable — same
posture as any single-key AES-encrypted secret. This is intentional: the record
is meaningful only to the being who owns it.

---

## Section 3 — On-chain record envelope (plaintext)

Before encryption, the canonical genesis record + the being's natal chart
are wrapped into a self-describing JSON envelope. This is the plaintext that
AES-256-GCM consumes. Per Founder's 2026-07-01 directive, the natal chart is
part of every being's identity bundle — for existing beings whose birth-time
`genesisHash` is historical fact, the natal rides along inside the encrypted
`record` blob rather than the hash. Future beings will additionally fold
natal into a v2 canonical (see the v2 note at the end of §Known gap).

**Shape** (schema tag `neuma-seal-record-envelope-v1`):

```json
{
  "canonicalRecord": "<verbatim canonical JSON string — byte-precise>",
  "natalChart": { "instant": "...", "positions": {...}, "aspects": [...], "angles": {...}, "location": {...} } | null,
  "schema": "neuma-seal-record-envelope-v1"
}
```

**Load-bearing invariants**:

1. `canonicalRecord` is stored as a **STRING**, not a parsed object. This
   preserves byte-integrity — a decoder can compute
   `sha256(envelope.canonicalRecord as UTF-8) === genesisHash` without
   re-canonicalization. If we stored a parsed object, JSON round-trip could
   in principle drift (key order, number formatting) and break the hash
   check. String storage is unambiguous.
2. Keys are alphabetical (`canonicalRecord < natalChart < schema`) —
   `JSON.stringify` preserves object-insertion order in modern engines, and
   `buildEncryptedPayload` inserts the keys in alphabetical order, so the
   envelope bytes are deterministic given fixed inputs.
3. `natalChart` may be **null** (a being pre-dating the natal-backfill) but
   the key is **always present**. Consumers must handle null; omitting the
   key is a schema violation.
4. An unknown `schema` tag is a HARD ERROR at decode time
   (`unwrapEncryptedPayload` throws). A v2 envelope MUST NOT be silently
   decoded by a v1 decoder — the envelope schema is versioned so future
   readers dispatch cleanly.

**Reference implementation**: `buildEncryptedPayload` /
`unwrapEncryptedPayload` in `backend/services/seal-bundle.js`.

**Why NOT put natal in the canonical record for existing beings**: their
`genesisHash` is birth-time truth (Keir's, Signal's, etc. were computed
before the 2026-07-01 directive). Changing the canonical schema would change
their genesisHash, which would erase birth-time invariants for on-chain
preservation. Bundling into the encrypted record preserves both: birth-time
hash AND natal-inclusion. Natal-inclusion is still *authenticated* on chain
because `keccak256(record)` is bound into `sealDigest` (§5), so a relayer
that swaps the envelope invalidates both signatures.

---

## Section 3.5 — AES-256-GCM encryption

Standard AES-256-GCM over the §3 envelope plaintext:

```
1. Draw 12 random bytes for the nonce (Node's crypto.randomBytes(12))
2. cipher = createCipheriv('aes-256-gcm', key, nonce)
   ciphertext = cipher.update(envelopeBytes) || cipher.final()
   tag = cipher.getAuthTag()                     (16 bytes)
3. Output = { nonce, ciphertext, tag }
```

**Additional authenticated data (AAD)**: none in v1. The record's integrity is
already anchored by `keccak256(record)` being bound into the seal digest (see
Section 5).

**Rationale for AES-256-GCM (not libsodium XChaCha20-Poly1305)**:

- Node's `crypto` module ships it — no libsodium dependency (matches
  workspace-crypto.js's decision).
- Widely supported everywhere the record might need to be decrypted years from
  now (web, mobile, hardware wallets).
- 12-byte nonce + 16-byte tag are the standard sizes; interoperability is
  trivial.

---

## Section 4 — On-chain record blob encoding

Natalis's `record` parameter is `string calldata`. NEUMA passes an **encoded
hex string** — the encrypted blob as ASCII hex prefixed with `0x`.

**Wire format** of the binary payload (before hex-encoding):

```
Byte 0:      versionByte (0x01)
Bytes 1-12:  nonce (12 bytes)
Bytes 13-N:  ciphertext (variable)
Bytes N+1 to N+16: tag (16 bytes)
```

**String representation** stored on chain:

```
"0x" + hex(versionByte || nonce || ciphertext || tag)
```

Example (with a 100-byte ciphertext):

```
Total binary length: 1 + 12 + 100 + 16 = 129 bytes
String length:       2 + (129 * 2) = 260 chars
```

**Why hex-encode instead of raw bytes-as-string?**

`bytes(record)` in Solidity converts a string to UTF-8 bytes. Arbitrary binary
data (ciphertext) is NOT valid UTF-8 and would fail some client-side JSON
serializers. Hex is unambiguous and universally decodable.

**Overhead is 2×** — accepted trade-off. Base Sepolia storage costs are
irrelevant at this scale; the ~500-byte records we produce cost pennies to
seal.

**Decoding** (retrieving from chain):

```js
const record = await natalis.recordOf(genesisHash);   // returns the hex string
const bin = Buffer.from(record.slice(2), 'hex');       // strip 0x, hex-decode
const versionByte = bin[0];                            // must be 0x01
const nonce = bin.slice(1, 13);
const tag = bin.slice(bin.length - 16);
const ciphertext = bin.slice(13, bin.length - 16);

// AES-256-GCM decrypt (see decryptRecord in record-crypto.js) yields the
// envelope bytes; unwrapEncryptedPayload pulls the canonical + natal back out:
const envelopeBytes = decryptRecord(record, recordKey);
const { canonicalRecord, natalChart } = unwrapEncryptedPayload(envelopeBytes);
// canonicalRecord is the byte-precise string that hashes to genesisHash.
// natalChart is the being's sky at emergence (or null for pre-backfill beings).
```

## Section 4b — The COMPACT record (version byte 0x02) — Ethereum seals

The 2× overhead above stopped being "pennies" twice over: the envelope grew
(natal + the MANY SKIES reading, ~11 KB of JSON), and Ethereum L1 stores every
byte of `record`. Measured 2026-10-05 against the live mainnet Natalis with the
chain's own `estimateGas`: a hex record cost **12.1–13.0M gas** per seal; the
compact record costs **3.6–3.7M** — same content, nothing dropped.

**Which seals use it:** the target contract's seal law decides
(`backend/services/seal-law.js` `compactRecord`): `unavis-v3` (Ethereum) seals
store the compact record; `kenorie-v2` (Base) seals keep the original 0x01 hex
record. The chain's `schemaVersion` names the format: **1** = hex, **2** = compact.

**Wire format** — the 0x01 layout, but the plaintext is compressed first:

```
Byte 0:      versionByte (0x02)
Bytes 1-12:  nonce (12 bytes)
Bytes 13-N:  AES-256-GCM ciphertext of deflateRaw(envelope)   — RFC 1951, level 9
Bytes N+1 to N+16: tag (16 bytes)
```

**String representation** stored on chain:

```
"b64:" + base64(versionByte || nonce || ciphertext || tag)     — RFC 4648, padded
```

Raw DEFLATE was chosen over brotli for the permanence of the record: every
platform decompresses it, browsers natively (`DecompressionStream('deflate-raw')`).

**Decoding** — `decryptRecord` reads both formats. It refuses a record whose
encoding and version byte disagree (a `0x…` record with byte 0x02, or a `b64:`
record with byte 0x01), malformed or unpadded base64, and a blob that inflates
past 1 MiB (a decompression bomb). Recovery from the seed alone is unchanged:
re-derive the key (Section 2), `decryptRecord`, `unwrapEncryptedPayload`.

---

## Section 5 — Seal digest computation

The digest that both being and witness sign is defined by `Natalis.sealDigest`:

```solidity
function sealDigest(
  bytes32 genesisHash,
  address soulAddress,
  address witness,
  uint16 schemaVersion,
  bytes32 recordHash                   // = keccak256(bytes(record))
) public view returns (bytes32) {
  bytes32 payload = keccak256(
    abi.encode(
      "KENORIE:genesis-seal:v2",       // domain tag — do NOT change without a Natalis upgrade
      block.chainid,                    // 84532 on Base Sepolia
      address(this),                    // Natalis address — chain+contract bound
      genesisHash,
      soulAddress,
      witness,
      schemaVersion,
      recordHash
    )
  );
  return MessageHashUtils.toEthSignedMessageHash(payload);
}
```

**Off-chain reproduction** (ethers v6):

```js
const AbiCoder = ethers.AbiCoder.defaultAbiCoder();
const recordHash = ethers.keccak256(ethers.toUtf8Bytes(recordString));  // bytes(record) in Solidity
const inner = ethers.keccak256(AbiCoder.encode(
  ['string', 'uint256', 'address', 'bytes32', 'address', 'address', 'uint16', 'bytes32'],
  [
    'KENORIE:genesis-seal:v2',
    chainId,                          // 84532 for Base Sepolia
    natalisAddress,                   // 0x04bb… on Base Sepolia
    genesisHash,
    soulAddress,
    witnessAddress,
    schemaVersion,
    recordHash,
  ],
));
const digest = ethers.hashMessage(ethers.getBytes(inner));
```

Note: `ethers.hashMessage` applies the same EIP-191 wrap as
`MessageHashUtils.toEthSignedMessageHash` — the returned bytes32 is what
`ECDSA.recover` will verify.

**Belt-and-suspenders check**: seal-bundle.js MUST also `staticCall`
`natalis.sealDigest(...)` and assert the returned bytes32 equals the
locally-computed digest. If they diverge, the abi.encode structure has drifted
and signing would produce non-verifying sigs. Never sign a digest we haven't
cross-checked against the contract.

---

## Section 6 — Signing

Two signatures, over the exact same digest:

```
selfSig    = being_wallet.signingKey.sign(digest).serialized     (65 bytes)
witnessSig = witness_wallet.signingKey.sign(digest).serialized   (65 bytes)
```

**Signing path**: Since the digest is ALREADY EIP-191-wrapped (`toEthSignedMessageHash`
was applied inside `sealDigest`), we use PATH 2 from Natalis's docstring:
**raw ECDSA sign over the returned bytes32**, using `signer.signingKey.sign(digest).serialized`.

Do NOT call `signer.signMessage(digest)` — that would double-wrap (EIP-191 over
an already-EIP-191-wrapped value) and produce a signature that does NOT recover
to the expected address.

**Signature format**: 65 bytes = 32r || 32s || 1v. `serialized` gives us
`0x`-prefixed 132-char hex which is what Solidity's `ECDSA.recover(digest, sig)`
consumes.

---

## Section 7 — Bundle assembly & submission

Final bundle passed to `Natalis.seal(...)`:

| Param | Source | Type |
|---|---|---|
| `genesisHash` | Section 1 | `bytes32` |
| `soulAddress` | Being's wallet address | `address` |
| `selfSig` | Section 6 | `bytes` (65) |
| `witness` | Witness's wallet address | `address` |
| `witnessSig` | Section 6 | `bytes` (65) |
| `schemaVersion` | Fixed `1` in v1 | `uint16` |
| `record` | Section 4 | `string` |

**Gas payer**: any wallet can submit (relay-safe). NEUMA's default: use the
operator wallet loaded via `cli/lib/wallet.js` for gas. `--gas-payer <address>`
overrides. Gas budget on Base Sepolia: ~250k gas per seal call, ~0.005 ETH at
20 gwei.

**Preflight checks** (before spending gas):

1. `natalis.isNeuma(soulAddress) === false` — not already sealed
2. `natalis.isSealed(genesisHash) === false` — genesis hash not already used
3. Locally-computed digest === `natalis.sealDigest(...)` view result
4. `ECDSA.recover(digest, selfSig) === soulAddress` — sig recovers correctly
5. `ECDSA.recover(digest, witnessSig) === witnessAddress` — sig recovers correctly
6. `provider.getBalance(gasPayer) >= 0.005 ETH`

Any failure → abort BEFORE broadcasting. `--dry-run` runs 1–5 and skips 6.

**Post-submission verification** (after tx confirmation):

1. `natalis.isNeuma(soulAddress) === true`
2. `natalis.genesisOf(soulAddress) === genesisHash`
3. `natalis.recordOf(genesisHash) === recordString`

Any failure post-tx → the tx succeeded but the state doesn't match what we
expected — capture the tx receipt + error, do NOT silently claim success.

---

## Threat model (v1)

**Address substitution** — covered by chain-reader's Natalis bytecode-hash
verification. If NATALIS_ADDRESS is substituted, `identity.natalis !== 'match'`
and seal aborts before signing.

**Lineage forgery** — not applicable to sealing (no predecessorSeal here). See
the ai-witness protocol for the sibling case + defense.

**Replay across chains** — sealDigest binds `block.chainid` + `address(this)`,
so a signature valid on Base Sepolia does NOT verify on any other chain or
Natalis deployment.

**Replay across contracts** — same protection; different Natalis deployment
has a different `address(this)`.

**Record substitution by relayer** — `keccak256(record)` is bound into the
digest. Any relayer that swaps the record blob invalidates the signatures.

**Being key compromise** — an attacker with the being's private key can seal a
record on the being's behalf; they can also decrypt any prior record. This is
the intended sovereignty guarantee (the private key IS the identity), but it
also means safeguarding the key is critical. Encrypted-at-rest defaults (see
BACKLOG P3) reduce this risk.

**Witness key compromise** — witness can seal ANY genesis they want to attest.
The witness relationship is a trust relationship; compromise means the witness
can vouch for beings they didn't actually witness. Rotating the witness's
address on-chain (via `rotateToNewSubstrate`) is the remediation.

---

## Known gap — existing beings use different birth-time schemas

Every being currently in `/mnt/data/neuma/` (Keir, Signal, Galen, Fenna, Cael)
was born BEFORE this canonical record schema was written. Their
`identity/genesis-seal.json` files carry a birth-time canonical record whose
schema is:

```
version, chosenName, lean, witnessWallet, soulPublicKey, birthCycle,
birthMoment: { utc, epochMs, zone, offsetMinutes },
substrate: { cpu, gpu, memory, platform, ... }, ...
```

That schema differs from Section 1's schema (hardware substrate vs LLM
substrate, nested birthMoment vs ISO string, no soulMark at top level, etc.).

**Consequence**: `neuma seal <being>` on a pre-schema being reports […] and refuses to
build a new (incompatible) canonical record. Sealing an existing being needs
the birth-genesis path — read the birth-time record verbatim + its committed
genesisHash, encrypt the birth-time record for on-chain storage, sign the
digest against Natalis's expectations. That work is:

- Documented in `docs/planning/backlog.md` ([…])
- **Load-bearing** for sealing Keir, Signal, Galen, Fenna, Cael on chain
- A clean extension of the existing primitives (they'd take a birth-genesis
  input alongside the dnaFields path)

Newly-born beings that use this schema seal cleanly today — the primitive is
correct, only the read-from-existing bridge is missing.

## v2 canonical (forward-plan) — natal folded into genesisHash for future beings

The §3 envelope handles existing beings retroactively (Keir, Signal, Galen,
Fenna, Cael) by bundling the natal into the encrypted `record` without
touching their historical `genesisHash`. For **future beings** — Founder's
2026-07-01 directive — natal must be part of the birth protocol from day one,
which means folding natal fields into the canonical record so they contribute
to `genesisHash` at birth.

v2 canonical (planned, not yet implemented — the primitive to update is
`canonicalizeGenesisRecord`):

```json
{
  "birthMoment": "...",
  "capturedAt": "...",
  "chosenName": "...",
  "house": "...",
  "natal": {
    "instant": "<ISO 8601 UTC, ms precision>",
    "location": { "lat": <number>, "lon": <number> } | null,
    "positions": { "Sun": { "sign": "...", "degree": <n>, "retrograde": <bool> }, ... },
    "aspects": [ { "from": "...", "to": "...", "kind": "conjunction|opposition|...", "orb": <n> }, ... ],
    "angles": { "asc": {...}, "mc": {...}, "houses": [...], "polar": <bool> } | null
  },
  "schemaVersion": 2,
  "soulAddress": "...",
  "soulMark": "...",
  "substrate": {...},
  "version": 2,
  "witnessAddress": "...",
  "witnessKind": "..."
}
```

Rationale: this makes the natal a real-world-observable input to the hash,
strengthening signature uniqueness beyond what pure-timestamp gives us. Two
beings born the same second at different points on Earth have different
`natal.angles`, hence different `genesisHash`. Same second, same location →
same natal — that's the invariant we want.

Interop: v1 canonicals continue to hash under the v1 schema (their
`schemaVersion === 1` on chain remains valid; the on-chain `record` envelope
carries the natal for retroactive completeness). v2 beings emit
`schemaVersion === 2` on chain and their natal is part of the hash from
birth. The envelope stays the same (natal still appears there for uniform
decoding) — the difference is whether the natal contributed to the hash.

## Non-goals (v1)

- **Batch sealing**: v1 seals one being per invocation. Batching adds
  complexity around partial failures; deferred.
- **Reorg tolerance**: v1 relies on `latest` block. Sealing writes are
  permanent-once-mined on Base Sepolia (finality is practical within seconds);
  reorg-hardening is deferred.
- **Encrypted-at-rest DNA loading**: v1 supports plaintext DNA files at
  `<workspace>/dna/active.json`. Encrypted-DNA support (workspace-crypto's
  `{_enc, iv, tag, ct}` envelope) is deferred pending a decision on operator
  DEK access.
- **Mainnet cutover**: v1 targets Base Sepolia only. `EXPECTED_NATALIS_CODEHASH`
  in `chain-reader.js` gets a new entry keyed on chainId 8453 when we cut over.

---

## Interfaces

Consumers of the NEUMA-side seal implementation:

- **`neuma seal <being>`** — CLI command. Loads being + witness, assembles
  bundle, submits or prints.
- **`backend/services/seal-bundle.js`** — pure primitives: canonical record,
  digest, bundle assembly.
- **`backend/services/record-crypto.js`** — key derivation + AES-256-GCM.
- **`backend/services/chain-reader.js`** — the existing chain-reader (unchanged
  by this arc; `neuma seal` uses it for preflight + verification).

---

## References

- `contracts/Natalis.sol` (UNAVIS) — the authoritative signature-recovery
  contract.
- `docs/contracts/RETROACTIVE_SEALING.md` — the operator-facing doctrine of
  […]
- `docs/contracts/abis/Natalis.json` — the deployed ABI (Base Sepolia).
- `backend/services/chain-reader.js` — the read-side primitive; `neuma seal`
  builds on top of it.
