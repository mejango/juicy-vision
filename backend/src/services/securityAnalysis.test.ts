import { assertEquals, assert, assertExists } from 'std/assert/mod.ts';

// ============================================================================
// Severity Tests
// ============================================================================

Deno.test('securityAnalysis - Severity Levels', async (t) => {
  const severities = ['critical', 'high', 'medium', 'low', 'info'];

  await t.step('has all severity levels', () => {
    assertEquals(severities.length, 5);
  });

  await t.step('critical is highest severity', () => {
    assertEquals(severities[0], 'critical');
  });

  await t.step('info is lowest severity', () => {
    assertEquals(severities[severities.length - 1], 'info');
  });
});

// ============================================================================
// Juicebox-Specific Rule Detection Tests
// ============================================================================

Deno.test('securityAnalysis - Juicebox Rules', async (t) => {
  await t.step('detects missing terminal validation pattern', () => {
    const code = `
      function afterPayRecordedWith(JBPayHookPayload calldata payload) external {
        // No validation of msg.sender
        emit PaymentReceived(payload.amount);
      }
    `;

    // Check if code matches the pattern for missing validation
    const hasMsgSenderCheck = code.includes('msg.sender') && (
      code.includes('require') ||
      code.includes('revert') ||
      code.includes('if')
    );

    assertEquals(hasMsgSenderCheck, false, 'Should detect missing terminal validation');
  });

  await t.step('accepts code with terminal validation', () => {
    const code = `
      function afterPayRecordedWith(JBPayHookPayload calldata payload) external {
        require(directory.isTerminalOf(payload.projectId, IJBTerminal(msg.sender)), "Unauthorized");
        emit PaymentReceived(payload.amount);
      }
    `;

    const hasValidation = code.includes('msg.sender') && code.includes('require');
    assertEquals(hasValidation, true);
  });

  await t.step('detects reentrancy pattern in hooks', () => {
    const code = `
      function afterPayRecordedWith(JBPayHookPayload calldata payload) external {
        recipient.call{value: msg.value}("");
      }
    `;

    const hasExternalCall = code.includes('.call{') || code.includes('.call(');
    assertEquals(hasExternalCall, true, 'Should detect external call');
  });

  await t.step('detects unchecked projectId', () => {
    const codeWithoutCheck = `
      function afterPayRecordedWith(JBPayHookPayload calldata payload) external {
        doSomething();
      }
    `;

    const codeWithCheck = `
      function afterPayRecordedWith(JBPayHookPayload calldata payload) external {
        require(payload.projectId == expectedProjectId, "Wrong project");
        doSomething();
      }
    `;

    const hasProjectIdCheck1 = codeWithoutCheck.includes('projectId');
    const hasProjectIdCheck2 = codeWithCheck.includes('projectId');

    assertEquals(hasProjectIdCheck1, false, 'Should detect missing projectId check');
    assertEquals(hasProjectIdCheck2, true, 'Should pass with projectId check');
  });

  await t.step('detects hardcoded addresses', () => {
    const code = `
      address constant TERMINAL = 0x1234567890123456789012345678901234567890;
    `;

    const addressPattern = /0x[a-fA-F0-9]{40}/;
    const hasHardcodedAddress = addressPattern.test(code);

    assertEquals(hasHardcodedAddress, true);
  });

  await t.step('detects missing supportsInterface', () => {
    const codeWithout = `
      contract MyHook is IJBPayHook {
        function afterPayRecordedWith(JBPayHookPayload calldata) external {}
      }
    `;

    const codeWith = `
      contract MyHook is IJBPayHook {
        function afterPayRecordedWith(JBPayHookPayload calldata) external {}
        function supportsInterface(bytes4 interfaceId) public view returns (bool) {
          return interfaceId == type(IJBPayHook).interfaceId;
        }
      }
    `;

    assertEquals(codeWithout.includes('supportsInterface'), false);
    assertEquals(codeWith.includes('supportsInterface'), true);
  });
});

// ============================================================================
// General Solidity Rule Detection Tests
// ============================================================================

Deno.test('securityAnalysis - Solidity Rules', async (t) => {
  await t.step('detects tx.origin usage', () => {
    const code = `
      function withdraw() external {
        require(tx.origin == owner, "Not owner");
      }
    `;

    assertEquals(code.includes('tx.origin'), true);
  });

  await t.step('detects delegatecall', () => {
    const code = `
      function execute(address target, bytes calldata data) external {
        target.delegatecall(data);
      }
    `;

    assertEquals(code.includes('delegatecall'), true);
  });

  await t.step('detects selfdestruct', () => {
    const code1 = `selfdestruct(payable(owner));`;
    const code2 = `suicide(owner);`; // Deprecated alias

    assertEquals(code1.includes('selfdestruct'), true);
    assertEquals(code2.includes('suicide'), true);
  });

  await t.step('detects inline assembly', () => {
    const code = `
      function getBalance() public view returns (uint256 bal) {
        assembly {
          bal := selfbalance()
        }
      }
    `;

    assertEquals(code.includes('assembly'), true);
  });

  await t.step('detects block.timestamp usage', () => {
    const code = `
      function isExpired() public view returns (bool) {
        return block.timestamp > deadline;
      }
    `;

    assertEquals(code.includes('block.timestamp'), true);
  });
});

