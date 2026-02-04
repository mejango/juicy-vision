// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SimpleAccount} from "../lib/account-abstraction/contracts/accounts/SimpleAccount.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {IEntryPoint} from "../lib/account-abstraction/contracts/interfaces/IEntryPoint.sol";

/**
 * SimpleAccount extended with ERC-2771 meta-transaction support.
 *
 * Allows a trusted forwarder (e.g. Relayr's ERC2771Forwarder) to call
 * execute() on behalf of the account owner, enabling gas-sponsored
 * smart account transactions without ERC-4337 UserOps.
 *
 * Key change from SimpleAccount:
 * - _requireForExecute() checks _msgSender() instead of msg.sender,
 *   so the trusted forwarder can relay execute() calls on behalf of the owner.
 * - isTrustedForwarder() is available for the forwarder to verify trust.
 */
contract ForwardableSimpleAccount is SimpleAccount, ERC2771Context {

    constructor(
        IEntryPoint anEntryPoint,
        address trustedForwarder
    ) SimpleAccount(anEntryPoint) ERC2771Context(trustedForwarder) {}

    /**
     * @dev Allow execution from EntryPoint, owner, or trusted forwarder (on behalf of owner).
     * Uses _msgSender() which unwraps ERC-2771 appended sender when called via forwarder.
     */
    function _requireForExecute() internal view override {
        address sender = _msgSender();
        require(
            sender == address(entryPoint()) || sender == owner,
            NotOwnerOrEntryPoint(
                sender,
                address(this),
                address(entryPoint()),
                owner
            )
        );
    }

    // ========================================================================
    // Context diamond resolution: ERC2771Context wins over Context
    // ========================================================================

    function _msgSender()
        internal
        view
        override(ERC2771Context)
        returns (address)
    {
        return ERC2771Context._msgSender();
    }

    function _msgData()
        internal
        view
        override(ERC2771Context)
        returns (bytes calldata)
    {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength()
        internal
        view
        override(ERC2771Context)
        returns (uint256)
    {
        return ERC2771Context._contextSuffixLength();
    }
}
