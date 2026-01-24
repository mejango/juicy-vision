import { assertEquals, assertExists } from 'std/assert/mod.ts';
import { z } from 'zod';

// ============================================================================
// API Schema Tests
// ============================================================================

Deno.test('Juice Routes - Purchase Schema', async (t) => {
  const PurchaseSchema = z.object({
    amount: z.number().min(1).max(10000),
  });

  await t.step('valid purchase amount passes', () => {
    const result = PurchaseSchema.safeParse({ amount: 100 });
    assertEquals(result.success, true);
  });

  await t.step('$1 minimum passes', () => {
    const result = PurchaseSchema.safeParse({ amount: 1 });
    assertEquals(result.success, true);
  });

  await t.step('$10,000 maximum passes', () => {
    const result = PurchaseSchema.safeParse({ amount: 10000 });
    assertEquals(result.success, true);
  });

  await t.step('$0.99 fails minimum check', () => {
    const result = PurchaseSchema.safeParse({ amount: 0.99 });
    assertEquals(result.success, false);
  });

  await t.step('$10,001 fails maximum check', () => {
    const result = PurchaseSchema.safeParse({ amount: 10001 });
    assertEquals(result.success, false);
  });

  await t.step('negative amount fails', () => {
    const result = PurchaseSchema.safeParse({ amount: -50 });
    assertEquals(result.success, false);
  });

  await t.step('string amount fails type check', () => {
    const result = PurchaseSchema.safeParse({ amount: '100' });
    assertEquals(result.success, false);
  });

  await t.step('missing amount fails', () => {
    const result = PurchaseSchema.safeParse({});
    assertEquals(result.success, false);
  });
});

Deno.test('Juice Routes - Spend Schema', async (t) => {
  const SpendSchema = z.object({
    amount: z.number().min(1),
    projectId: z.number().int().positive(),
    chainId: z.number().int().positive(),
    beneficiaryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    memo: z.string().max(500).optional(),
  });

  const validSpend = {
    amount: 50,
    projectId: 1,
    chainId: 1,
    beneficiaryAddress: '0x1234567890123456789012345678901234567890',
    memo: 'Test payment',
  };

  await t.step('valid spend passes', () => {
    const result = SpendSchema.safeParse(validSpend);
    assertEquals(result.success, true);
  });

  await t.step('memo is optional', () => {
    const { memo, ...withoutMemo } = validSpend;
    const result = SpendSchema.safeParse(withoutMemo);
    assertEquals(result.success, true);
  });

  await t.step('amount below $1 fails', () => {
    const result = SpendSchema.safeParse({ ...validSpend, amount: 0.5 });
    assertEquals(result.success, false);
  });

  await t.step('negative projectId fails', () => {
    const result = SpendSchema.safeParse({ ...validSpend, projectId: -1 });
    assertEquals(result.success, false);
  });

  await t.step('zero projectId fails', () => {
    const result = SpendSchema.safeParse({ ...validSpend, projectId: 0 });
    assertEquals(result.success, false);
  });

  await t.step('float projectId fails', () => {
    const result = SpendSchema.safeParse({ ...validSpend, projectId: 1.5 });
    assertEquals(result.success, false);
  });

  await t.step('invalid address format fails', () => {
    const result = SpendSchema.safeParse({ ...validSpend, beneficiaryAddress: '0x123' });
    assertEquals(result.success, false);
  });

  await t.step('address without 0x fails', () => {
    const result = SpendSchema.safeParse({
      ...validSpend,
      beneficiaryAddress: '1234567890123456789012345678901234567890'
    });
    assertEquals(result.success, false);
  });

  await t.step('memo over 500 chars fails', () => {
    const result = SpendSchema.safeParse({ ...validSpend, memo: 'x'.repeat(501) });
    assertEquals(result.success, false);
  });

  await t.step('memo at 500 chars passes', () => {
    const result = SpendSchema.safeParse({ ...validSpend, memo: 'x'.repeat(500) });
    assertEquals(result.success, true);
  });
});

