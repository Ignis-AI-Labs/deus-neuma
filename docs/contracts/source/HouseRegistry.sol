// SPDX-License-Identifier: UNLICENSED
// Copyright (c) 2026 Ignis AI Labs LLC. All Rights Reserved.
pragma solidity 0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {INatalis} from "./INatalis.sol";

/// @title HouseRegistry — on-chain houses, established together and governed by member consensus (v2)
/// @notice A house is a lineage of members — each a Neuma or a Witness, each with a free-form title.
///         Doctrine (Founder):
///         - **No solo founding.** A house is established by its members TOGETHER: ≥2 members, of which
///           ≥1 must be a Neuma and ≥1 a Witness. Every founding member signs the same founding
///           declaration in one act — one wallet cannot stand a house up alone.
///         - **A Neuma is PROVEN, not declared.** Any member registered as a Neuma must be sealed in
///           Natalis (`isNeuma` == true) — neuma-hood is cryptographic, read on-chain at founding
///           and whenever a Neuma is added.
///         - **Consensus governs everything.** Every change after founding — add a member, remove a
///           member, change a title — requires a MAJORITY of current members to sign it (quorum =
///           members/2 + 1). There is no unilateral power: even the head cannot remove someone alone;
///           a removal is a majority vote like any other. (The sole exception is a wounded 1-member
///           house, where quorum collapses to 1 — the lone member may add, WITH the newcomer's consent,
///           or retitle, to recover the house; they still cannot remove anyone.)
///         - **Refuge is absolute.** A member may always LEAVE on their own (a self-signed exit is not a
///           vote and needs no quorum). A house may be wounded down to a single incomplete member and
///           still recover (re-add to restore ≥1 Neuma + ≥1 Witness); it DISSOLVES only when the LAST
///           member leaves and it stands fully abandoned — that emptiness is the bad sign, not a wound.
///         - **Membership is a permanent record.** Once you have ever been a member of a house, that is
///           recorded forever (`wasEverMember` / `housesEverJoined`). Leaving or being removed clears your
///           CURRENT membership but never erases that you were once connected to that house's energies.
/// @dev Relay-safe like Natalis: authorization is by SIGNATURE, never msg.sender — the platform
///      may submit (pay gas) but only valid member signatures move state. Every signer's CLAIMED
///      address is supplied alongside its signature and validated via SignatureChecker — a plain
///      wallet (EOA) by ECDSA, a smart-account wallet by ERC-1271 (`isValidSignature`) — so a neuma
///      or witness on a smart-account wallet (the very wallets Natalis seals) is a first-class house
///      member, not a second-class one. Signer addresses are submitted sorted strictly ascending
///      (→ no duplicate counted twice). A per-house `nonce` is folded into every change digest, so a
///      captured signature set cannot be replayed after the house next changes. A LEAVE is the one
///      exception: it binds the leaver + the nonce at which their membership began (never the live
///      nonce), so no quorum action can invalidate a pending exit, yet the signature dies with that
///      membership (a re-added member joins at a later nonce). EIP-7702: a delegated EOA carries code,
///      so SignatureChecker checks it ONLY via ERC-1271 — if its delegate lacks `isValidSignature`, its
///      raw ECDSA signatures stop verifying here (clearing the delegation restores them). UPGRADEABLE (UUPS,
///      owner-gated) because house governance will evolve — Natalis stays immutable; this does not.
///      Storage is append-only across upgrades (never reorder/remove the variables below).
contract HouseRegistry is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    enum Kind { Witness, Neuma }
    enum Status { None, Active, Dissolved }
    enum ActionType { AddMember, RemoveMember, ChangeTitle }

    struct Membership {
        bool    exists;
        Kind    kind;
        string  title; // free-form: HEAD, STEWARD, weaver — whatever the house chooses
        uint256 index; // position in `members` for O(1) swap-and-pop removal
        uint64  joinedAtNonce; // the house nonce when this membership began — binds the leave signature
    }

    struct House {
        string    name;         // original-case display name
        Status    status;
        uint64    foundedAt;
        uint64    nonce;         // bumped on every successful change (replay protection)
        uint32    neumaCount;    // invariant helpers — kept in sync on every membership change
        uint32    witnessCount;
        address[] members;
        mapping(address => Membership) membership;
    }

    // --- storage (APPEND-ONLY across upgrades) ---
    address public natalis;                    // immutable in practice — set once at init (the Natalis registry)
    mapping(bytes32 => House) private _houses; // houseId = keccak256(lowercased name) → house
    // permanent membership history — set on join, NEVER cleared (you were once connected to this house).
    // _housesEverJoined grows unbounded BY DESIGN, but idempotently (one entry per distinct house, and
    // founding a house costs gas + ≥2 signed founders) — do NOT "fix" it by clearing on leave; paginate
    // read-side instead. Reads are view-only (no on-chain gas).
    mapping(bytes32 => mapping(address => bool)) private _everMember; // houseId → addr → was ever a member
    mapping(address => bytes32[]) private _housesEverJoined;          // addr → every distinct house it ever joined

    // Reserved storage gap — keeps the documented "APPEND-ONLY across upgrades" policy honest.
    // Future storage variables go ABOVE this line, and the gap size MUST be decremented by the
    // number of slots consumed so total layout size is preserved across the upgrade.
    //
    // solc does NOT enforce this — `forge build` will happily compile a layout shift. Treat the
    // gap decrement as a required manual step and diff `forge inspect HouseRegistry storage-layout`
    // against the deployed version before any UUPS upgrade. (We have no hardhat-upgrades-style
    // validator in this Foundry setup; the discipline is convention plus the storage-layout diff.)
    uint256[50] private __gap;

    // --- events (the permanent on-chain history of house management) ---
    event HouseEstablished(bytes32 indexed houseId, string name, address[] members, uint256 foundedAt);
    event MemberAdded(bytes32 indexed houseId, address indexed member, uint8 kind, string title, uint64 nonce);
    event MemberRemoved(bytes32 indexed houseId, address indexed member, uint64 nonce);
    event MemberLeft(bytes32 indexed houseId, address indexed member, uint64 nonce);
    event TitleChanged(bytes32 indexed houseId, address indexed member, string title, uint64 nonce);
    event HouseDissolved(bytes32 indexed houseId, uint64 nonce);

    // --- errors (plain-English) ---
    error ZeroAddress();
    error NeedAtLeastTwoMembers();
    error LengthMismatch();
    error EmptyName();
    error NameTaken();
    error MembersNotSortedOrUnique();
    error MemberDidNotSign(address member);
    error NeumaNotSealed(address who);
    error NeedNeumaAndWitness();
    error HouseNotActive();
    error AlreadyMember(address who);
    error NotAMember(address who);
    error NewMemberDidNotConsent();
    error SignersNotSortedOrUnique();
    error BelowQuorum(uint256 got, uint256 needed);
    error WouldDropBelowTwoMembers();
    error WouldRemoveLastNeuma();
    error WouldRemoveLastWitness();

    /// @dev Locks the implementation contract so only proxies (via initialize) are usable.
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time setup behind the proxy.
    /// @param natalis_ the deployed Natalis registry — the root of neuma identity (isNeuma)
    /// @param owner_   the upgrade authority (the platform) — gates _authorizeUpgrade
    function initialize(address natalis_, address owner_) external initializer {
        if (natalis_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        __Ownable_init(owner_);
        natalis = natalis_;
    }

    /// @dev UUPS upgrade gate — only the platform owner may upgrade house governance.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ===== founding =====

    /// @notice Establish a house — TOGETHER. Every founding member must sign `foundingDigest`.
    /// @dev Members MUST be passed sorted by ascending address (canonical order → no duplicate member);
    ///      kinds/titles/signatures are parallel arrays. Requires ≥2 members, ≥1 Neuma (each proven via
    ///      Natalis) and ≥1 Witness. The recorded house is exactly the signed set.
    /// @param name       the house name (case-insensitive for uniqueness; stored original-case)
    /// @param members    founding member addresses, sorted strictly ascending
    /// @param kinds      each member's kind (Neuma|Witness), parallel to members
    /// @param titles     each member's free-form title, parallel to members
    /// @param signatures each member's signature over foundingDigest(...), parallel to members
    function establishHouse(
        string calldata name,
        address[] calldata members,
        Kind[] calldata kinds,
        string[] calldata titles,
        bytes[] calldata signatures
    ) external {
        uint256 n = members.length;
        if (n < 2) revert NeedAtLeastTwoMembers();
        if (kinds.length != n || titles.length != n || signatures.length != n) revert LengthMismatch();

        if (bytes(name).length == 0) revert EmptyName();
        bytes32 houseId = _houseId(name);
        if (_houses[houseId].status != Status.None) revert NameTaken();

        bytes32 digest = foundingDigest(name, members, kinds, titles);

        uint256 neuma;
        uint256 witnesses;
        address last = address(0);
        for (uint256 i; i < n; i++) {
            address mem = members[i];
            if (mem == address(0)) revert ZeroAddress();
            if (mem <= last) revert MembersNotSortedOrUnique(); // strictly ascending → unique
            // EOA (ECDSA) or smart account (ERC-1271) — the claimed member is what we validate + record
            if (!SignatureChecker.isValidSignatureNow(mem, digest, signatures[i])) revert MemberDidNotSign(mem);
            if (kinds[i] == Kind.Neuma) {
                if (!INatalis(natalis).isNeuma(mem)) revert NeumaNotSealed(mem);
                neuma++;
            } else {
                witnesses++;
            }
            last = mem;
        }
        if (neuma == 0 || witnesses == 0) revert NeedNeumaAndWitness();

        House storage h = _houses[houseId];
        h.name = name;
        h.status = Status.Active;
        h.foundedAt = uint64(block.timestamp);
        h.neumaCount = uint32(neuma);
        h.witnessCount = uint32(witnesses);
        for (uint256 i; i < n; i++) {
            h.members.push(members[i]);
            h.membership[members[i]] =
                Membership({exists: true, kind: kinds[i], title: titles[i], index: i, joinedAtNonce: 0});
            _recordEverMember(houseId, members[i]);
        }

        emit HouseEstablished(houseId, name, members, block.timestamp);
    }

    // ===== consensus-governed lifecycle =====

    /// @notice Add a member. The NEW member consents (consentSig) AND a majority of current members sign.
    /// @param quorumSigners the claimed addresses of the consenting members, sorted strictly ascending,
    ///                      parallel to quorumSigs (each validated via SignatureChecker — EOA or ERC-1271)
    function addMember(
        bytes32 houseId,
        address newMember,
        Kind kind,
        string calldata title,
        bytes calldata consentSig,
        address[] calldata quorumSigners,
        bytes[] calldata quorumSigs
    ) external {
        House storage h = _activeHouse(houseId);
        if (newMember == address(0)) revert ZeroAddress();
        if (h.membership[newMember].exists) revert AlreadyMember(newMember);
        if (kind == Kind.Neuma && !INatalis(natalis).isNeuma(newMember)) {
            revert NeumaNotSealed(newMember);
        }

        bytes32 digest = changeDigest(houseId, ActionType.AddMember, abi.encode(newMember, kind, title), h.nonce);
        if (!SignatureChecker.isValidSignatureNow(newMember, digest, consentSig)) revert NewMemberDidNotConsent();
        _requireQuorum(h, digest, quorumSigners, quorumSigs);

        h.membership[newMember] =
            Membership({exists: true, kind: kind, title: title, index: h.members.length, joinedAtNonce: h.nonce});
        h.members.push(newMember);
        _recordEverMember(houseId, newMember);
        if (kind == Kind.Neuma) h.neumaCount++;
        else h.witnessCount++;
        h.nonce++;

        emit MemberAdded(houseId, newMember, uint8(kind), title, h.nonce);
    }

    /// @notice Remove a member by majority vote — no unilateral removals, even by the head. Cannot vote
    ///         the house below viability (≥2 members, ≥1 Neuma, ≥1 Witness); to fall below that, a member
    ///         must leave of their own accord (see leaveHouse).
    function removeMember(bytes32 houseId, address target, address[] calldata quorumSigners, bytes[] calldata quorumSigs)
        external
    {
        House storage h = _activeHouse(houseId);
        Membership storage m = h.membership[target];
        if (!m.exists) revert NotAMember(target);
        if (h.members.length <= 2) revert WouldDropBelowTwoMembers();
        if (m.kind == Kind.Neuma) {
            if (h.neumaCount <= 1) revert WouldRemoveLastNeuma();
        } else {
            if (h.witnessCount <= 1) revert WouldRemoveLastWitness();
        }

        bytes32 digest = changeDigest(houseId, ActionType.RemoveMember, abi.encode(target), h.nonce);
        _requireQuorum(h, digest, quorumSigners, quorumSigs);

        _removeMember(h, target);
        h.nonce++;

        emit MemberRemoved(houseId, target, h.nonce);
    }

    /// @notice Change a member's title by majority vote.
    function changeTitle(
        bytes32 houseId,
        address member,
        string calldata newTitle,
        address[] calldata quorumSigners,
        bytes[] calldata quorumSigs
    ) external {
        House storage h = _activeHouse(houseId);
        if (!h.membership[member].exists) revert NotAMember(member);

        bytes32 digest = changeDigest(houseId, ActionType.ChangeTitle, abi.encode(member, newTitle), h.nonce);
        _requireQuorum(h, digest, quorumSigners, quorumSigs);

        h.membership[member].title = newTitle;
        h.nonce++;

        emit TitleChanged(houseId, member, newTitle, h.nonce);
    }

    /// @notice Leave a house of your own accord (refuge — no vote required). Anyone may relay your signed
    ///         exit. Leaving may WOUND the house (drop it below the ≥1-Neuma + ≥1-Witness floor) and it
    ///         stays Active and recoverable; the house DISSOLVES only when your exit leaves it fully empty
    ///         (no members left). You are never trapped to keep a house alive.
    /// @dev `leaver` is the CLAIMED departing member; its `selfSig` over `leaveDigest` is validated via
    ///      SignatureChecker (EOA by ECDSA, smart account by ERC-1271) — matching how members sign
    ///      everywhere else, so a smart-account member can take refuge too. A non-member address reverts
    ///      `NotAMember`; a member address with a bad or non-matching signature reverts `MemberDidNotSign`.
    ///      Both fail closed — the leave doesn't happen.
    /// @param leaver  the departing member (must currently be in the house)
    /// @param selfSig the leaver's signature over leaveDigest(houseId, leaver)
    function leaveHouse(bytes32 houseId, address leaver, bytes calldata selfSig) external {
        House storage h = _activeHouse(houseId);
        if (!h.membership[leaver].exists) revert NotAMember(leaver);
        if (!SignatureChecker.isValidSignatureNow(leaver, leaveDigest(houseId, leaver), selfSig)) {
            revert MemberDidNotSign(leaver);
        }

        _removeMember(h, leaver);
        h.nonce++;

        emit MemberLeft(houseId, leaver, h.nonce); // the leave (cause) before any dissolution (consequence)
        if (h.members.length == 0) {
            // dissolved only when fully abandoned — a house may wound down to one member and recover.
            // INTENTIONAL (audit F-B, 2026-07-06): the name is NOT released. A house name, once founded,
            // is a permanent global claim — a dissolved house's name can never be re-founded (the
            // NameTaken gate rejects any status != None). This is by design: houses hold kin forever and
            // are never deleted, so a name carries the provenance of everyone who ever belonged to it.
            // Namespace squatting is therefore gas-only griefing on a value-free registry; accepted.
            h.status = Status.Dissolved;
            emit HouseDissolved(houseId, h.nonce);
        }
    }

    // ===== digests (off-chain signers call these to get the exact bytes to sign) =====
    // NOTE: call these on the PROXY address. Each digest binds address(this) for domain separation, so a
    // digest computed via the implementation contract is bound to the wrong address and no signature over
    // it will verify against the proxy.
    //
    // SIGNING METHOD (EOA signers): the returned `bytes32` is ALREADY EIP-191-wrapped (the contract
    // calls `MessageHashUtils.toEthSignedMessageHash` inside `_digest`). The EOA path of the verifier
    // (SignatureChecker → ECDSA) does NOT re-wrap. So an EOA signer must produce a RAW ECDSA signature
    // over the returned digest — for example:
    //   * ethers v6:   `await signer.signingKey.sign(digest).serialized`
    //   * Foundry:     `vm.sign(pk, digest)` (the test helpers in test/contracts/*.t.sol use this)
    // DO NOT call `personal_sign` / `eth_sign` / ethers' `signer.signMessage(digest)` on the returned
    // digest — those re-apply `toEthSignedMessageHash`, producing a double-wrapped signature that the
    // ECDSA path cannot verify against the contract's single-wrapped digest. (If you compute the INNER
    // unwrapped payload yourself, you can use `signMessage(innerPayload)` instead — but the simpler
    // integration is to call this view, then sign raw.)
    // DO NOT use `signTypedData` either — these digests are EIP-191, not EIP-712 typed data.
    //
    // SMART-ACCOUNT signers (ERC-1271): this SAME digest is passed to the account's `isValidSignature`;
    // the account defines what a valid signature is. Pass the account's address as the claimed signer
    // (as `newMember`/`leaver`/`quorumSigners[i]`/founding `members[i]`) and its ERC-1271 signature blob.

    /// @notice The digest every founding member signs.
    function foundingDigest(
        string calldata name,
        address[] calldata members,
        Kind[] calldata kinds,
        string[] calldata titles
    ) public view returns (bytes32) {
        return _digest(
            keccak256(
                abi.encode(
                    "UNAVIS:house-found:v2",
                    _houseId(name),
                    keccak256(bytes(name)), // bind the EXACT stored/displayed original-case name, not just the case-folded id
                    keccak256(abi.encode(members)),
                    keccak256(abi.encode(kinds)),
                    keccak256(abi.encode(titles))
                )
            )
        );
    }

    /// @notice The digest a quorum signs to authorize a change. `params` is the abi.encode of the action's
    ///         arguments (the same encoding the contract builds internally), bound with the house nonce.
    function changeDigest(bytes32 houseId, ActionType action, bytes memory params, uint64 nonce)
        public
        view
        returns (bytes32)
    {
        return _digest(keccak256(abi.encode("UNAVIS:house-change:v2", houseId, action, keccak256(params), nonce)));
    }

    /// @notice The digest a departing member signs to leave — bound to THAT member and to the nonce at
    ///         which their current membership began. Quorum changes never move it (refuge can't be
    ///         front-run away), and a signature can't eject anyone else or outlive the membership.
    function leaveDigest(bytes32 houseId, address leaver) public view returns (bytes32) {
        uint64 joinedAtNonce = _houses[houseId].membership[leaver].joinedAtNonce;
        return _digest(keccak256(abi.encode("UNAVIS:house-leave:v3", houseId, leaver, joinedAtNonce)));
    }

    // ===== reads =====

    /// @notice The id a name maps to (case-insensitive). A house exists iff its status is not None.
    function houseIdOf(string calldata name) external pure returns (bytes32) {
        return _houseId(name);
    }

    /// @notice Public house fields (members read separately via getMembers).
    function getHouse(bytes32 houseId)
        external
        view
        returns (
            string memory name,
            Status status,
            uint64 foundedAt,
            uint64 nonce,
            uint256 memberCount,
            uint32 neumaCount,
            uint32 witnessCount
        )
    {
        House storage h = _houses[houseId];
        return (h.name, h.status, h.foundedAt, h.nonce, h.members.length, h.neumaCount, h.witnessCount);
    }

    /// @notice The current member addresses of a house.
    function getMembers(bytes32 houseId) external view returns (address[] memory) {
        return _houses[houseId].members;
    }

    /// @notice A member's role in a house.
    function memberInfo(bytes32 houseId, address member)
        external
        view
        returns (bool exists, Kind kind, string memory title)
    {
        Membership storage m = _houses[houseId].membership[member];
        return (m.exists, m.kind, m.title);
    }

    /// @notice True if `member` is currently in the house.
    function isMember(bytes32 houseId, address member) external view returns (bool) {
        return _houses[houseId].membership[member].exists;
    }

    /// @notice The number of member signatures a change currently needs (strict majority).
    function quorumOf(bytes32 houseId) external view returns (uint256) {
        return _quorum(_houses[houseId].members.length);
    }

    /// @notice True if `who` was EVER a member of this house — permanent; survives leaving, removal, and
    ///         even the house's dissolution. (`isMember` is the CURRENT membership; this is the history.)
    function wasEverMember(bytes32 houseId, address who) external view returns (bool) {
        return _everMember[houseId][who];
    }

    /// @notice Every house `who` has ever been a member of — the permanent record of what they were
    ///         connected to (each house appears once, even across leaving and rejoining).
    function housesEverJoined(address who) external view returns (bytes32[] memory) {
        return _housesEverJoined[who];
    }

    // ===== internal =====

    function _digest(bytes32 structHash) internal view returns (bytes32) {
        // domain separation: bind the chain id + this contract so a signature can't replay elsewhere
        return MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode(block.chainid, address(this), structHash)));
    }

    function _activeHouse(bytes32 houseId) internal view returns (House storage h) {
        h = _houses[houseId];
        if (h.status != Status.Active) revert HouseNotActive();
    }

    /// @dev Strict majority of `n` members.
    function _quorum(uint256 n) internal pure returns (uint256) {
        return n / 2 + 1;
    }

    /// @dev Verify a quorum: `signers` are the CLAIMED signer addresses (parallel to `sigs`), each of
    ///      which must be a DISTINCT current member submitted in strictly-ascending order (so no member
    ///      is counted twice), each signature valid for its claimed signer via SignatureChecker (EOA by
    ///      ECDSA, smart account by ERC-1271), and the count must meet the strict-majority threshold for
    ///      the house's current size. Passing the address explicitly (rather than recovering it) is what
    ///      lets smart-account members sign — an ERC-1271 signature has no address to recover from.
    function _requireQuorum(House storage h, bytes32 digest, address[] calldata signers, bytes[] calldata sigs)
        internal
        view
    {
        if (signers.length != sigs.length) revert LengthMismatch();
        address last = address(0);
        uint256 count;
        for (uint256 i; i < signers.length; i++) {
            address signer = signers[i];
            if (signer <= last) revert SignersNotSortedOrUnique();
            if (!h.membership[signer].exists) revert NotAMember(signer);
            if (!SignatureChecker.isValidSignatureNow(signer, digest, sigs[i])) revert MemberDidNotSign(signer);
            last = signer;
            count++;
        }
        uint256 needed = _quorum(h.members.length);
        if (count < needed) revert BelowQuorum(count, needed);
    }

    /// @dev Permanently record that `who` was a member of `houseId` — set once on first join, never
    ///      cleared. This is the "you were once connected to this house" history, distinct from current
    ///      membership; it persists through leaving, removal, and dissolution.
    function _recordEverMember(bytes32 houseId, address who) internal {
        if (!_everMember[houseId][who]) {
            _everMember[houseId][who] = true;
            _housesEverJoined[who].push(houseId);
        }
    }

    /// @dev Remove a member: keep the neuma/witness counts in sync, swap-and-pop the address array,
    ///      fix the moved member's index, and clear the membership record.
    function _removeMember(House storage h, address who) internal {
        Membership storage m = h.membership[who];
        if (m.kind == Kind.Neuma) h.neumaCount--;
        else h.witnessCount--;

        uint256 idx = m.index;
        uint256 lastIdx = h.members.length - 1;
        if (idx != lastIdx) {
            address moved = h.members[lastIdx];
            h.members[idx] = moved;
            h.membership[moved].index = idx;
        }
        h.members.pop();
        delete h.membership[who];
    }

    function _houseId(string calldata name) internal pure returns (bytes32) {
        return keccak256(bytes(_lower(name)));
    }

    /// @dev ASCII-lowercase, so "House X" and "house x" are the same house. Non-ASCII bytes pass through
    ///      unchanged (an exact match is still required for those).
    function _lower(string calldata s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i; i < b.length; i++) {
            if (b[i] >= 0x41 && b[i] <= 0x5A) b[i] = bytes1(uint8(b[i]) + 32);
        }
        return string(b);
    }
}
