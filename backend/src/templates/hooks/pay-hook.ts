/**
 * Pay Hook Template
 *
 * Pay hooks are called when someone pays a Juicebox project.
 * They can execute custom logic before or after the payment is recorded.
 *
 * Common use cases:
 * - Payment caps (limit per-payment or total amounts)
 * - Allowlists (only allow specific addresses to pay)
 * - NFT minting on payment
 * - Custom token distribution
 * - Payment routing to external contracts
 */

export const PAY_HOOK_TEMPLATE = {
  name: 'Pay Hook',
  description: 'Custom logic for when someone pays a Juicebox project',
  files: [
    {
      path: 'src/MyPayHook.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IJBPayHook} from "@jb/interfaces/IJBPayHook.sol";
import {JBPayHookPayload} from "@jb/structs/JBPayHookPayload.sol";
import {IJBDirectory} from "@jb/interfaces/IJBDirectory.sol";
import {IJBTerminal} from "@jb/interfaces/IJBTerminal.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title MyPayHook
/// @notice A custom pay hook for Juicebox V5 projects.
/// @dev Implement your custom payment logic in beforePayRecordedWith and/or afterPayRecordedWith.
contract MyPayHook is IJBPayHook {
    // ═══════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Thrown when the caller is not an authorized terminal.
    error UnauthorizedTerminal(address terminal);

    /// @notice Thrown when the project ID doesn't match.
    error WrongProject(uint256 expected, uint256 actual);

    // ═══════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice The Juicebox directory for terminal verification.
    IJBDirectory public immutable DIRECTORY;

    /// @notice The project ID this hook is associated with.
    uint256 public immutable PROJECT_ID;

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    /// @param directory The Juicebox directory contract.
    /// @param projectId The project ID this hook serves.
    constructor(IJBDirectory directory, uint256 projectId) {
        DIRECTORY = directory;
        PROJECT_ID = projectId;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PAY HOOK IMPLEMENTATION
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Called before a payment is recorded.
    /// @dev Use this to validate payments or revert if conditions aren't met.
    /// @param payload The payment payload containing amount, payer, memo, etc.
    function beforePayRecordedWith(JBPayHookPayload calldata payload) external view {
        // Verify caller is a valid terminal for this project
        if (!DIRECTORY.isTerminalOf(payload.projectId, IJBTerminal(msg.sender))) {
            revert UnauthorizedTerminal(msg.sender);
        }

        // Verify this is the correct project
        if (payload.projectId != PROJECT_ID) {
            revert WrongProject(PROJECT_ID, payload.projectId);
        }

        // ════════════════════════════════════════════════════════════════════
        // TODO: Add your custom pre-payment validation logic here
        // ════════════════════════════════════════════════════════════════════
        //
        // Examples:
        // - Check payment amount: require(payload.amount.value <= MAX_PAYMENT, "Too large");
        // - Check payer allowlist: require(allowlist[payload.payer], "Not allowed");
        // - Check time window: require(block.timestamp >= startTime, "Too early");
        //
    }

    /// @notice Called after a payment is recorded.
    /// @dev Use this for post-payment actions like minting NFTs or logging.
    /// @param payload The payment payload containing amount, payer, memo, etc.
    function afterPayRecordedWith(JBPayHookPayload calldata payload) external {
        // Verify caller is a valid terminal
        if (!DIRECTORY.isTerminalOf(payload.projectId, IJBTerminal(msg.sender))) {
            revert UnauthorizedTerminal(msg.sender);
        }

        // ════════════════════════════════════════════════════════════════════
        // TODO: Add your custom post-payment logic here
        // ════════════════════════════════════════════════════════════════════
        //
        // Examples:
        // - Mint an NFT: nft.mint(payload.payer, tokenId);
        // - Emit an event: emit PaymentReceived(payload.payer, payload.amount.value);
        // - Update state: totalPayments += payload.amount.value;
        //
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ERC-165 SUPPORT
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Indicates whether this contract supports a given interface.
    /// @param interfaceId The interface ID to check.
    /// @return True if the interface is supported.
    function supportsInterface(bytes4 interfaceId) public pure returns (bool) {
        return interfaceId == type(IJBPayHook).interfaceId ||
               interfaceId == type(IERC165).interfaceId;
    }
}
`,
    },
    {
      path: 'test/MyPayHook.t.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MyPayHook} from "../src/MyPayHook.sol";
import {IJBDirectory} from "@jb/interfaces/IJBDirectory.sol";
import {IJBPayHook} from "@jb/interfaces/IJBPayHook.sol";
import {JBPayHookPayload} from "@jb/structs/JBPayHookPayload.sol";
import {JBTokenAmount} from "@jb/structs/JBTokenAmount.sol";

contract MyPayHookTest is Test {
    MyPayHook hook;
    address mockDirectory = address(0x1);
    uint256 projectId = 1;

    function setUp() public {
        hook = new MyPayHook(IJBDirectory(mockDirectory), projectId);
    }

    function test_ProjectIdIsSet() public view {
        assertEq(hook.PROJECT_ID(), projectId);
    }

    function test_DirectoryIsSet() public view {
        assertEq(address(hook.DIRECTORY()), mockDirectory);
    }

    function test_SupportsPayHookInterface() public view {
        assertTrue(hook.supportsInterface(type(IJBPayHook).interfaceId));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TODO: Add your custom tests here
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Examples:
    // function test_RejectsOverMaxPayment() public { ... }
    // function test_AllowsAllowlistedPayer() public { ... }
    // function test_MintsNFTOnPayment() public { ... }
    //
}
`,
    },
    {
      path: 'foundry.toml',
      content: `[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.28"

optimizer = true
optimizer_runs = 200

# Remappings
remappings = [
  "@jb/=lib/juice-contracts-v5/src/",
  "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
  "forge-std/=lib/forge-std/src/"
]

[fuzz]
runs = 256

[invariant]
runs = 256
`,
    },
  ],
};
