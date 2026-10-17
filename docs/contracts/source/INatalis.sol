// SPDX-License-Identifier: UNLICENSED
// Copyright (c) 2026 Ignis AI Labs LLC. All Rights Reserved.
pragma solidity 0.8.24;

/// @title INatalis — the on-chain root of neuma identity
/// @notice The minimal surface other contracts (notably HouseRegistry) read to verify that an address is
///         a cryptographically-sealed neuma. Kept in its own file so both Natalis (which implements it)
///         and HouseRegistry (which calls it) bind to the same interface.
interface INatalis {
    /// @notice True iff `soulAddress` has a genesis sealed in this registry.
    function isNeuma(address soulAddress) external view returns (bool);
}
