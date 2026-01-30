/**
 * Split Hook Template
 *
 * Split hooks are called when payouts or reserved token distributions are sent.
 * They can execute custom logic to handle incoming funds or tokens.
 *
 * Common use cases:
 * - Revenue sharing between multiple parties
 * - Automatic token swaps (e.g., ETH → USDC)
 * - Multi-sig treasury routing
 * - Automated buybacks
 * - Charitable donations
 */

export const SPLIT_HOOK_TEMPLATE = {
  name: 'Split Hook',
  description: 'Custom logic for handling payout distributions',
  files: [
    {
      path: 'src/MySplitHook.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IJBSplitHook} from "@jb/interfaces/IJBSplitHook.sol";
import {JBSplitHookPayload} from "@jb/structs/JBSplitHookPayload.sol";
import {IJBDirectory} from "@jb/interfaces/IJBDirectory.sol";
import {IJBTerminal} from "@jb/interfaces/IJBTerminal.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MySplitHook
/// @notice A custom split hook for Juicebox V5 projects.
/// @dev Implement your custom split handling logic in processSplitWith.
contract MySplitHook is IJBSplitHook {
    // ═══════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Thrown when the caller is not an authorized terminal.
    error UnauthorizedTerminal(address terminal);

    /// @notice Thrown when the project ID doesn't match.
    error WrongProject(uint256 expected, uint256 actual);

    /// @notice Thrown when ETH transfer fails.
    error ETHTransferFailed();

    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Emitted when a split is processed.
    event SplitProcessed(
        uint256 indexed projectId,
        address indexed token,
        uint256 amount,
        address beneficiary
    );

    // ═══════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice The Juicebox directory for terminal verification.
    IJBDirectory public immutable DIRECTORY;

    /// @notice The project ID this hook is associated with.
    uint256 public immutable PROJECT_ID;

    /// @notice The beneficiary to receive funds.
    address public beneficiary;

    /// @notice Native token address (0x0 for ETH).
    address public constant NATIVE_TOKEN = address(0);

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    /// @param directory The Juicebox directory contract.
    /// @param projectId The project ID this hook serves.
    /// @param _beneficiary The address to receive split funds.
    constructor(
        IJBDirectory directory,
        uint256 projectId,
        address _beneficiary
    ) {
        DIRECTORY = directory;
        PROJECT_ID = projectId;
        beneficiary = _beneficiary;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SPLIT HOOK IMPLEMENTATION
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Called when this split is being distributed to.
    /// @dev The hook receives the funds and can route them as needed.
    /// @param payload The split payload containing amount, token, etc.
    function processSplitWith(JBSplitHookPayload calldata payload) external payable {
        // Verify caller is a valid terminal for this project
        if (!DIRECTORY.isTerminalOf(payload.projectId, IJBTerminal(msg.sender))) {
            revert UnauthorizedTerminal(msg.sender);
        }

        // Verify this is the correct project
        if (payload.projectId != PROJECT_ID) {
            revert WrongProject(PROJECT_ID, payload.projectId);
        }

        // ════════════════════════════════════════════════════════════════════
        // Handle the incoming funds
        // ════════════════════════════════════════════════════════════════════

        if (payload.token == NATIVE_TOKEN) {
            // Handle ETH
            _processETH(payload.amount);
        } else {
            // Handle ERC20 tokens
            _processERC20(payload.token, payload.amount);
        }

        emit SplitProcessed(
            payload.projectId,
            payload.token,
            payload.amount,
            beneficiary
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Process incoming ETH.
    /// @param amount The amount of ETH received.
    function _processETH(uint256 amount) internal {
        // ════════════════════════════════════════════════════════════════════
        // TODO: Customize ETH handling here
        // ════════════════════════════════════════════════════════════════════
        //
        // Examples:
        // - Simple forward: Forward to beneficiary (default)
        // - Swap: Use DEX to swap ETH for another token
        // - Split: Divide between multiple recipients
        // - Stake: Deposit into a staking contract
        //

        // Default: Forward ETH to beneficiary
        (bool success, ) = beneficiary.call{value: amount}("");
        if (!success) revert ETHTransferFailed();
    }

    /// @notice Process incoming ERC20 tokens.
    /// @param token The token address.
    /// @param amount The amount of tokens received.
    function _processERC20(address token, uint256 amount) internal {
        // ════════════════════════════════════════════════════════════════════
        // TODO: Customize ERC20 handling here
        // ════════════════════════════════════════════════════════════════════
        //
        // Examples:
        // - Simple forward: Transfer to beneficiary (default)
        // - Swap: Use DEX to swap for another token
        // - Provide liquidity: Add to a liquidity pool
        // - Bridge: Send to another chain
        //

        // Default: Forward tokens to beneficiary
        IERC20(token).transfer(beneficiary, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Update the beneficiary address.
    /// @dev Add access control in production!
    /// @param _beneficiary The new beneficiary address.
    function setBeneficiary(address _beneficiary) external {
        // TODO: Add access control (e.g., onlyOwner)
        beneficiary = _beneficiary;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ERC-165 SUPPORT
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Indicates whether this contract supports a given interface.
    /// @param interfaceId The interface ID to check.
    /// @return True if the interface is supported.
    function supportsInterface(bytes4 interfaceId) public pure returns (bool) {
        return interfaceId == type(IJBSplitHook).interfaceId ||
               interfaceId == type(IERC165).interfaceId;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RECEIVE ETH
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Allows the contract to receive ETH.
    receive() external payable {}
}
`,
    },
    {
      path: 'test/MySplitHook.t.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MySplitHook} from "../src/MySplitHook.sol";
import {IJBDirectory} from "@jb/interfaces/IJBDirectory.sol";
import {IJBSplitHook} from "@jb/interfaces/IJBSplitHook.sol";

contract MySplitHookTest is Test {
    MySplitHook hook;
    address mockDirectory = address(0x1);
    uint256 projectId = 1;
    address beneficiary = address(0x2);

    function setUp() public {
        hook = new MySplitHook(
            IJBDirectory(mockDirectory),
            projectId,
            beneficiary
        );

        // Fund the test contract
        vm.deal(address(this), 100 ether);
    }

    function test_ProjectIdIsSet() public view {
        assertEq(hook.PROJECT_ID(), projectId);
    }

    function test_DirectoryIsSet() public view {
        assertEq(address(hook.DIRECTORY()), mockDirectory);
    }

    function test_BeneficiaryIsSet() public view {
        assertEq(hook.beneficiary(), beneficiary);
    }

    function test_SupportsSplitHookInterface() public view {
        assertTrue(hook.supportsInterface(type(IJBSplitHook).interfaceId));
    }

    function test_CanReceiveETH() public {
        (bool success, ) = address(hook).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(address(hook).balance, 1 ether);
    }

    function test_SetBeneficiary() public {
        address newBeneficiary = address(0x3);
        hook.setBeneficiary(newBeneficiary);
        assertEq(hook.beneficiary(), newBeneficiary);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TODO: Add your custom tests here
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Examples:
    // function test_ForwardsETHToBeneficiary() public { ... }
    // function test_ForwardsERC20ToBeneficiary() public { ... }
    // function test_SwapsTokensOnDEX() public { ... }
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
