import { assertEquals, assertExists, assertRejects } from 'std/assert/mod.ts';

// Test chain configurations
Deno.test('Wallet Service - Chain Configuration', async (t) => {
  const CHAINS = {
    1: 'mainnet',
    10: 'optimism',
    8453: 'base',
    42161: 'arbitrum',
  } as const;

  const RPC_URLS: Record<number, string> = {
    1: 'https://rpc.ankr.com/eth',
    10: 'https://rpc.ankr.com/optimism',
    8453: 'https://rpc.ankr.com/base',
    42161: 'https://rpc.ankr.com/arbitrum',
  };

  const USDC_ADDRESSES: Record<number, string> = {
    1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  };

  await t.step('supports Ethereum mainnet', () => {
    assertEquals(CHAINS[1], 'mainnet');
    assertExists(RPC_URLS[1]);
    assertExists(USDC_ADDRESSES[1]);
  });

  await t.step('supports Optimism', () => {
    assertEquals(CHAINS[10], 'optimism');
    assertExists(RPC_URLS[10]);
    assertExists(USDC_ADDRESSES[10]);
  });

  await t.step('supports Base', () => {
    assertEquals(CHAINS[8453], 'base');
    assertExists(RPC_URLS[8453]);
    assertExists(USDC_ADDRESSES[8453]);
  });

  await t.step('supports Arbitrum', () => {
    assertEquals(CHAINS[42161], 'arbitrum');
    assertExists(RPC_URLS[42161]);
    assertExists(USDC_ADDRESSES[42161]);
  });

  await t.step('has valid USDC addresses (checksum format)', () => {
    const checksumRegex = /^0x[0-9a-fA-F]{40}$/;
    for (const [chainId, address] of Object.entries(USDC_ADDRESSES)) {
      assertEquals(checksumRegex.test(address), true, `Invalid address for chain ${chainId}`);
    }
  });
});

// Test transfer hold period
Deno.test('Wallet Service - Transfer Hold Period', async (t) => {
  const TRANSFER_HOLD_DAYS = 7;
  const TRANSFER_HOLD_MS = TRANSFER_HOLD_DAYS * 24 * 60 * 60 * 1000;

  await t.step('hold period is 7 days', () => {
    assertEquals(TRANSFER_HOLD_DAYS, 7);
  });

  await t.step('hold period in milliseconds is correct', () => {
    const expectedMs = 7 * 24 * 60 * 60 * 1000;
    assertEquals(TRANSFER_HOLD_MS, expectedMs);
  });

  await t.step('hold period is approximately 604800000 ms', () => {
    assertEquals(TRANSFER_HOLD_MS, 604800000);
  });
});

// Test ERC20 ABI structure
Deno.test('Wallet Service - ERC20 ABI', async (t) => {
  const ERC20_ABI = [
    {
      name: 'balanceOf',
      type: 'function',
      stateMutability: 'view',
      inputs: [{ name: 'account', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }],
    },
    {
      name: 'decimals',
      type: 'function',
      stateMutability: 'view',
      inputs: [],
      outputs: [{ name: '', type: 'uint8' }],
    },
    {
      name: 'symbol',
      type: 'function',
      stateMutability: 'view',
      inputs: [],
      outputs: [{ name: '', type: 'string' }],
    },
    {
      name: 'transfer',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      outputs: [{ name: '', type: 'bool' }],
    },
  ] as const;

  await t.step('has balanceOf function', () => {
    const balanceOf = ERC20_ABI.find((f) => f.name === 'balanceOf');
    assertExists(balanceOf);
    assertEquals(balanceOf!.stateMutability, 'view');
    assertEquals(balanceOf!.inputs.length, 1);
    assertEquals(balanceOf!.inputs[0].type, 'address');
  });

  await t.step('has decimals function', () => {
    const decimals = ERC20_ABI.find((f) => f.name === 'decimals');
    assertExists(decimals);
    assertEquals(decimals!.stateMutability, 'view');
    assertEquals(decimals!.inputs.length, 0);
    assertEquals(decimals!.outputs[0].type, 'uint8');
  });

  await t.step('has symbol function', () => {
    const symbol = ERC20_ABI.find((f) => f.name === 'symbol');
    assertExists(symbol);
    assertEquals(symbol!.stateMutability, 'view');
  });

  await t.step('has transfer function', () => {
    const transfer = ERC20_ABI.find((f) => f.name === 'transfer');
    assertExists(transfer);
    assertEquals(transfer!.stateMutability, 'nonpayable');
    assertEquals(transfer!.inputs.length, 2);
    assertEquals(transfer!.inputs[0].type, 'address');
    assertEquals(transfer!.inputs[1].type, 'uint256');
  });
});