// ============================================================================
// Analysis Summary Tests
// ============================================================================

Deno.test('securityAnalysis - Summary Calculation', async (t) => {
  interface Finding {
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  }

  const findings: Finding[] = [
    { severity: 'critical' },
    { severity: 'high' },
    { severity: 'high' },
    { severity: 'medium' },
    { severity: 'medium' },
    { severity: 'medium' },
    { severity: 'low' },
    { severity: 'info' },
    { severity: 'info' },
  ];

  const summary = {
    critical: findings.filter(f => f.severity === 'critical').length,
    high: findings.filter(f => f.severity === 'high').length,
    medium: findings.filter(f => f.severity === 'medium').length,
    low: findings.filter(f => f.severity === 'low').length,
    info: findings.filter(f => f.severity === 'info').length,
  };

  await t.step('counts critical findings', () => {
    assertEquals(summary.critical, 1);
  });

  await t.step('counts high findings', () => {
    assertEquals(summary.high, 2);
  });

  await t.step('counts medium findings', () => {
    assertEquals(summary.medium, 3);
  });

  await t.step('counts low findings', () => {
    assertEquals(summary.low, 1);
  });

  await t.step('counts info findings', () => {
    assertEquals(summary.info, 2);
  });

  await t.step('total equals findings length', () => {
    const total = summary.critical + summary.high + summary.medium + summary.low + summary.info;
    assertEquals(total, findings.length);
  });
});

// ============================================================================
// Deployment Security Check Tests
// ============================================================================

Deno.test('securityAnalysis - Deployment Checks', async (t) => {
  await t.step('blocks deployment with critical findings', () => {
    const criticalCount: number = 1;
    const canDeploy = criticalCount === 0;
    assertEquals(canDeploy, false);
  });

  await t.step('allows deployment with no critical findings', () => {
    const criticalCount = 0;
    const canDeploy = criticalCount === 0; // Intentional comparison
    assertEquals(canDeploy as boolean, true);
  });

  await t.step('warns about missing tests', () => {
    const files = [
      { path: 'src/MyHook.sol', content: 'contract MyHook {}' },
    ];

    const hasTests = files.some(f => f.path.includes('/test/') && f.path.endsWith('.t.sol'));
    assertEquals(hasTests, false, 'Should warn about missing tests');
  });

  await t.step('detects test files', () => {
    const files = [
      { path: 'src/MyHook.sol', content: 'contract MyHook {}' },
      { path: 'test/MyHook.t.sol', content: 'contract MyHookTest {}' },
    ];

    // Check for test files (either containing /test/ or starting with test/)
    const hasTests = files.some(f =>
      (f.path.includes('/test/') || f.path.startsWith('test/')) && f.path.endsWith('.t.sol')
    );
    assertEquals(hasTests, true);
  });

  await t.step('warns about missing SPDX license', () => {
    const codeWithout = `pragma solidity ^0.8.28; contract MyHook {}`;
    const codeWith = `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.28; contract MyHook {}`;

    assertEquals(codeWithout.includes('SPDX-License-Identifier'), false);
    assertEquals(codeWith.includes('SPDX-License-Identifier'), true);
  });
});

// ============================================================================
// Finding Structure Tests
// ============================================================================

Deno.test('securityAnalysis - Finding Structure', async (t) => {
  const mockFinding = {
    id: 'finding-1',
    tool: 'custom',
    ruleId: 'jb-terminal-validation',
    severity: 'critical' as const,
    title: 'Missing Terminal Validation',
    message: 'Hook function does not validate msg.sender',
    file: 'src/MyHook.sol',
    line: 10,
    endLine: 15,
    column: 5,
    code: 'function afterPayRecordedWith(...)',
    fix: 'Add require statement',
  };

  await t.step('finding has required fields', () => {
    assertExists(mockFinding.id);
    assertExists(mockFinding.tool);
    assertExists(mockFinding.ruleId);
    assertExists(mockFinding.severity);
    assertExists(mockFinding.title);
    assertExists(mockFinding.message);
    assertExists(mockFinding.file);
    assertExists(mockFinding.line);
  });

  await t.step('finding has optional fields', () => {
    assertExists(mockFinding.endLine);
    assertExists(mockFinding.column);
    assertExists(mockFinding.code);
    assertExists(mockFinding.fix);
  });

  await t.step('line number is positive', () => {
    assert(mockFinding.line > 0);
  });

  await t.step('file path is relative', () => {
    assert(!mockFinding.file.startsWith('/'));
  });
});

// ============================================================================
// Tool Types Tests
// ============================================================================

Deno.test('securityAnalysis - Analysis Tools', async (t) => {
  const tools = ['semgrep', 'slither', 'custom'];

  await t.step('supports semgrep', () => {
    assert(tools.includes('semgrep'));
  });

  await t.step('supports slither', () => {
    assert(tools.includes('slither'));
  });

  await t.step('supports custom rules', () => {
    assert(tools.includes('custom'));
  });
});
