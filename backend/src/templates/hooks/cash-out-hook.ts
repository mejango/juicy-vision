/**
 * Cash Out Hook Template
 *
 * Cash out hooks are called after someone cashes out (redeems) their project tokens.
 * The ruleset's data hook decides which cash out hooks run and how much is
 * forwarded to each; the cash out hook then executes custom post-cash-out logic.
 *
 * Common use cases:
 * - Post-cash-out accounting and cooldown tracking
 * - Bonus distribution on cash out
 * - Routing reclaimed funds forwarded by the data hook
 * - Analytics/event emission
 */

export const CASH_OUT_HOOK_TEMPLATE = {
  name: 'Cash Out Hook',
  description: 'Custom logic for when someone cashes out project tokens',
  files: [
    {
      path: 'src/MyCashOutHook.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IJBCashOutHook} from "@bananapus/core-v6/src/interfaces/IJBCashOutHook.sol";
import {JBAfterCashOutRecordedContext} from "@bananapus/core-v6/src/structs/JBAfterCashOutRecordedContext.sol";
import {IJBDirectory} from "@bananapus/core-v6/src/interfaces/IJBDirectory.sol";
import {IJBTerminal} from "@bananapus/core-v6/src/interfaces/IJBTerminal.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title MyCashOutHook
/// @notice A custom cash out hook for Juicebox V6 projects.
/// @dev Implement your custom post-cash-out logic in afterCashOutRecordedWith. To validate or
/// reshape cash outs BEFORE they're recorded (e.g. time locks, vesting), implement a data hook
/// (IJBRulesetDataHook.beforeCashOutRecordedWith) and set it as the ruleset's dataHook with
/// useDataHookForCashOut enabled.
contract MyCashOutHook is IJBCashOutHook {
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

    /// @notice The last time each holder cashed out (example state).
    mapping(address holder => uint256 timestamp) public lastCashOutOf;

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
    // CASH OUT HOOK IMPLEMENTATION
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Called by the terminal after a cash out has been recorded.
    /// @dev Use this for post-cash-out actions like updating state or emitting events.
    /// @param context The context passed in by the terminal, including holder, counts, and amounts.
    function afterCashOutRecordedWith(JBAfterCashOutRecordedContext calldata context) external payable {
        // Verify caller is a valid terminal for this project
        if (!DIRECTORY.isTerminalOf(context.projectId, IJBTerminal(msg.sender))) {
            revert UnauthorizedTerminal(msg.sender);
        }

        // Verify this is the correct project
        if (context.projectId != PROJECT_ID) {
            revert WrongProject(PROJECT_ID, context.projectId);
        }

        // ════════════════════════════════════════════════════════════════════
        // TODO: Add your custom post-cash-out logic here
        // ════════════════════════════════════════════════════════════════════
        //
        // Useful context fields:
        // - context.holder: whose tokens were cashed out
        // - context.cashOutCount: how many project tokens were cashed out
        // - context.reclaimedAmount.value: terminal tokens reclaimed from the treasury
        // - context.forwardedAmount.value: funds forwarded to this hook by the data hook
        // - context.cashOutTaxRate: the ruleset's bonding-curve tax rate
        //
        // Examples:
        // - Update state: lastCashOutOf[context.holder] = block.timestamp;
        // - Emit event: emit TokensCashedOut(context.holder, context.cashOutCount);
        // - Transfer bonus: bonusToken.transfer(context.holder, bonus);
        //
        lastCashOutOf[context.holder] = block.timestamp;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ERC-165 SUPPORT
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Indicates whether this contract supports a given interface.
    /// @param interfaceId The interface ID to check.
    /// @return True if the interface is supported.
    function supportsInterface(bytes4 interfaceId) public pure returns (bool) {
        return interfaceId == type(IJBCashOutHook).interfaceId ||
               interfaceId == type(IERC165).interfaceId;
    }
}
`,
    },
    {
      path: 'test/MyCashOutHook.t.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MyCashOutHook} from "../src/MyCashOutHook.sol";
import {IJBDirectory} from "@bananapus/core-v6/src/interfaces/IJBDirectory.sol";
import {IJBCashOutHook} from "@bananapus/core-v6/src/interfaces/IJBCashOutHook.sol";

contract MyCashOutHookTest is Test {
    MyCashOutHook hook;
    address mockDirectory = address(0x1);
    uint256 projectId = 1;

    function setUp() public {
        hook = new MyCashOutHook(IJBDirectory(mockDirectory), projectId);
    }

    function test_ProjectIdIsSet() public view {
        assertEq(hook.PROJECT_ID(), projectId);
    }

    function test_DirectoryIsSet() public view {
        assertEq(address(hook.DIRECTORY()), mockDirectory);
    }

    function test_SupportsCashOutHookInterface() public view {
        assertTrue(hook.supportsInterface(type(IJBCashOutHook).interfaceId));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TODO: Add your custom tests here
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Examples:
    // function test_RejectsUnauthorizedTerminal() public { ... }
    // function test_RecordsLastCashOutTimestamp() public { ... }
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