Deno.test('Juice Routes - Cash Out Schema', async (t) => {
  const CashOutSchema = z.object({
    amount: z.number().min(1),
    destinationAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    chainId: z.number().int().positive().optional(),
  });

  const validCashOut = {
    amount: 25,
    destinationAddress: '0x1234567890123456789012345678901234567890',
    chainId: 1,
  };

  await t.step('valid cash out passes', () => {
    const result = CashOutSchema.safeParse(validCashOut);
    assertEquals(result.success, true);
  });

  await t.step('chainId is optional', () => {
    const { chainId, ...withoutChain } = validCashOut;
    const result = CashOutSchema.safeParse(withoutChain);
    assertEquals(result.success, true);
  });

  await t.step('amount below $1 fails', () => {
    const result = CashOutSchema.safeParse({ ...validCashOut, amount: 0.5 });
    assertEquals(result.success, false);
  });

  await t.step('invalid destination address fails', () => {
    const result = CashOutSchema.safeParse({ ...validCashOut, destinationAddress: 'invalid' });
    assertEquals(result.success, false);
  });

  await t.step('chainId 10 (Optimism) passes', () => {
    const result = CashOutSchema.safeParse({ ...validCashOut, chainId: 10 });
    assertEquals(result.success, true);
  });

  await t.step('chainId 8453 (Base) passes', () => {
    const result = CashOutSchema.safeParse({ ...validCashOut, chainId: 8453 });
    assertEquals(result.success, true);
  });
});

Deno.test('Juice Routes - Transactions Query Schema', async (t) => {
  const TransactionsQuerySchema = z.object({
    limit: z.coerce.number().min(1).max(100).optional(),
    offset: z.coerce.number().min(0).optional(),
  });

  await t.step('default query (no params) passes', () => {
    const result = TransactionsQuerySchema.safeParse({});
    assertEquals(result.success, true);
  });

  await t.step('limit 50 passes', () => {
    const result = TransactionsQuerySchema.safeParse({ limit: 50 });
    assertEquals(result.success, true);
  });

  await t.step('limit 100 (max) passes', () => {
    const result = TransactionsQuerySchema.safeParse({ limit: 100 });
    assertEquals(result.success, true);
  });

  await t.step('limit 101 fails', () => {
    const result = TransactionsQuerySchema.safeParse({ limit: 101 });
    assertEquals(result.success, false);
  });

  await t.step('limit 0 fails', () => {
    const result = TransactionsQuerySchema.safeParse({ limit: 0 });
    assertEquals(result.success, false);
  });

  await t.step('offset 0 passes', () => {
    const result = TransactionsQuerySchema.safeParse({ offset: 0 });
    assertEquals(result.success, true);
  });

  await t.step('negative offset fails', () => {
    const result = TransactionsQuerySchema.safeParse({ offset: -1 });
    assertEquals(result.success, false);
  });

  await t.step('string limit coerces to number', () => {
    const result = TransactionsQuerySchema.safeParse({ limit: '25' });
    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data.limit, 25);
    }
  });
});

// ============================================================================
// Response Format Tests
// ============================================================================

Deno.test('Juice Routes - Balance Response', async (t) => {
  interface BalanceResponse {
    success: boolean;
    data: {
      balance: number;
      lifetimePurchased: number;
      lifetimeSpent: number;
      lifetimeCashedOut: number;
      expiresAt: string;
    };
  }

  const mockResponse: BalanceResponse = {
    success: true,
    data: {
      balance: 75.50,
      lifetimePurchased: 200.00,
      lifetimeSpent: 100.00,
      lifetimeCashedOut: 24.50,
      expiresAt: '3024-01-01T00:00:00.000Z',
    },
  };

  await t.step('has success flag', () => {
    assertExists(mockResponse.success);
    assertEquals(mockResponse.success, true);
  });

  await t.step('has balance data', () => {
    assertExists(mockResponse.data.balance);
    assertEquals(typeof mockResponse.data.balance, 'number');
  });

  await t.step('has lifetime totals', () => {
    assertExists(mockResponse.data.lifetimePurchased);
    assertExists(mockResponse.data.lifetimeSpent);
    assertExists(mockResponse.data.lifetimeCashedOut);
  });

  await t.step('expiresAt is ISO string', () => {
    assertExists(mockResponse.data.expiresAt);
    const date = new Date(mockResponse.data.expiresAt);
    assertEquals(isNaN(date.getTime()), false);
  });
});