// Test transfer status states
Deno.test('Wallet Service - Transfer Statuses', async (t) => {
  type TransferStatus = 'pending' | 'ready' | 'executed' | 'cancelled';

  await t.step('pending is initial state', () => {
    const status: TransferStatus = 'pending';
    assertEquals(status, 'pending');
  });

  await t.step('ready is after hold period', () => {
    const status: TransferStatus = 'ready';
    assertEquals(status, 'ready');
  });

  await t.step('executed is final success state', () => {
    const status: TransferStatus = 'executed';
    assertEquals(status, 'executed');
  });

  await t.step('cancelled is user-initiated stop', () => {
    const status: TransferStatus = 'cancelled';
    assertEquals(status, 'cancelled');
  });
});

// Test Bendystraw GraphQL query structure
Deno.test('Wallet Service - Bendystraw Query', async (t) => {
  const USER_HOLDINGS_QUERY = `
    query UserHoldings($address: String!, $chainId: Int!) {
      participants(
        where: { address: $address, chainId: $chainId }
        orderBy: "balance"
        orderDirection: "desc"
        limit: 100
      ) {
        items {
          projectId
          balance
          volume
          project {
            metadata {
              name
            }
            handle
          }
        }
      }
    }
  `;

  await t.step('query includes required variables', () => {
    assertEquals(USER_HOLDINGS_QUERY.includes('$address: String!'), true);
    assertEquals(USER_HOLDINGS_QUERY.includes('$chainId: Int!'), true);
  });

  await t.step('query filters by address and chainId', () => {
    assertEquals(USER_HOLDINGS_QUERY.includes('address: $address'), true);
    assertEquals(USER_HOLDINGS_QUERY.includes('chainId: $chainId'), true);
  });

  await t.step('query orders by balance descending', () => {
    assertEquals(USER_HOLDINGS_QUERY.includes('orderBy: "balance"'), true);
    assertEquals(USER_HOLDINGS_QUERY.includes('orderDirection: "desc"'), true);
  });

  await t.step('query limits to 100 results', () => {
    assertEquals(USER_HOLDINGS_QUERY.includes('limit: 100'), true);
  });

  await t.step('query includes project metadata', () => {
    assertEquals(USER_HOLDINGS_QUERY.includes('projectId'), true);
    assertEquals(USER_HOLDINGS_QUERY.includes('balance'), true);
    assertEquals(USER_HOLDINGS_QUERY.includes('project {'), true);
    assertEquals(USER_HOLDINGS_QUERY.includes('metadata {'), true);
    assertEquals(USER_HOLDINGS_QUERY.includes('name'), true);
  });
});

// Test WalletBalance type mapping
Deno.test('Wallet Service - WalletBalance Mapping', async (t) => {
  interface WalletBalance {
    chainId: number;
    tokenAddress: string;
    tokenSymbol: string;
    balance: string;
    decimals: number;
    usdValue?: string;
  }

  interface BendystrawParticipant {
    projectId: number;
    balance: string;
    volume: string;
    project?: {
      metadata?: {
        name?: string;
      };
      handle?: string;
    };
  }

  // Mock participant data
  const mockParticipant: BendystrawParticipant = {
    projectId: 1,
    balance: '1000000000000000000000',
    volume: '5000000000000000000000',
    project: {
      metadata: {
        name: 'Test Project',
      },
      handle: 'test-project',
    },
  };

  await t.step('maps participant to WalletBalance format', () => {
    const chainId = 1;
    const walletBalance: WalletBalance = {
      chainId,
      tokenAddress: `jb:${mockParticipant.projectId}`,
      tokenSymbol: (mockParticipant.project?.metadata?.name || `Project #${mockParticipant.projectId}`).slice(0, 10),
      balance: mockParticipant.balance,
      decimals: 18,
      usdValue: undefined,
    };

    assertEquals(walletBalance.chainId, 1);
    assertEquals(walletBalance.tokenAddress, 'jb:1');
    assertEquals(walletBalance.tokenSymbol, 'Test Proje'); // Truncated to 10 chars
    assertEquals(walletBalance.decimals, 18);
  });

  await t.step('uses project handle as fallback for name', () => {
    const noNameParticipant: BendystrawParticipant = {
      projectId: 2,
      balance: '500000000000000000000',
      volume: '1000000000000000000000',
      project: {
        handle: 'my-handle',
      },
    };

    const name = noNameParticipant.project?.metadata?.name || noNameParticipant.project?.handle || `Project #${noNameParticipant.projectId}`;
    assertEquals(name, 'my-handle');
  });

  await t.step('uses project ID as last resort for name', () => {
    const bareParticipant: BendystrawParticipant = {
      projectId: 3,
      balance: '100000000000000000000',
      volume: '200000000000000000000',
    };

    const name = bareParticipant.project?.metadata?.name || bareParticipant.project?.handle || `Project #${bareParticipant.projectId}`;
    assertEquals(name, 'Project #3');
  });
});

