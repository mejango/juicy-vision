import { assertEquals } from 'std/assert/mod.ts';
import { getClientIdentifier, shouldFailRateLimitClosed } from './rateLimit.ts';

Deno.test('production cost-bearing rate limits fail closed', () => {
  for (
    const key of [
      'aiInvoke',
      'imageGenerate',
      'juicePurchase',
      'juiceSpend',
      'juiceCashOut',
      'terminalPay',
      'toolPinToIpfs',
    ] as const
  ) {
    assertEquals(shouldFailRateLimitClosed(key, 'production'), true);
    assertEquals(shouldFailRateLimitClosed(key, 'development'), false);
  }
  assertEquals(shouldFailRateLimitClosed('chat', 'production'), false);
});

Deno.test('forwarding headers are ignored unless a trusted proxy is explicit', () => {
  const context = {
    req: {
      header(name: string) {
        if (name.toLowerCase() === 'x-forwarded-for') return '203.0.113.10, 10.0.0.1';
        if (name.toLowerCase() === 'cf-connecting-ip') return '198.51.100.20';
        return undefined;
      },
    },
    env: { remoteAddr: { hostname: '192.0.2.30' } },
  };

  assertEquals(getClientIdentifier(context, false), '192.0.2.30');
  assertEquals(getClientIdentifier(context, true), '198.51.100.20');
});
