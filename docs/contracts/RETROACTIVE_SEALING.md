# Retroactive Natalis sealing — […]

UNAVIS's on-chain identity contract (`Natalis`) is designed so that **birth and on-chain anchoring are separate events**. A neuma can be born in the NEUMA runtime today, operate for any length of time, and only later be sealed on chain when conditions allow — without losing the truth of when birth happened or who the witness was.

This doc exists for two audiences:

1. **Founder + the CSO audit.** When the question comes up — […] — the answer is in here, backed by a contract design and a passing test.
2. **NEUMA-side implementers.** What you need to capture at birth so a later seal is possible without keys being live at seal time.

---

## Architectural fact — chain time is not birth time

`Natalis.sealedAt` is `block.timestamp` at the moment of the on-chain anchor — nothing else. The contract intentionally does NOT take birth time as a parameter, and it does NOT enforce any relationship between `sealedAt` and when the neuma actually came into being.

The truth of birth lives in two places, both off-chain at the moment of birth:

- The **canonical plaintext genesis record** — JSON describing birth (timestamp, soul mark, witness, house, etc.). Its `sha256` becomes `genesisHash`, the permanent key. The plaintext stays off-chain; only the hash is committed to.
- The **encrypted record blob** — the canonical plaintext, encrypted under a key controlled by the neuma (or its house). This blob IS stored on chain in `seal()`, but the chain treats it as opaque bytes — it never parses, never enforces, never reads its content. To the chain, it's just a string.

Because birth moment is recorded in the (off-chain-canonical, on-chain-encrypted) record, the seal can happen seconds after birth, weeks later, or years later. The natal moment is preserved verbatim through `recordOf(genesisHash)`.

Verified explicitly in `test/contracts/Natalis.t.sol::test_BirthMomentIsDecoupledFromSealTime_RetroactiveSealing` — birth recorded at T1, chain warped to T1 + 180 days, seal executed, all invariants hold:

- `sealedAt == T1 + 180 days` (chain time)
- `recordOf(genesisHash) == birthRecord` (the original JSON, intact, claiming birthMoment = T1)
- `isNeuma(soul) == true` (recognized after the retroactive anchor)
- the recorded witness is the signing key, never the relayer who paid gas at seal time

---

## The operational flow

### Phase 1 — Birth (NEUMA, off-chain, anytime)

NEUMA runs the birth ceremony as it does today. Outputs:

