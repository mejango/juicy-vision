import { assertEquals } from 'std/assert/mod.ts';
import {
  UserSchema,
  SessionSchema,
  WalletBalanceSchema,
  TransferRequestSchema,
  PendingTransferSchema,
  ChatMessageSchema,
  ChatSessionSchema,
  PrivacyModes,
} from './index.ts';

Deno.test('UserSchema', async (t) => {
  await t.step('validates a complete user', () => {
    const user = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      email: 'test@example.com',
      emailVerified: true,
      privacyMode: 'open_book',
      custodialAddressIndex: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = UserSchema.safeParse(user);
    assertEquals(result.success, true);
  });

  await t.step('validates user without optional fields', () => {
    const user = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      email: 'test@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = UserSchema.safeParse(user);
    assertEquals(result.success, true);
  });

  await t.step('rejects invalid UUID', () => {
    const user = {
      id: 'not-a-uuid',
      email: 'test@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = UserSchema.safeParse(user);
    assertEquals(result.success, false);
  });

  await t.step('rejects invalid email', () => {
    const user = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      email: 'not-an-email',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = UserSchema.safeParse(user);
    assertEquals(result.success, false);
  });

  await t.step('validates all privacy modes', () => {
    const modes = ['open_book', 'anonymous', 'private', 'ghost'];
    for (const mode of modes) {
      const user = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'test@example.com',
        privacyMode: mode,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = UserSchema.safeParse(user);
      assertEquals(result.success, true, `Privacy mode ${mode} should be valid`);
    }
  });
});

Deno.test('SessionSchema', async (t) => {
  await t.step('validates a complete session', () => {
    const session = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      userId: '123e4567-e89b-12d3-a456-426614174001',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    };

    const result = SessionSchema.safeParse(session);
    assertEquals(result.success, true);
  });

  await t.step('rejects missing userId', () => {
    const session = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    };

    const result = SessionSchema.safeParse(session);
    assertEquals(result.success, false);
  });
});

Deno.test('WalletBalanceSchema', async (t) => {
  await t.step('validates ETH balance', () => {
    const balance = {
      chainId: 1,
      tokenAddress: '0x0000000000000000000000000000000000000000',
      tokenSymbol: 'ETH',
      tokenDecimals: 18,
      balance: '1000000000000000000',
      isProjectToken: false,
    };

    const result = WalletBalanceSchema.safeParse(balance);
    assertEquals(result.success, true);
  });

  await t.step('validates project token balance', () => {
    const balance = {
      chainId: 1,
      tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      tokenSymbol: 'USDC',
      tokenDecimals: 6,
      balance: '1000000',
      isProjectToken: true,
      projectId: 42,
    };

    const result = WalletBalanceSchema.safeParse(balance);
    assertEquals(result.success, true);
  });

  await t.step('validates all supported chain IDs', () => {
    const chainIds = [1, 10, 8453, 42161];
    for (const chainId of chainIds) {
      const balance = {
        chainId,
        tokenAddress: '0x0',
        tokenSymbol: 'ETH',
        tokenDecimals: 18,
        balance: '0',
        isProjectToken: false,
      };

      const result = WalletBalanceSchema.safeParse(balance);
      assertEquals(result.success, true, `Chain ID ${chainId} should be valid`);
    }
  });
});

Deno.test('TransferRequestSchema', async (t) => {
  await t.step('validates valid transfer request', () => {
    const transfer = {
      chainId: 1,
      tokenAddress: '0x0000000000000000000000000000000000000000',
      amount: '1000000000000000000',
      toAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fBdf',
    };

    const result = TransferRequestSchema.safeParse(transfer);
    assertEquals(result.success, true);
  });

  await t.step('rejects invalid to address', () => {
    const transfer = {
      chainId: 1,
      tokenAddress: '0x0',
      amount: '1000000000000000000',
      toAddress: 'not-an-address',
    };

    const result = TransferRequestSchema.safeParse(transfer);
    assertEquals(result.success, false);
  });

  await t.step('rejects to address without 0x prefix', () => {
    const transfer = {
      chainId: 1,
      tokenAddress: '0x0',
      amount: '1000000000000000000',
      toAddress: '742d35Cc6634C0532925a3b844Bc9e7595f8fBdf',
    };

    const result = TransferRequestSchema.safeParse(transfer);
    assertEquals(result.success, false);
  });
});

Deno.test('PendingTransferSchema', async (t) => {
  await t.step('validates pending transfer', () => {
    const transfer = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      userId: '123e4567-e89b-12d3-a456-426614174001',
      chainId: 1,
      tokenAddress: '0x0',
      tokenSymbol: 'ETH',
      amount: '1000000000000000000',
      toAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fBdf',
      createdAt: new Date(),
      availableAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: 'pending',
    };

    const result = PendingTransferSchema.safeParse(transfer);
    assertEquals(result.success, true);
  });

  await t.step('validates all status values', () => {
    const statuses = ['pending', 'ready', 'executed', 'cancelled'];
    for (const status of statuses) {
      const transfer = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        userId: '123e4567-e89b-12d3-a456-426614174001',
        chainId: 1,
        tokenAddress: '0x0',
        tokenSymbol: 'ETH',
        amount: '0',
        toAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fBdf',
        createdAt: new Date(),
        availableAt: new Date(),
        status,
      };

      const result = PendingTransferSchema.safeParse(transfer);
      assertEquals(result.success, true, `Status ${status} should be valid`);
    }
  });

  await t.step('validates executed transfer with txHash', () => {
    const transfer = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      userId: '123e4567-e89b-12d3-a456-426614174001',
      chainId: 1,
      tokenAddress: '0x0',
      tokenSymbol: 'ETH',
      amount: '0',
      toAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fBdf',
      createdAt: new Date(),
      availableAt: new Date(),
      status: 'executed',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    };

    const result = PendingTransferSchema.safeParse(transfer);
    assertEquals(result.success, true);
  });
});