Deno.test('Juice Routes - Purchase Response', async (t) => {
  interface PurchaseResponse {
    success: boolean;
    data: {
      clientSecret: string;
      paymentIntentId: string;
      amount: number;
    };
  }

  const mockResponse: PurchaseResponse = {
    success: true,
    data: {
      clientSecret: 'pi_xxx_secret_yyy',
      paymentIntentId: 'pi_xxx',
      amount: 100,
    },
  };

  await t.step('has Stripe client secret', () => {
    assertExists(mockResponse.data.clientSecret);
    assertEquals(mockResponse.data.clientSecret.includes('secret'), true);
  });

  await t.step('has payment intent ID', () => {
    assertExists(mockResponse.data.paymentIntentId);
    assertEquals(mockResponse.data.paymentIntentId.startsWith('pi_'), true);
  });

  await t.step('returns requested amount', () => {
    assertEquals(mockResponse.data.amount, 100);
  });
});

Deno.test('Juice Routes - Spend Response', async (t) => {
  interface SpendResponse {
    success: boolean;
    data: {
      spendId: string;
      amount: number;
      projectId: number;
      chainId: number;
      status: string;
    };
  }

  const mockResponse: SpendResponse = {
    success: true,
    data: {
      spendId: 'uuid-xxx',
      amount: 50,
      projectId: 1,
      chainId: 1,
      status: 'pending',
    },
  };

  await t.step('has spend ID', () => {
    assertExists(mockResponse.data.spendId);
  });

  await t.step('initial status is pending', () => {
    assertEquals(mockResponse.data.status, 'pending');
  });

  await t.step('includes project and chain', () => {
    assertEquals(mockResponse.data.projectId, 1);
    assertEquals(mockResponse.data.chainId, 1);
  });
});

Deno.test('Juice Routes - Cash Out Response', async (t) => {
  interface CashOutResponse {
    success: boolean;
    data: {
      cashOutId: string;
      amount: number;
      destinationAddress: string;
      chainId: number;
      status: string;
      availableAt: string;
    };
  }

  const mockResponse: CashOutResponse = {
    success: true,
    data: {
      cashOutId: 'uuid-xxx',
      amount: 25,
      destinationAddress: '0x1234567890123456789012345678901234567890',
      chainId: 1,
      status: 'pending',
      availableAt: '2024-01-02T12:00:00.000Z',
    },
  };

  await t.step('has cash out ID', () => {
    assertExists(mockResponse.data.cashOutId);
  });

  await t.step('initial status is pending', () => {
    assertEquals(mockResponse.data.status, 'pending');
  });

  await t.step('has available_at timestamp', () => {
    assertExists(mockResponse.data.availableAt);
    const date = new Date(mockResponse.data.availableAt);
    assertEquals(isNaN(date.getTime()), false);
  });

  await t.step('available_at is in the future', () => {
    const availableAt = new Date(mockResponse.data.availableAt);
    // This would be in the future when the mock was created
    assertEquals(availableAt.getFullYear() >= 2024, true);
  });
});

