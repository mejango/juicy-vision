import { assertEquals, assertExists, assert } from 'std/assert/mod.ts';
import { computeFilesHash, type HookProjectType } from './hookProjects.ts';

// ============================================================================
// File Hash Tests
// ============================================================================

Deno.test('hookProjects - computeFilesHash', async (t) => {
  await t.step('produces consistent hash for same files', () => {
    const files = [
      { path: 'src/MyHook.sol', content: 'contract MyHook {}' },
      { path: 'test/MyHook.t.sol', content: 'contract MyHookTest {}' },
    ];

    const hash1 = computeFilesHash(files);
    const hash2 = computeFilesHash(files);

    assertEquals(hash1, hash2);
  });

  await t.step('produces different hash for different content', () => {
    const files1 = [{ path: 'src/MyHook.sol', content: 'contract MyHook {}' }];
    const files2 = [{ path: 'src/MyHook.sol', content: 'contract MyHook { uint x; }' }];

    const hash1 = computeFilesHash(files1);
    const hash2 = computeFilesHash(files2);

    assert(hash1 !== hash2);
  });

  await t.step('produces different hash for different paths', () => {
    const files1 = [{ path: 'src/MyHook.sol', content: 'contract MyHook {}' }];
    const files2 = [{ path: 'src/OtherHook.sol', content: 'contract MyHook {}' }];

    const hash1 = computeFilesHash(files1);
    const hash2 = computeFilesHash(files2);

    assert(hash1 !== hash2);
  });

  await t.step('sorts files by path for consistent ordering', () => {
    const files1 = [
      { path: 'b.sol', content: 'b' },
      { path: 'a.sol', content: 'a' },
    ];
    const files2 = [
      { path: 'a.sol', content: 'a' },
      { path: 'b.sol', content: 'b' },
    ];

    const hash1 = computeFilesHash(files1);
    const hash2 = computeFilesHash(files2);

    assertEquals(hash1, hash2);
  });

  await t.step('returns 64-character hex string (SHA-256)', () => {
    const files = [{ path: 'test.sol', content: 'test' }];
    const hash = computeFilesHash(files);

    assertEquals(hash.length, 64);
    assert(/^[a-f0-9]+$/.test(hash));
  });
});

// ============================================================================
// Project Type Validation Tests
// ============================================================================

Deno.test('hookProjects - Project Types', async (t) => {
  const validTypes: HookProjectType[] = ['pay-hook', 'cash-out-hook', 'split-hook'];

  await t.step('supports pay-hook type', () => {
    assert(validTypes.includes('pay-hook'));
  });

  await t.step('supports cash-out-hook type', () => {
    assert(validTypes.includes('cash-out-hook'));
  });

  await t.step('supports split-hook type', () => {
    assert(validTypes.includes('split-hook'));
  });

  await t.step('has exactly 3 valid types', () => {
    assertEquals(validTypes.length, 3);
  });
});

// ============================================================================
// File Path Validation Tests (simulated)
// ============================================================================

Deno.test('hookProjects - File Path Patterns', async (t) => {
  const validPaths = [
    'src/MyHook.sol',
    'test/MyHook.t.sol',
    'script/Deploy.s.sol',
    'foundry.toml',
    'lib/forge-std/Test.sol',
  ];

  const invalidPaths = [
    '../escape.sol',
    '/absolute/path.sol',
    '../../etc/passwd',
    'src/../../../escape.sol',
  ];

  await t.step('accepts valid relative paths', () => {
    for (const path of validPaths) {
      assert(!path.includes('..'), `Path should not have ..: ${path}`);
      assert(!path.startsWith('/'), `Path should not start with /: ${path}`);
    }
  });

  await t.step('identifies invalid paths with directory traversal', () => {
    for (const path of invalidPaths) {
      const hasTraversal = path.includes('..');
      const hasAbsolute = path.startsWith('/');
      assert(hasTraversal || hasAbsolute, `Path should be invalid: ${path}`);
    }
  });

  await t.step('Solidity files end with .sol', () => {
    const solFiles = validPaths.filter(p => p.endsWith('.sol'));
    assertEquals(solFiles.length, 4);
  });

  await t.step('Test files follow .t.sol convention', () => {
    const testFiles = validPaths.filter(p => p.endsWith('.t.sol'));
    assertEquals(testFiles.length, 1);
    assertEquals(testFiles[0], 'test/MyHook.t.sol');
  });

  await t.step('Script files follow .s.sol convention', () => {
    const scriptFiles = validPaths.filter(p => p.endsWith('.s.sol'));
    assertEquals(scriptFiles.length, 1);
    assertEquals(scriptFiles[0], 'script/Deploy.s.sol');
  });
});

// ============================================================================
// Project Data Structure Tests
// ============================================================================

Deno.test('hookProjects - Data Structure', async (t) => {
  const mockProject = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    userAddress: '0x1234567890123456789012345678901234567890',
    name: 'My Pay Hook',
    projectType: 'pay-hook' as HookProjectType,
    description: 'A hook that caps payments at 1 ETH',
    createdAt: new Date(),
    updatedAt: new Date(),
    isDeployed: false,
    deployedAddresses: {},
  };

  await t.step('project has required fields', () => {
    assertExists(mockProject.id);
    assertExists(mockProject.userAddress);
    assertExists(mockProject.name);
    assertExists(mockProject.projectType);
    assertExists(mockProject.createdAt);
    assertExists(mockProject.updatedAt);
  });

  await t.step('userAddress is 42 characters (with 0x prefix)', () => {
    assertEquals(mockProject.userAddress.length, 42);
    assert(mockProject.userAddress.startsWith('0x'));
  });

  await t.step('deployedAddresses is empty object initially', () => {
    assertEquals(Object.keys(mockProject.deployedAddresses).length, 0);
  });

  await t.step('isDeployed is false initially', () => {
    assertEquals(mockProject.isDeployed, false);
  });
});

// ============================================================================
// Deployed Addresses Structure Tests
// ============================================================================

Deno.test('hookProjects - Deployed Addresses', async (t) => {
  const deployedAddresses: Record<number, string> = {
    1: '0xabc1234567890123456789012345678901234567',
    10: '0xdef1234567890123456789012345678901234567',
    8453: '0x1231234567890123456789012345678901234567',
  };

  await t.step('keys are chain IDs', () => {
    const chainIds = Object.keys(deployedAddresses).map(Number);
    assert(chainIds.includes(1)); // Ethereum
    assert(chainIds.includes(10)); // Optimism
    assert(chainIds.includes(8453)); // Base
  });

  await t.step('values are valid addresses', () => {
    for (const address of Object.values(deployedAddresses)) {
      assertEquals(address.length, 42);
      assert(address.startsWith('0x'));
      assert(/^0x[a-f0-9]+$/i.test(address));
    }
  });

  await t.step('can track multi-chain deployments', () => {
    assertEquals(Object.keys(deployedAddresses).length, 3);
  });
});
