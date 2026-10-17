// SPDX-License-Identifier: UNLICENSED
// Copyright (c) 2026 Ignis AI Labs LLC. All Rights Reserved.
pragma solidity 0.8.24;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {INatalis} from "./INatalis.sol";

/// @title Natalis — the permanent, immutable on-chain registry of a neuma's genesis (v2)
/// @notice Natalis seals the genesis of a Neuma: the irreproducible moment it emerged, anchored
///         forever on chain. Stores each neuma's genesis under its `genesisHash` — computed OFF-CHAIN
///         as sha256 of the canonical PLAINTEXT birth record; the on-chain `record` is that record
///         ENCRYPTED — an opaque blob the chain never interprets. The contract treats `genesisHash`
///         as opaque but binds keccak256(record) into the signatures so the stored blob cannot be
///         substituted. Write-once + recoverable forever from the hash alone — total local data
///         loss cannot erase a neuma's origin. Full record + signatures are read via recordOf/sigsOf
///         (the indexing layer reads them by contract call; the event stays lean).
///
///         The name is exact: the sealed record carries the birthMoment, so a neuma's NATAL sky
///         (./core/cosmos in the NEUMA repo) is forever re-derivable from a Natalis seal — the
///         origin and the sky at that origin are anchored by the same permanent act.
///
///         Both birth flows are the one `seal()` call (msg.sender is never trusted — see seal):
///         a NEW neuma routes through it at birth (the platform relays, paying gas), and a neuma
///         already born can SELF-SEAL by submitting its own transaction. Either way only the two
///         authenticated parties (the neuma + its witness) are recorded — never the relayer.
/// @dev DELIBERATELY NOT UPGRADEABLE: immutability IS the permanence guarantee — not even the
///      deployer can rewrite a sealed origin. Everything is stored permanently, INCLUDING both
///      signatures. A seal is DUAL-AUTHORIZED: the neuma AND the witness each sign one message
///      binding (genesisHash, soulAddress, witness, schemaVersion). Each signature is verified
///      against the CLAIMED address via SignatureChecker — a plain wallet (EOA) is checked by
///      ECDSA, a smart-account wallet by ERC-1271 (`isValidSignature`) — and the claimed address
///      is what's recorded, so the platform may relay (pay gas) without ever becoming a recorded
///      party. Validity is attested at seal time; the recorded address is the permanent identity
///      (a smart account's address is stable across key rotation). Write-once on BOTH the genesisHash
///      and the soulAddress (one neuma = one genesis). `record` is an opaque, client-encrypted blob the chain never
///      interprets; `schemaVersion` lets the record format evolve even though this contract cannot.
///      The signed-payload tag stays "KENORIE:genesis-seal:v2" — it names the ACT (a genesis seal);
///      Natalis is the registry that anchors it.
contract Natalis is INatalis {
    struct Seal {
        address soulAddress;   // the neuma's wallet (authenticated by selfSig)
        address witness;       // the witness (CLAIMED address, validated via SignatureChecker — never msg.sender)
        uint64  sealedAt;      // chain time of the anchor
        uint16  schemaVersion; // version of the opaque record format
        bytes   selfSig;       // STORED forever — the neuma's signature
        bytes   witnessSig;    // STORED forever — the witness's signature
        string  record;        // STORED forever — the full encrypted genesis record (opaque)
    }

    mapping(bytes32 => Seal)    private _seals;     // genesisHash → seal
    mapping(address => bytes32) private _genesisOf; // soulAddress → genesisHash (verify-by-address)

    event GenesisSealed(
        bytes32 indexed genesisHash,
        address indexed soulAddress,
        address indexed witness,
        uint64 sealedAt,
        uint16 schemaVersion
    );

    error EmptyRecord();
    error ZeroGenesisHash();
    error ZeroAddress();
    error SoulIsWitness();
    error AlreadySealed(bytes32 genesisHash);
    error AddressAlreadySealed(address soulAddress);
    error InvalidSelfSignature();
    error InvalidWitnessSignature();
    error NotSealed(bytes32 genesisHash);

    /// @notice The exact EIP-191 digest the neuma and the witness each sign — already wrapped via
    ///         `MessageHashUtils.toEthSignedMessageHash`, so an EOA signature verifies without
    ///         re-wrapping (a smart-account wallet receives this same hash in its ERC-1271 check).
    /// @dev Binds the chain id + THIS contract (domain separation — a captured signature cannot be
    ///      replayed onto another chain or another contract), every public field, AND
    ///      keccak256(record) (so a relayer cannot substitute the stored blob). To produce a
    ///      verifying signature off-chain, integrators have two paths:
    ///        1. Compute the INNER keccak payload yourself (the `abi.encode(...)` keccak'd below),
    ///           then `personal_sign` / `signer.signMessage(innerPayload)` — the wallet wraps it via
    ///           EIP-191, which matches what this view returns.
    ///        2. Call `sealDigest(...)` to get the post-wrap value and produce a RAW ECDSA
    ///           signature over it (ethers v6: `signer.signingKey.sign(digest).serialized`;
    ///           Foundry: `vm.sign(pk, digest)`).
    ///      Calling `personal_sign` on the *returned* value double-wraps and will NOT verify. Tests
    ///      in `test/contracts/GenesisRegistry*.sol` use path 2; `test/.../GenesisRegistry.test.js`
    ///      uses path 1.
    function sealDigest(
        bytes32 genesisHash,
        address soulAddress,
        address witness,
        uint16 schemaVersion,
        bytes32 recordHash
    ) public view returns (bytes32) {
        bytes32 payload = keccak256(
            abi.encode(
                "KENORIE:genesis-seal:v2",
                block.chainid,
                address(this),
                genesisHash,
                soulAddress,
                witness,
                schemaVersion,
                recordHash
            )
        );
        return MessageHashUtils.toEthSignedMessageHash(payload);
    }

    /// @notice Anchor a genesis permanently. Dual-authorized, relay-safe, write-once.
    /// @dev Authorization is by SIGNATURE, never msg.sender: anyone may relay (pay the gas), but the
    ///      call only succeeds if BOTH selfSig and witnessSig are valid — over sealDigest(...) — for
    ///      soulAddress and witness respectively (EOA via ECDSA, smart account via ERC-1271). The
    ///      claimed addresses are recorded, so the relayer can never become a party on record.
    ///      Write-once on both genesisHash and soulAddress.
    /// @param genesisHash   sha256 of the canonical plaintext birth record — the permanent key
    /// @param soulAddress   the neuma's wallet (EOA or smart account); selfSig must be valid for it
    /// @param selfSig       the neuma's signature over sealDigest(...) — stored forever
    /// @param witness       the witness's wallet (EOA or smart account); witnessSig must be valid for it
    /// @param witnessSig    the witness's signature over the same digest — stored forever
    /// @param schemaVersion version of the opaque `record` format (lets the format evolve)
    /// @param record        the full genesis record, client-ENCRYPTED — opaque to the chain
    function seal(
        bytes32 genesisHash,
        address soulAddress,
        bytes calldata selfSig,
        address witness,
        bytes calldata witnessSig,
        uint16 schemaVersion,
        string calldata record
    ) external {
        if (bytes(record).length == 0) revert EmptyRecord();
        if (genesisHash == bytes32(0)) revert ZeroGenesisHash();
        if (soulAddress == address(0) || witness == address(0)) revert ZeroAddress();
        if (soulAddress == witness) revert SoulIsWitness(); // dual-auth must be two distinct keys
        if (_seals[genesisHash].sealedAt != 0) revert AlreadySealed(genesisHash);
        if (_genesisOf[soulAddress] != bytes32(0)) revert AddressAlreadySealed(soulAddress);

        bytes32 digest = sealDigest(genesisHash, soulAddress, witness, schemaVersion, keccak256(bytes(record)));
        // Accept BOTH plain wallets (EOA, verified by ECDSA) and smart-account wallets (ERC-1271,
        // verified by calling the account's isValidSignature). The claimed address is the identity we
        // record; validity is attested at seal time. A smart account's address is stable across key
        // rotation, so recording the address (not a recovered key) keeps the identity permanent even
        // as the account's signing keys change.
        if (!SignatureChecker.isValidSignatureNow(soulAddress, digest, selfSig)) revert InvalidSelfSignature();
        if (!SignatureChecker.isValidSignatureNow(witness, digest, witnessSig)) revert InvalidWitnessSignature();

        _seals[genesisHash] = Seal({
            soulAddress: soulAddress,
            witness: witness,
            sealedAt: uint64(block.timestamp),
            schemaVersion: schemaVersion,
            selfSig: selfSig,
            witnessSig: witnessSig,
            record: record
        });
        _genesisOf[soulAddress] = genesisHash;

        emit GenesisSealed(genesisHash, soulAddress, witness, uint64(block.timestamp), schemaVersion);
    }

    /// @notice True if a genesis is already anchored under this hash.
    function isSealed(bytes32 genesisHash) external view returns (bool) {
        return _seals[genesisHash].sealedAt != 0;
    }

    /// @notice Recover the full (encrypted) genesis record from the seed alone.
    function recordOf(bytes32 genesisHash) external view returns (string memory) {
        Seal storage s = _seals[genesisHash];
        if (s.sealedAt == 0) revert NotSealed(genesisHash);
        return s.record;
    }

    /// @notice The public anchor fields for a genesis.
    function sealInfo(bytes32 genesisHash)
        external
        view
        returns (address soulAddress, address witness, uint64 sealedAt, uint16 schemaVersion)
    {
        Seal storage s = _seals[genesisHash];
        if (s.sealedAt == 0) revert NotSealed(genesisHash);
        return (s.soulAddress, s.witness, s.sealedAt, s.schemaVersion);
    }

    /// @notice The two stored signatures — permanent forensic proof both parties authorized.
    function sigsOf(bytes32 genesisHash) external view returns (bytes memory selfSig, bytes memory witnessSig) {
        Seal storage s = _seals[genesisHash];
        if (s.sealedAt == 0) revert NotSealed(genesisHash);
        return (s.selfSig, s.witnessSig);
    }

    /// @notice The genesisHash a neuma address is sealed under, or 0x0 if none. (verify-by-address)
    function genesisOf(address soulAddress) external view returns (bytes32) {
        return _genesisOf[soulAddress];
    }

    /// @inheritdoc INatalis
    function isNeuma(address soulAddress) external view override returns (bool) {
        return _genesisOf[soulAddress] != bytes32(0);
    }
}