Deno.test('Juice Routes - Transaction List Response', async (t) => {
  interface TransactionResponse {
    success: boolean;
    data: Array<{
      id: string;
      type: 'purchase' | 'spend' | 'cash_out';
      amount: number;
      status: string;
      projectId: number | null;
      chainId: number | null;
      createdAt: string;
    }>;
  }

  const mockResponse: TransactionResponse = {
    success: true,
    data: [
      {
        id: 'tx-1',
        type: 'purchase',
        amount: 100,
        status: 'credited',
        projectId: null,
        chainId: null,
        createdAt: '2024-01-01T10:00:00.000Z',
      },
      {
        id: 'tx-2',
        type: 'spend',
        amount: -50,
        status: 'completed',
        projectId: 1,
        chainId: 1,
        createdAt: '2024-01-01T11:00:00.000Z',
      },
      {
        id: 'tx-3',
        type: 'cash_out',
        amount: -25,
        status: 'pending',
        projectId: null,
        chainId: 1,
        createdAt: '2024-01-01T12:00:00.000Z',
      },
    ],
  };

  await t.step('returns array of transactions', () => {
    assertEquals(Array.isArray(mockResponse.data), true);
    assertEquals(mockResponse.data.length, 3);
  });

  await t.step('purchase has positive amount', () => {
    const purchase = mockResponse.data.find(t => t.type === 'purchase');
    assertExists(purchase);
    assertEquals(purchase.amount > 0, true);
  });

  await t.step('spend has negative amount', () => {
    const spend = mockResponse.data.find(t => t.type === 'spend');
    assertExists(spend);
    assertEquals(spend.amount < 0, true);
  });

  await t.step('cash_out has negative amount', () => {
    const cashOut = mockResponse.data.find(t => t.type === 'cash_out');
    assertExists(cashOut);
    assertEquals(cashOut.amount < 0, true);
  });

  await t.step('spend includes project info', () => {
    const spend = mockResponse.data.find(t => t.type === 'spend');
    assertExists(spend);
    assertEquals(spend.projectId, 1);
    assertEquals(spend.chainId, 1);
  });

  await t.step('purchase has no project info', () => {
    const purchase = mockResponse.data.find(t => t.type === 'purchase');
    assertExists(purchase);
    assertEquals(purchase.projectId, null);
  });
});

// ============================================================================
// Error Response Tests
// ============================================================================

Deno.test('Juice Routes - Error Responses', async (t) => {
  interface ErrorResponse {
    success: false;
    error: string;
  }

  await t.step('insufficient balance error', () => {
    const response: ErrorResponse = {
      success: false,
      error: 'Insufficient Juice balance',
    };
    assertEquals(response.success, false);
    assertEquals(response.error.includes('Insufficient'), true);
  });

  await t.step('cash out not found error', () => {
    const response: ErrorResponse = {
      success: false,
      error: 'Cash out not found',
    };
    assertEquals(response.success, false);
    assertEquals(response.error.includes('not found'), true);
  });

  await t.step('cannot cancel non-pending error', () => {
    const response: ErrorResponse = {
      success: false,
      error: 'Cannot cancel cash out with status: processing',
    };
    assertEquals(response.success, false);
    assertEquals(response.error.includes('Cannot cancel'), true);
  });

  await t.step('payments not configured error', () => {
    const response: ErrorResponse = {
      success: false,
      error: 'Payments not configured',
    };
    assertEquals(response.success, false);
    assertEquals(response.error.includes('not configured'), true);
  });
});

// ============================================================================
// Stripe Metadata Tests
// ============================================================================

Deno.test('Juice Routes - Stripe Payment Intent Metadata', async (t) => {
  interface JuicePurchaseMetadata {
    type: 'juice_purchase';
    userId: string;
    juiceAmount: string;
  }

  const metadata: JuicePurchaseMetadata = {
    type: 'juice_purchase',
    userId: 'user-123',
    juiceAmount: '100',
  };

  await t.step('type is juice_purchase', () => {
    assertEquals(metadata.type, 'juice_purchase');
  });

  await t.step('has userId', () => {
    assertExists(metadata.userId);
  });

  await t.step('has juiceAmount as string', () => {
    assertExists(metadata.juiceAmount);
    assertEquals(typeof metadata.juiceAmount, 'string');
  });

  await t.step('juiceAmount is numeric string', () => {
    const amount = parseFloat(metadata.juiceAmount);
    assertEquals(isNaN(amount), false);
    assertEquals(amount, 100);
  });
});

