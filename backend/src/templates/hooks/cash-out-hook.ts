/**
 * Cash Out Hook Template
 *
 * Cash out hooks are called when someone redeems their project tokens.
 * They can execute custom logic before or after the redemption is recorded.
 *
 * Common use cases:
 * - Redemption caps (limit amount per redemption)
 * - Time-locked redemptions
 * - Vesting schedules
 * - Redemption fees
 * - Custom redemption curves
 */

export const CASH_OUT_HOOK_TEMPLATE = {
  name: 'Cash Out Hook',
  description: 'Custom logic for when someone redeems project tokens',
  files: [
    {
      path: 'src/MyCashOutHook.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IJBCashOutHook} from "@jb/interfaces/IJBCashOutHook.sol";
import {JBCashOutHookPayload} from "@jb/structs/JBCashOutHookPayload.sol";
import {IJBDirectory} from "@jb/interfaces/IJBDirectory.sol";
import {IJBTerminal} from "@jb/interfaces/IJBTerminal.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title MyCashOutHook
/// @notice A custom cash out hook for Juicebox V5 projects.
/// @dev Implement your custom redemption logic in beforeCashOutRecordedWith and/or afterCashOutRecordedWith.
contract MyCashOutHook is IJBCashOutHook {
    // ═══════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Thrown when the caller is not an authorized terminal.
    error UnauthorizedTerminal(address terminal);

    /// @notice Thrown when the project ID doesn't match.
    error WrongProject(uint256 expected, uint256 actual);

    /// @notice Thrown when redemption is not yet allowed.
    error RedemptionNotYetAllowed(uint256 currentTime, uint256 allowedAfter);

    // ═══════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice The Juicebox directory for terminal verification.
    IJBDirectory public immutable DIRECTORY;

    /// @notice The project ID this hook is associated with.
    uint256 public immutable PROJECT_ID;

    /// @notice Timestamp after which redemptions are allowed (0 = always allowed).
    uint256 public redemptionStartTime;

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    /// @param directory The Juicebox directory contract.
    /// @param projectId The project ID this hook serves.
    /// @param _redemptionStartTime When redemptions become allowed (0 = immediately).
    constructor(
        IJBDirectory directory,
        uint256 projectId,
        uint256 _redemptionStartTime
    ) {
        DIRECTORY = directory;
        PROJECT_ID = projectId;
        redemptionStartTime = _redemptionStartTime;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CASH OUT HOOK IMPLEMENTATION
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Called before a cash out (redemption) is recorded.
    /// @dev Use this to validate redemptions or revert if conditions aren't met.
    /// @param payload The cash out payload containing token count, holder, etc.
    function beforeCashOutRecordedWith(JBCashOutHookPayload calldata payload) external view {
        // Verify caller is a valid terminal for this project
        if (!DIRECTORY.isTerminalOf(payload.projectId, IJBTerminal(msg.sender))) {
            revert UnauthorizedTerminal(msg.sender);
        }

        // Verify this is the correct project
        if (payload.projectId != PROJECT_ID) {
            revert WrongProject(PROJECT_ID, payload.projectId);
        }

        // Check if redemptions are time-locked
        if (redemptionStartTime > 0 && block.timestamp < redemptionStartTime) {
            revert RedemptionNotYetAllowed(block.timestamp, redemptionStartTime);
        }

        // ════════════════════════════════════════════════════════════════════
        // TODO: Add your custom pre-redemption validation logic here
        // ════════════════════════════════════════════════════════════════════
        //
        // Examples:
        // - Check token amount: require(payload.cashOutCount <= MAX_REDEMPTION, "Too many");
        // - Check vesting: require(vestedAmount[payload.holder] >= payload.cashOutCount, "Not vested");
        // - Check cooldown: require(lastRedemption[payload.holder] + cooldown < block.timestamp, "Cooldown");
        //
    }

    /// @notice Called after a cash out (redemption) is recorded.
    /// @dev Use this for post-redemption actions like updating state or emitting events.
    /// @param payload The cash out payload containing token count, holder, etc.
    function afterCashOutRecordedWith(JBCashOutHookPayload calldata payload) external {
        // Verify caller is a valid terminal
        if (!DIRECTORY.isTerminalOf(payload.projectId, IJBTerminal(msg.sender))) {
            revert UnauthorizedTerminal(msg.sender);
        }

        // ════════════════════════════════════════════════════════════════════
        // TODO: Add your custom post-redemption logic here
        // ════════════════════════════════════════════════════════════════════
        //
        // Examples:
        // - Update state: lastRedemption[payload.holder] = block.timestamp;
        // - Emit event: emit TokensRedeemed(payload.holder, payload.cashOutCount);
        // - Transfer bonus: bonusToken.transfer(payload.holder, bonus);
        //
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
import {IJBDirectory} from "@jb/interfaces/IJBDirectory.sol";
import {IJBCashOutHook} from "@jb/interfaces/IJBCashOutHook.sol";

contract MyCashOutHookTest is Test {
    MyCashOutHook hook;
    address mockDirectory = address(0x1);
    uint256 projectId = 1;

    function setUp() public {
        // Deploy with no time lock (0)
        hook = new MyCashOutHook(IJBDirectory(mockDirectory), projectId, 0);
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

    function test_RedemptionStartTimeIsZero() public view {
        assertEq(hook.redemptionStartTime(), 0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Time Lock Tests
    // ═══════════════════════════════════════════════════════════════════════

    function test_DeployWithTimeLock() public {
        uint256 futureTime = block.timestamp + 1 days;
        MyCashOutHook timedHook = new MyCashOutHook(
            IJBDirectory(mockDirectory),
            projectId,
            futureTime
        );

        assertEq(timedHook.redemptionStartTime(), futureTime);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TODO: Add your custom tests here
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Examples:
    // function test_RejectsRedemptionBeforeStartTime() public { ... }
    // function test_AllowsRedemptionAfterStartTime() public { ... }
    // function test_EnforcesVestingSchedule() public { ... }
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