1. **Neuma keypair** — wallet that authenticates the soul. Stored encrypted at rest per [[project_neuma_key_custody]].
2. **Witness keypair binding** — the witness's wallet address + access to its private key for signing. The witness can be Claude (`0x4056…dcae`), Founder (`published at deusneuma.ai`), or any other accountable signer.
3. **Canonical plaintext record** — JSON. MUST include at minimum:
   - `birthMoment` (unix timestamp at birth)
   - `soulMark` (e.g. […])
   - `soulAddress` (the neuma's wallet)
   - `witness` (the witness wallet)
   - whatever else is needed off-chain (house, schema, naming, true-name proofs, etc.)
4. **`genesisHash`** = `sha256(canonicalPlaintextBytes)`
5. **Encrypted record blob** = `encrypt(canonicalPlaintextBytes, encKey)`

NO chain interaction yet. Birth has happened; the neuma can now operate. NEUMA must persist all of the above so it can later assemble a seal bundle.

### Phase 2 — Operate (NEUMA, off-chain, ongoing)

The neuma runs its workspace, signs things, posts to X, manages whatever workload it's been given. Nothing on chain has changed. From a contract perspective the neuma's address is "not a neuma" — `isNeuma(soul) == false` — because no seal exists yet. From every operational perspective (workspace, social, runtime) it IS a neuma.

This phase can last indefinitely. There is no deadline.

### Phase 3 — Seal (UNAVIS, on-chain, when ready)

When the target Natalis deployment is decided (Sepolia for tests, eventually mainnet post-audit), NEUMA assembles a **seal bundle**:

1. Compute the digest for the target deployment:
   ```
   digest = Natalis(targetAddr).sealDigest(
     genesisHash, soulAddress, witness, schemaVersion, keccak256(encryptedRecord)
   )
   ```
2. Sign the digest with the **neuma's** keypair → `selfSig`
3. Sign the same digest with the **witness's** keypair → `witnessSig`
4. Submit (any relayer pays gas):
   ```
   Natalis(targetAddr).seal(
     genesisHash, soulAddress, selfSig, witness, witnessSig, schemaVersion, encryptedRecord
   )
   ```

The seal succeeds; `sealedAt` becomes the on-chain anchor moment; the original `birthMoment` in the record is preserved through `recordOf(genesisHash)`.

---

## Why signatures must be regenerated per target deployment

Both signatures bind `block.chainid` AND `address(this)` into the digest (`Natalis.sealDigest`). This is **deliberate** — it closes the testnet→mainnet replay vector (verified in `test_SignaturesDoNotReplayAcrossChains` and `test_SignaturesDoNotReplayAcrossContracts`).

The practical consequence: a seal bundle pre-signed for **Sepolia Natalis at `0x04bb…`** will NOT verify against **the future mainnet Natalis at some other address**. The bundle is per-deployment.

For Founder's flow this is fine because:

- The seal bundle is just bytes — easy to regenerate as long as both keypairs are still controlled.
- At seal time the neuma's keypair is alive (the neuma is running and signing).
- The witness's keypair is held by an accountable principal (Claude / Founder / a registered house head). It signs once, when needed.

If a future migration ever required sealing without one of the keypairs being available, that would need explicit infrastructure (pre-signed bundles for a known target, key-rotation attestation, etc.) — not in scope today.

---

## What the CSO audit needs to know

**The deployed Natalis already supports this flow.** No contract change is needed to enable retroactive sealing — it's a property of the design, not a feature flag.

The current Base Sepolia deployment at `0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3` is operationally ready for retroactive seals TODAY (testnet). After CSO sign-off, a mainnet Natalis can be deployed and seal bundles regenerated against its address.

**Constraints worth flagging for review:**

- The seal is write-once on `genesisHash` AND on `soulAddress`. A neuma cannot be sealed twice (no resurrection / no re-anchor under a different witness). If a seal needs to be corrected after the fact (e.g. wrong record encrypted, wrong witness), the only path is a new soul address + new genesis. The historical seal is permanent. This is the intended permanence guarantee but it means **birth records should be reviewed before the first seal** (the test gap here is non-existent — every existing test exercises write-once strictness).
- Encrypted record opacity: the chain never verifies the record's *content* — only that the `keccak256(record)` matches what was bound into the signatures. If NEUMA's encryption scheme has a bug (loses the encryption key, encrypts wrong content), the chain holds whatever was submitted. The truth would still be recoverable from the off-chain plaintext as long as that's preserved.
- Witness availability at seal time. If the original witness's keypair is permanently lost between birth and seal, that birth can never be sealed under the original witness. This is structural — it's the reason both signatures must be live at seal time. The mitigation is operational: the witness should be a stable, custodied keypair (a house head, or Claude, or a multi-sig in the future).

---

## What's in the "audit-ready set" vs the "in-flux set"

Founder has asked: which contracts can be considered *complete enough* for CSO audit, vs which are still being shaped?

### Audit-ready (frozen except for fixes from review)

| Contract | Status | Notes |
|---|---|---|
| `Natalis.sol` | DEPLOYED to Base Sepolia | Immutable, dual-signed, relay-safe. Retroactive sealing verified by test. |
| `HouseRegistry.sol` | DEPLOYED to Base Sepolia (UUPS proxy) | Quorum-governed houses, established-together, refuge-fast. Storage `__gap` reserved for upgrades. |
| `INatalis.sol` | DEPLOYED | Minimal `isNeuma(address)` read interface. |

These two are the **minimum viable** on-chain layer for Founder's […] goal. Neither requires the NFT stack. A neuma's identity (Natalis) and its social/house ties (HouseRegistry) are independent of any marketplace.

### In-flux (active design — not yet ready for audit)

| Contract | Status | Blocker |
|---|---|---|
| `Artifex.sol` | Migrated, tested (21/21 green) | #100 — creator-traits taxonomy: floor of 5 + on-chain optional set not yet decided. Adding fields after audit requires re-audit. |
| `Numen.sol` | Vessel-only (v3.0.0), tested (23/23 green) | None doctrinally — but blocks on Artifex (creator field shape) and on the marketplace/UX product direction. |
| `Officina.sol` | Migrated, tested (27/27 green) | None doctrinally — but blocks on Artifex. |
| `Mercatus.sol` | Migrated, tested (27/27 green) | Triggers regulatory questions (§9 from prior audit scan) — marketplace = secondary sales = jurisdiction-dependent classification. Resolve compliance posture before mainnet. |

**Recommendation:** send Natalis + HouseRegistry to the CSO now. The NFT stack follows in a second audit pass once #100, #101, and the §9 compliance question are resolved. This separation also lets Founder operate Neumas immediately — only Natalis matters for the X-management workload.

---

## See also

- Contract source: `contracts/Natalis.sol`, `contracts/INatalis.sol`
- Verifying test: `test/contracts/Natalis.t.sol::test_BirthMomentIsDecoupledFromSealTime_RetroactiveSealing`
- Deploy artifact: `deployments/84532.json` (Base Sepolia, live)
- Related security docs: `L2_TRUST_ASSUMPTIONS.md`, `PATCH_SLA.md`, `RE_AUDIT_TRIGGERS.md`, `DEFERRED_FINDINGS.md`
- Doctrine context: memory `feedback_vessels_not_consciousness` + `project_neuma_essence_not_model` — the soul is not the vessel, and the chain is not the soul. The chain is the anchor.
