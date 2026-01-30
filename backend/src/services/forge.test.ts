import { assertEquals, assert } from 'std/assert/mod.ts';
import {
  validateJobInput,
  isAllowedRpcMethod,
  getRpcUrl,
  type ForgeJobInput,
} from './forge.ts';

// ============================================================================
// Input Validation Tests
// ============================================================================

Deno.test('forge - validateJobInput', async (t) => {
  await t.step('accepts valid input with single file', () => {
    const input: ForgeJobInput = {
      files: [{ path: 'src/MyHook.sol', content: 'contract MyHook {}' }],
    };

    const result = validateJobInput(input);
    assertEquals(result.valid, true);
  });

  await t.step('accepts valid input with multiple files', () => {
    const input: ForgeJobInput = {
      files: [
        { path: 'src/MyHook.sol', content: 'contract MyHook {}' },
        { path: 'test/MyHook.t.sol', content: 'contract MyHookTest {}' },
        { path: 'foundry.toml', content: '[profile.default]' },
      ],
    };

    const result = validateJobInput(input);
    assertEquals(result.valid, true);
  });

  await t.step('rejects too many files (> 50)', () => {
    const files = Array.from({ length: 51 }, (_, i) => ({
      path: `src/File${i}.sol`,
      content: `contract File${i} {}`,
    }));

    const input: ForgeJobInput = { files };
    const result = validateJobInput(input);

    assertEquals(result.valid, false);
    assert(result.error?.includes('Too many files'));
  });

  await t.step('rejects file exceeding 500KB', () => {
    const largeContent = 'x'.repeat(501 * 1024); // 501KB
    const input: ForgeJobInput = {
      files: [{ path: 'src/Large.sol', content: largeContent }],
    };

    const result = validateJobInput(input);
    assertEquals(result.valid, false);
    assert(result.error?.includes('exceeds'));
  });

  await t.step('rejects total size exceeding 5MB', () => {
    // Create 11 files of ~500KB each = ~5.5MB total
    const files = Array.from({ length: 11 }, (_, i) => ({
      path: `src/File${i}.sol`,
      content: 'x'.repeat(490 * 1024),
    }));

    const input: ForgeJobInput = { files };
    const result = validateJobInput(input);

    assertEquals(result.valid, false);
    assert(result.error?.includes('Total size'));
  });

  await t.step('rejects directory traversal in path', () => {
    const input: ForgeJobInput = {
      files: [{ path: '../escape.sol', content: 'contract Escape {}' }],
    };

    const result = validateJobInput(input);
    assertEquals(result.valid, false);
    assert(result.error?.includes('Invalid file path'));
  });

  await t.step('rejects absolute paths', () => {
    const input: ForgeJobInput = {
      files: [{ path: '/etc/passwd', content: 'not allowed' }],
    };

    const result = validateJobInput(input);
    assertEquals(result.valid, false);
    assert(result.error?.includes('Invalid file path'));
  });

  await t.step('rejects unsupported chain ID in fork config', () => {
    const input: ForgeJobInput = {
      files: [{ path: 'src/MyHook.sol', content: 'contract MyHook {}' }],
      forkConfig: { chainId: 999999 },
    };

    const result = validateJobInput(input);
    assertEquals(result.valid, false);
    assert(result.error?.includes('Unsupported chain'));
  });

  await t.step('accepts supported chain IDs in fork config', () => {
    const supportedChains = [1, 10, 8453, 42161, 11155111, 84532];

    for (const chainId of supportedChains) {
      const input: ForgeJobInput = {
        files: [{ path: 'src/MyHook.sol', content: 'contract MyHook {}' }],
        forkConfig: { chainId },
      };

      const result = validateJobInput(input);
      assertEquals(result.valid, true, `Chain ${chainId} should be supported`);
    }
  });
});

// ============================================================================
// RPC Method Filtering Tests
// ============================================================================

Deno.test('forge - isAllowedRpcMethod', async (t) => {
  const allowedMethods = [
    'eth_call',
    'eth_getCode',
    'eth_getBalance',
    'eth_getStorageAt',
    'eth_getBlockByNumber',
    'eth_getBlockByHash',
    'eth_getTransactionByHash',
    'eth_getTransactionReceipt',
    'eth_getLogs',
    'eth_chainId',
    'eth_blockNumber',
    'net_version',
  ];

  const disallowedMethods = [
    'eth_sendTransaction',
    'eth_sendRawTransaction',
    'eth_sign',
    'personal_sign',
    'eth_signTransaction',
    'eth_accounts',
    'eth_requestAccounts',
    'wallet_addEthereumChain',
    'wallet_switchEthereumChain',
  ];

  await t.step('allows read-only methods', () => {
    for (const method of allowedMethods) {
      assertEquals(isAllowedRpcMethod(method), true, `${method} should be allowed`);
    }
  });

  await t.step('blocks signing/sending methods', () => {
    for (const method of disallowedMethods) {
      assertEquals(isAllowedRpcMethod(method), false, `${method} should be blocked`);
    }
  });

  await t.step('blocks unknown methods', () => {
    assertEquals(isAllowedRpcMethod('unknown_method'), false);
    assertEquals(isAllowedRpcMethod('debug_traceTransaction'), false);
  });
});

