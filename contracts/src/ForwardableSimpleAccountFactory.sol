// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IEntryPoint} from "../lib/account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {SimpleAccount} from "../lib/account-abstraction/contracts/accounts/SimpleAccount.sol";
import {ForwardableSimpleAccount} from "./ForwardableSimpleAccount.sol";

/**
 * Factory for ForwardableSimpleAccount.
 *
 * Same pattern as eth-infinitism SimpleAccountFactory but:
 * - Deploys ForwardableSimpleAccount (with ERC2771Context) as implementation
 * - No senderCreator restriction (we call createAccount directly, not via UserOps)
 * - createAccount is permissionless and idempotent
 */
contract ForwardableSimpleAccountFactory {
    ForwardableSimpleAccount public immutable accountImplementation;

    constructor(IEntryPoint _entryPoint, address _trustedForwarder) {
        accountImplementation = new ForwardableSimpleAccount(_entryPoint, _trustedForwarder);
    }

    /**
     * Create an account, and return its address.
     * Returns the address even if the account is already deployed (idempotent).
     */
    function createAccount(
        address owner,
        uint256 salt
    ) public returns (ForwardableSimpleAccount ret) {
        address addr = getAddress(owner, salt);
        uint256 codeSize = addr.code.length;
        if (codeSize > 0) {
            return ForwardableSimpleAccount(payable(addr));
        }
        ret = ForwardableSimpleAccount(
            payable(
                new ERC1967Proxy{salt: bytes32(salt)}(
                    address(accountImplementation),
                    abi.encodeCall(SimpleAccount.initialize, (owner))
                )
            )
        );
    }

    /**
     * Calculate the counterfactual address of this account as it would be
     * returned by createAccount().
     */
    function getAddress(
        address owner,
        uint256 salt
    ) public view returns (address) {
        return
            Create2.computeAddress(
                bytes32(salt),
                keccak256(
                    abi.encodePacked(
                        type(ERC1967Proxy).creationCode,
                        abi.encode(
                            address(accountImplementation),
                            abi.encodeCall(
                                SimpleAccount.initialize,
                                (owner)
                            )
                        )
                    )
                )
            );
    }
}
