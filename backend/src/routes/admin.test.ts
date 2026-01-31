import { assertEquals } from 'std/assert/mod.ts';
import { z } from 'zod';

// ============================================================================
// Admin Juice API Schema Tests
// ============================================================================

Deno.test('Admin Juice Routes - Pending Spends Query Schema', async (t) => {
  const PendingSpendsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    status: z.enum(['pending', 'executing', 'completed', 'failed', 'refunded']).optional(),
  });

  await t.step('valid query params pass', () => {
    const result = PendingSpendsQuerySchema.safeParse({ page: 1, limit: 50, status: 'pending' });
    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data.page, 1);
      assertEquals(result.data.limit, 50);
      assertEquals(result.data.status, 'pending');
    }
  });

  await t.step('default values applied when missing', () => {
    const result = PendingSpendsQuerySchema.safeParse({});
    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data.page, 1);
      assertEquals(result.data.limit, 50);
      assertEquals(result.data.status, undefined);
    }
  });

  await t.step('string page coerces to number', () => {
    const result = PendingSpendsQuerySchema.safeParse({ page: '2', limit: '25' });
    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data.page, 2);
      assertEquals(result.data.limit, 25);
    }
  });

  await t.step('page 0 fails minimum check', () => {
    const result = PendingSpendsQuerySchema.safeParse({ page: 0 });
    assertEquals(result.success, false);
  });

  await t.step('limit 101 fails maximum check', () => {
    const result = PendingSpendsQuerySchema.safeParse({ limit: 101 });
    assertEquals(result.success, false);
  });

  await t.step('invalid status fails enum check', () => {
    const result = PendingSpendsQuerySchema.safeParse({ status: 'invalid' });
    assertEquals(result.success, false);
  });

  await t.step('all valid status values pass', () => {
    const statuses = ['pending', 'executing', 'completed', 'failed', 'refunded'];
    for (const status of statuses) {
      const result = PendingSpendsQuerySchema.safeParse({ status });
      assertEquals(result.success, true, `Status '${status}' should be valid`);
    }
  });
});

Deno.test('Admin Juice Routes - Spend Response Structure', async (t) => {
  // Response structure validation schema
  const SpendResponseSchema = z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    userEmail: z.string().email().nullable(),
    projectId: z.number().int().positive(),
    chainId: z.number().int().positive(),
    beneficiaryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    memo: z.string().nullable(),
    juiceAmount: z.number().positive(),
    cryptoAmount: z.string().nullable(),
    ethUsdRate: z.number().positive().nullable(),
    status: z.enum(['pending', 'executing', 'completed', 'failed', 'refunded']),
    txHash: z.string().nullable(),
    tokensReceived: z.string().nullable(),
    errorMessage: z.string().nullable(),
    retryCount: z.number().int().min(0),
    lastRetryAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  });

  const validSpend = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    userId: '123e4567-e89b-12d3-a456-426614174001',
    userEmail: 'user@example.com',
    projectId: 1,
    chainId: 42161,
    beneficiaryAddress: '0x1234567890123456789012345678901234567890',
    memo: 'Test payment',
    juiceAmount: 50.0,
    cryptoAmount: null,
    ethUsdRate: null,
    status: 'pending' as const,
    txHash: null,
    tokensReceived: null,
    errorMessage: null,
    retryCount: 0,
    lastRetryAt: null,
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
  };

  await t.step('valid spend response passes', () => {
    const result = SpendResponseSchema.safeParse(validSpend);
    assertEquals(result.success, true);
  });

  await t.step('completed spend with txHash passes', () => {
    const completedSpend = {
      ...validSpend,
      status: 'completed' as const,
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      cryptoAmount: '15000000000000000',
      ethUsdRate: 3333.33,
      tokensReceived: '50000000000000000000',
    };
    const result = SpendResponseSchema.safeParse(completedSpend);
    assertEquals(result.success, true);
  });

  await t.step('failed spend with error message passes', () => {
    const failedSpend = {
      ...validSpend,
      status: 'failed' as const,
      errorMessage: 'Insufficient gas',
      retryCount: 3,
      lastRetryAt: '2024-01-15T11:00:00.000Z',
    };
    const result = SpendResponseSchema.safeParse(failedSpend);
    assertEquals(result.success, true);
  });

  await t.step('null userEmail passes', () => {
    const result = SpendResponseSchema.safeParse({ ...validSpend, userEmail: null });
    assertEquals(result.success, true);
  });
});

Deno.test('Admin Juice Routes - Stats Response Structure', async (t) => {
  const StatsResponseSchema = z.object({
    pending: z.object({
      count: z.number().int().min(0),
      totalUsd: z.number().min(0),
    }),
    executing: z.object({
      count: z.number().int().min(0),
    }),
    today: z.object({
      completedCount: z.number().int().min(0),
      completedUsd: z.number().min(0),
    }),
    week: z.object({
      completedCount: z.number().int().min(0),
      completedUsd: z.number().min(0),
    }),
    failed: z.object({
      count: z.number().int().min(0),
    }),
  });

  const validStats = {
    pending: { count: 5, totalUsd: 250.50 },
    executing: { count: 1 },
    today: { completedCount: 10, completedUsd: 500.00 },
    week: { completedCount: 50, completedUsd: 2500.00 },
    failed: { count: 2 },
  };

  await t.step('valid stats response passes', () => {
    const result = StatsResponseSchema.safeParse(validStats);
    assertEquals(result.success, true);
  });

  await t.step('zero counts pass', () => {
    const emptyStats = {
      pending: { count: 0, totalUsd: 0 },
      executing: { count: 0 },
      today: { completedCount: 0, completedUsd: 0 },
      week: { completedCount: 0, completedUsd: 0 },
      failed: { count: 0 },
    };
    const result = StatsResponseSchema.safeParse(emptyStats);
    assertEquals(result.success, true);
  });

  await t.step('negative count fails', () => {
    const invalidStats = { ...validStats, pending: { count: -1, totalUsd: 0 } };
    const result = StatsResponseSchema.safeParse(invalidStats);
    assertEquals(result.success, false);
  });
});

Deno.test('Admin Juice Routes - Process Spend Response Structure', async (t) => {
  const ProcessSpendResponseSchema = z.object({
    spendId: z.string().uuid(),
    status: z.enum(['completed', 'failed']),
    txHash: z.string().optional(),
    error: z.string().optional(),
  });

  await t.step('successful process response passes', () => {
    const successResponse = {
      spendId: '123e4567-e89b-12d3-a456-426614174000',
      status: 'completed' as const,
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    };
    const result = ProcessSpendResponseSchema.safeParse(successResponse);
    assertEquals(result.success, true);
  });

  await t.step('failed process response passes', () => {
    const failResponse = {
      spendId: '123e4567-e89b-12d3-a456-426614174000',
      status: 'failed' as const,
      error: 'Transaction reverted: insufficient funds',
    };
    const result = ProcessSpendResponseSchema.safeParse(failResponse);
    assertEquals(result.success, true);
  });
});