Deno.test('ChatMessageSchema', async (t) => {
  await t.step('validates user message', () => {
    const message = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      sessionId: '123e4567-e89b-12d3-a456-426614174001',
      role: 'user',
      content: 'Hello!',
      timestamp: new Date(),
    };

    const result = ChatMessageSchema.safeParse(message);
    assertEquals(result.success, true);
  });

  await t.step('validates assistant message with tool calls', () => {
    const message = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      sessionId: '123e4567-e89b-12d3-a456-426614174001',
      role: 'assistant',
      content: 'Here is the project info...',
      timestamp: new Date(),
      toolCalls: [
        {
          tool: 'get_project',
          input: { projectId: 42, chainId: 1 },
          output: { name: 'Test Project' },
          success: true,
          latencyMs: 150,
        },
      ],
    };

    const result = ChatMessageSchema.safeParse(message);
    assertEquals(result.success, true);
  });

  await t.step('validates message with feedback', () => {
    const message = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      sessionId: '123e4567-e89b-12d3-a456-426614174001',
      role: 'assistant',
      content: 'Response...',
      timestamp: new Date(),
      feedback: {
        helpful: true,
        reported: false,
      },
    };

    const result = ChatMessageSchema.safeParse(message);
    assertEquals(result.success, true);
  });

  await t.step('validates all role values', () => {
    const roles = ['user', 'assistant', 'system'];
    for (const role of roles) {
      const message = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        sessionId: '123e4567-e89b-12d3-a456-426614174001',
        role,
        content: 'Message',
        timestamp: new Date(),
      };

      const result = ChatMessageSchema.safeParse(message);
      assertEquals(result.success, true, `Role ${role} should be valid`);
    }
  });
});

Deno.test('ChatSessionSchema', async (t) => {
  await t.step('validates complete chat session', () => {
    const session = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      userId: '123e4567-e89b-12d3-a456-426614174001',
      startedAt: new Date(),
      privacyMode: 'open_book',
      walletConnected: true,
      mode: 'self_custody',
    };

    const result = ChatSessionSchema.safeParse(session);
    assertEquals(result.success, true);
  });

  await t.step('validates anonymous session (null userId)', () => {
    const session = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      userId: null,
      startedAt: new Date(),
      privacyMode: 'ghost',
      walletConnected: false,
      mode: 'self_custody',
    };

    const result = ChatSessionSchema.safeParse(session);
    assertEquals(result.success, true);
  });

  await t.step('validates session with outcome', () => {
    const session = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      userId: '123e4567-e89b-12d3-a456-426614174001',
      startedAt: new Date(),
      endedAt: new Date(),
      privacyMode: 'open_book',
      walletConnected: true,
      mode: 'managed',
      outcome: {
        completedPayment: true,
        foundProject: true,
        connectedWallet: true,
        errorEncountered: false,
        userAbandoned: false,
      },
      sessionRating: 5,
      sessionFeedback: 'Great experience!',
    };

    const result = ChatSessionSchema.safeParse(session);
    assertEquals(result.success, true);
  });

  await t.step('validates session mode values', () => {
    const modes = ['self_custody', 'managed'];
    for (const mode of modes) {
      const session = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        userId: null,
        startedAt: new Date(),
        privacyMode: 'open_book',
        walletConnected: false,
        mode,
      };

      const result = ChatSessionSchema.safeParse(session);
      assertEquals(result.success, true, `Mode ${mode} should be valid`);
    }
  });
});

Deno.test('PrivacyModes constants', async (t) => {
  await t.step('open_book stores everything', () => {
    const mode = PrivacyModes.open_book;
    assertEquals(mode.storeChat, true);
    assertEquals(mode.storeAnalytics, true);
    assertEquals(mode.includeInTraining, true);
    assertEquals(mode.stripIdentity, false);
  });

  await t.step('anonymous strips identity', () => {
    const mode = PrivacyModes.anonymous;
    assertEquals(mode.storeChat, true);
    assertEquals(mode.includeInTraining, true);
    assertEquals(mode.stripIdentity, true);
  });

  await t.step('private does not store chat', () => {
    const mode = PrivacyModes.private;
    assertEquals(mode.storeChat, false);
    assertEquals(mode.includeInTraining, false);
  });

  await t.step('ghost stores nothing', () => {
    const mode = PrivacyModes.ghost;
    assertEquals(mode.storeChat, false);
    assertEquals(mode.storeAnalytics, false);
    assertEquals(mode.includeInTraining, false);
  });
});