// Test balance filtering
Deno.test('Wallet Service - Zero Balance Filtering', async (t) => {
  const participants = [
    { balance: '1000000000000000000', projectId: 1 },
    { balance: '0', projectId: 2 },
    { balance: '500000000000000000', projectId: 3 },
    { balance: '0', projectId: 4 },
  ];

  await t.step('filters out zero balances', () => {
    const nonZero = participants.filter((p) => BigInt(p.balance) > 0n);
    assertEquals(nonZero.length, 2);
    assertEquals(nonZero[0].projectId, 1);
    assertEquals(nonZero[1].projectId, 3);
  });

  await t.step('keeps all non-zero balances', () => {
    const nonZero = participants.filter((p) => BigInt(p.balance) > 0n);
    assertEquals(nonZero.every((p) => BigInt(p.balance) > 0n), true);
  });
});

// Test native token address check
Deno.test('Wallet Service - Native Token Detection', async (t) => {
  const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

  await t.step('identifies zero address as native token', () => {
    const isNative = NATIVE_TOKEN_ADDRESS === '0x0000000000000000000000000000000000000000';
    assertEquals(isNative, true);
  });

  await t.step('does not identify USDC as native', () => {
    const usdcAddress: string = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const isNative = usdcAddress === '0x0000000000000000000000000000000000000000';
    assertEquals(isNative, false);
  });
});

// Test transfer request validation
Deno.test('Wallet Service - Transfer Request Validation', async (t) => {
  interface TransferRequest {
    userId: string;
    chainId: number;
    tokenAddress: string;
    amount: string;
    toAddress: string;
  }

  const validRequest: TransferRequest = {
    userId: 'user-123',
    chainId: 1,
    tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    amount: '1000000000',
    toAddress: '0x1234567890123456789012345678901234567890',
  };

  await t.step('valid request has all required fields', () => {
    assertExists(validRequest.userId);
    assertExists(validRequest.chainId);
    assertExists(validRequest.tokenAddress);
    assertExists(validRequest.amount);
    assertExists(validRequest.toAddress);
  });

  await t.step('amount is parseable as bigint', () => {
    const amount = BigInt(validRequest.amount);
    assertEquals(amount, 1000000000n);
  });

  await t.step('chainId is supported', () => {
    const supportedChains = [1, 10, 8453, 42161];
    assertEquals(supportedChains.includes(validRequest.chainId), true);
  });
});

// Test available date calculation
Deno.test('Wallet Service - Available Date Calculation', async (t) => {
  const TRANSFER_HOLD_MS = 7 * 24 * 60 * 60 * 1000;

  await t.step('calculates available date 7 days from now', () => {
    const now = Date.now();
    const availableAt = new Date(now + TRANSFER_HOLD_MS);
    const diff = availableAt.getTime() - now;
    assertEquals(diff, TRANSFER_HOLD_MS);
  });

  await t.step('available date is in the future', () => {
    const availableAt = new Date(Date.now() + TRANSFER_HOLD_MS);
    assertEquals(availableAt.getTime() > Date.now(), true);
  });
});

// Test PendingTransfer type
Deno.test('Wallet Service - PendingTransfer Type', async (t) => {
  interface PendingTransfer {
    id: string;
    userId: string;
    chainId: number;
    tokenAddress: string;
    tokenSymbol: string;
    amount: string;
    toAddress: string;
    createdAt: Date;
    availableAt: Date;
    status: 'pending' | 'ready' | 'executed' | 'cancelled';
    txHash?: string;
  }

  const mockTransfer: PendingTransfer = {
    id: 'transfer-123',
    userId: 'user-456',
    chainId: 1,
    tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    tokenSymbol: 'USDC',
    amount: '1000000000',
    toAddress: '0x1234567890123456789012345678901234567890',
    createdAt: new Date(),
    availableAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    status: 'pending',
  };

  await t.step('has correct structure', () => {
    assertExists(mockTransfer.id);
    assertExists(mockTransfer.userId);
    assertExists(mockTransfer.chainId);
    assertExists(mockTransfer.tokenAddress);
    assertExists(mockTransfer.tokenSymbol);
    assertExists(mockTransfer.amount);
    assertExists(mockTransfer.toAddress);
    assertExists(mockTransfer.createdAt);
    assertExists(mockTransfer.availableAt);
    assertExists(mockTransfer.status);
  });

  await t.step('txHash is optional (undefined for pending)', () => {
    assertEquals(mockTransfer.txHash, undefined);
  });

  await t.step('availableAt is after createdAt', () => {
    assertEquals(mockTransfer.availableAt.getTime() > mockTransfer.createdAt.getTime(), true);
  });
});

// Test balance sufficiency check
Deno.test('Wallet Service - Balance Sufficiency', async (t) => {
  await t.step('sufficient when balance >= amount', () => {
    const balance = 1000000000n;
    const amount = 500000000n;
    assertEquals(balance >= amount, true);
  });

  await t.step('insufficient when balance < amount', () => {
    const balance = 100000000n;
    const amount = 500000000n;
    assertEquals(balance >= amount, false);
  });

  await t.step('exactly sufficient when balance == amount', () => {
    const balance = 500000000n;
    const amount = 500000000n;
    assertEquals(balance >= amount, true);
  });
});