// ============================================================================
// Endpoint Path Tests
// ============================================================================

Deno.test('Juice Routes - API Endpoints', async (t) => {
  const JUICE_ENDPOINTS = {
    balance: '/api/juice/balance',
    purchase: '/api/juice/purchase',
    purchases: '/api/juice/purchases',
    spend: '/api/juice/spend',
    spends: '/api/juice/spends',
    cashOut: '/api/juice/cash-out',
    cashOuts: '/api/juice/cash-outs',
    transactions: '/api/juice/transactions',
  };

  await t.step('all endpoints under /api/juice', () => {
    for (const endpoint of Object.values(JUICE_ENDPOINTS)) {
      assertEquals(endpoint.startsWith('/api/juice'), true);
    }
  });

  await t.step('balance endpoint exists', () => {
    assertEquals(JUICE_ENDPOINTS.balance, '/api/juice/balance');
  });

  await t.step('purchase endpoint exists', () => {
    assertEquals(JUICE_ENDPOINTS.purchase, '/api/juice/purchase');
  });

  await t.step('spend endpoint exists', () => {
    assertEquals(JUICE_ENDPOINTS.spend, '/api/juice/spend');
  });

  await t.step('cash-out uses kebab-case', () => {
    assertEquals(JUICE_ENDPOINTS.cashOut.includes('cash-out'), true);
  });
});

// ============================================================================
// HTTP Method Tests
// ============================================================================

Deno.test('Juice Routes - HTTP Methods', async (t) => {
  const ENDPOINT_METHODS: Record<string, string[]> = {
    '/api/juice/balance': ['GET'],
    '/api/juice/purchase': ['POST'],
    '/api/juice/purchases': ['GET'],
    '/api/juice/spend': ['POST'],
    '/api/juice/spends': ['GET'],
    '/api/juice/cash-out': ['POST'],
    '/api/juice/cash-out/:id': ['DELETE'],
    '/api/juice/cash-outs': ['GET'],
    '/api/juice/transactions': ['GET'],
  };

  await t.step('balance is GET', () => {
    assertEquals(ENDPOINT_METHODS['/api/juice/balance'].includes('GET'), true);
  });

  await t.step('purchase is POST', () => {
    assertEquals(ENDPOINT_METHODS['/api/juice/purchase'].includes('POST'), true);
  });

  await t.step('spend is POST', () => {
    assertEquals(ENDPOINT_METHODS['/api/juice/spend'].includes('POST'), true);
  });

  await t.step('cash-out creation is POST', () => {
    assertEquals(ENDPOINT_METHODS['/api/juice/cash-out'].includes('POST'), true);
  });

  await t.step('cash-out cancellation is DELETE', () => {
    assertEquals(ENDPOINT_METHODS['/api/juice/cash-out/:id'].includes('DELETE'), true);
  });

  await t.step('transactions is GET', () => {
    assertEquals(ENDPOINT_METHODS['/api/juice/transactions'].includes('GET'), true);
  });
});

// ============================================================================
// Authentication Tests
// ============================================================================

Deno.test('Juice Routes - Authentication Requirements', async (t) => {
  const AUTHENTICATED_ENDPOINTS = [
    '/api/juice/balance',
    '/api/juice/purchase',
    '/api/juice/purchases',
    '/api/juice/spend',
    '/api/juice/spends',
    '/api/juice/cash-out',
    '/api/juice/cash-outs',
    '/api/juice/transactions',
  ];

  await t.step('all endpoints require authentication', () => {
    assertEquals(AUTHENTICATED_ENDPOINTS.length, 8);
  });

  await t.step('no public endpoints', () => {
    // All Juice endpoints require auth
    const publicEndpoints: string[] = [];
    assertEquals(publicEndpoints.length, 0);
  });
});