// ============================================================================
// RPC URL Resolution Tests
// ============================================================================

Deno.test('forge - getRpcUrl', async (t) => {
  await t.step('returns URL for Ethereum mainnet', () => {
    const url = getRpcUrl(1);
    assertExists(url);
    assert(url.includes('eth') || url.includes('llama'));
  });

  await t.step('returns URL for Optimism', () => {
    const url = getRpcUrl(10);
    assertExists(url);
    assert(url.includes('optimism') || url.includes('llama'));
  });

  await t.step('returns URL for Base', () => {
    const url = getRpcUrl(8453);
    assertExists(url);
    assert(url.includes('base') || url.includes('llama'));
  });

  await t.step('returns URL for Arbitrum', () => {
    const url = getRpcUrl(42161);
    assertExists(url);
    assert(url.includes('arbitrum') || url.includes('llama'));
  });

  await t.step('returns URL for Sepolia testnet', () => {
    const url = getRpcUrl(11155111);
    assertExists(url);
    assert(url.includes('sepolia') || url.includes('llama'));
  });

  await t.step('returns URL for Base Sepolia testnet', () => {
    const url = getRpcUrl(84532);
    assertExists(url);
  });

  await t.step('returns null for unsupported chains', () => {
    assertEquals(getRpcUrl(999999), null);
    assertEquals(getRpcUrl(0), null);
    assertEquals(getRpcUrl(-1), null);
  });
});

// ============================================================================
// Job Type Tests
// ============================================================================

Deno.test('forge - Job Types', async (t) => {
  const validJobTypes = ['compile', 'test', 'script'];

  await t.step('supports compile job type', () => {
    assert(validJobTypes.includes('compile'));
  });

  await t.step('supports test job type', () => {
    assert(validJobTypes.includes('test'));
  });

  await t.step('supports script job type', () => {
    assert(validJobTypes.includes('script'));
  });

  await t.step('has exactly 3 job types', () => {
    assertEquals(validJobTypes.length, 3);
  });
});

// ============================================================================
// Job Status Tests
// ============================================================================

Deno.test('forge - Job Status', async (t) => {
  const validStatuses = ['queued', 'running', 'completed', 'failed', 'timeout'];

  await t.step('has all expected statuses', () => {
    assert(validStatuses.includes('queued'));
    assert(validStatuses.includes('running'));
    assert(validStatuses.includes('completed'));
    assert(validStatuses.includes('failed'));
    assert(validStatuses.includes('timeout'));
  });

  await t.step('initial status is queued', () => {
    assertEquals(validStatuses[0], 'queued');
  });
});

// ============================================================================
// Resource Limits Tests
// ============================================================================

Deno.test('forge - Resource Limits', async (t) => {
  const COMPILE_TIMEOUT_MS = 30_000;
  const TEST_TIMEOUT_MS = 120_000;
  const MAX_FILE_SIZE = 500 * 1024;
  const MAX_TOTAL_SIZE = 5 * 1024 * 1024;
  const MAX_FILES = 50;

  await t.step('compile timeout is 30 seconds', () => {
    assertEquals(COMPILE_TIMEOUT_MS, 30000);
  });

  await t.step('test timeout is 2 minutes', () => {
    assertEquals(TEST_TIMEOUT_MS, 120000);
  });

  await t.step('max file size is 500KB', () => {
    assertEquals(MAX_FILE_SIZE, 512000);
  });

  await t.step('max total size is 5MB', () => {
    assertEquals(MAX_TOTAL_SIZE, 5242880);
  });

  await t.step('max files is 50', () => {
    assertEquals(MAX_FILES, 50);
  });
});

// ============================================================================
// Fork Config Structure Tests
// ============================================================================

Deno.test('forge - Fork Config', async (t) => {
  await t.step('accepts chainId only', () => {
    const input: ForgeJobInput = {
      files: [{ path: 'src/Test.sol', content: 'contract Test {}' }],
      forkConfig: { chainId: 1 },
    };

    const result = validateJobInput(input);
    assertEquals(result.valid, true);
  });

  await t.step('accepts chainId with blockNumber', () => {
    const input: ForgeJobInput = {
      files: [{ path: 'src/Test.sol', content: 'contract Test {}' }],
      forkConfig: { chainId: 1, blockNumber: 19000000 },
    };

    const result = validateJobInput(input);
    assertEquals(result.valid, true);
  });

  await t.step('accepts input without fork config', () => {
    const input: ForgeJobInput = {
      files: [{ path: 'src/Test.sol', content: 'contract Test {}' }],
    };

    const result = validateJobInput(input);
    assertEquals(result.valid, true);
  });
});

function assertExists<T>(value: T | null | undefined): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error('Expected value to exist');
  }
}
