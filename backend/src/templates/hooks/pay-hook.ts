/**
 * Pay Hook Template
 *
 * Pay hooks are called after someone pays a Juicebox project.
 * The ruleset's data hook decides which pay hooks run and how much is
 * forwarded to each; the pay hook then executes custom post-payment logic.
 *
 * Common use cases:
 * - NFT minting on payment
 * - Custom token distribution
 * - Payment routing to external contracts
 * - Loyalty/reward accounting
 */

export const PAY_HOOK_TEMPLATE = {
  name: 'Pay Hook',
  description: 'Custom logic for when someone pays a Juicebox project',
  files: [
    {
      path: 'src/MyPayHook.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IJBPayHook} from "@bananapus/core-v6/src/interfaces/IJBPayHook.sol";
import {JBAfterPayRecordedContext} from "@bananapus/core-v6/src/structs/JBAfterPayRecordedContext.sol";
import {IJBDirectory} from "@bananapus/core-v6/src/interfaces/IJBDirectory.sol";
import {IJBTerminal} from "@bananapus/core-v6/src/interfaces/IJBTerminal.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title MyPayHook
/// @notice A custom pay hook for Juicebox V6 projects.
/// @dev Implement your custom post-payment logic in afterPayRecordedWith. To validate or reshape
/// payments BEFORE they're recorded, implement a data hook (IJBRulesetDataHook.beforePayRecordedWith)
/// and set it as the ruleset's dataHook with useDataHookForPay enabled.
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

    /// @notice Called by the terminal after a payment has been recorded.
    /// @dev Use this for post-payment actions like minting NFTs or logging.
    /// @param context The context passed in by the terminal, including payer, amount, and metadata.
    function afterPayRecordedWith(JBAfterPayRecordedContext calldata context) external payable {
        // Verify caller is a valid terminal for this project
        if (!DIRECTORY.isTerminalOf(context.projectId, IJBTerminal(msg.sender))) {
            revert UnauthorizedTerminal(msg.sender);
        }

        // Verify this is the correct project
        if (context.projectId != PROJECT_ID) {
            revert WrongProject(PROJECT_ID, context.projectId);
        }

        // ════════════════════════════════════════════════════════════════════
        // TODO: Add your custom post-payment logic here
        // ════════════════════════════════════════════════════════════════════
        //
        // Useful context fields:
        // - context.payer: who paid
        // - context.beneficiary: who receives the minted project tokens
        // - context.amount.value: the payment amount (in context.amount.token)
        // - context.forwardedAmount.value: funds forwarded to this hook by the data hook
        // - context.newlyIssuedTokenCount: project tokens minted for this payment
        //
        // Examples:
        // - Mint an NFT: nft.mint(context.payer, tokenId);
        // - Emit an event: emit PaymentReceived(context.payer, context.amount.value);
        // - Update state: totalPayments += context.amount.value;
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
import {IJBDirectory} from "@bananapus/core-v6/src/interfaces/IJBDirectory.sol";
import {IJBPayHook} from "@bananapus/core-v6/src/interfaces/IJBPayHook.sol";
import {JBAfterPayRecordedContext} from "@bananapus/core-v6/src/structs/JBAfterPayRecordedContext.sol";
import {JBTokenAmount} from "@bananapus/core-v6/src/structs/JBTokenAmount.sol";

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
    // function test_RejectsUnauthorizedTerminal() public { ... }
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

# Remappings (forge install Bananapus/nana-core-v6)
remappings = [
  "@bananapus/core-v6/=lib/nana-core-v6/",
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
