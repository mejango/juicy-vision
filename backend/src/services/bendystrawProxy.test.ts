import { assertEquals } from 'std/assert/mod.ts';
import registry from '@shared/bendystraw-operation-registry.json' with { type: 'json' };
import { bendystrawProxyHost, resolveBendystrawProxyRequest } from './bendystrawProxy.ts';

Deno.test('Bendystraw proxy accepts only persisted operations with bounded request shape', () => {
  const [operation, query] = Object.entries(registry)[0];
  assertEquals(
    resolveBendystrawProxyRequest({ operation, variables: { chainId: 8453 } }),
    { query, variables: { chainId: 8453 } },
  );
  assertEquals(
    resolveBendystrawProxyRequest({
      operation,
      variables: {},
      query: 'query Attacker { projects { totalCount } }',
    }),
    null,
  );
  assertEquals(resolveBendystrawProxyRequest({ operation: '0'.repeat(64), variables: {} }), null);
  assertEquals(resolveBendystrawProxyRequest({ operation, variables: [] }), null);
});

Deno.test('Bendystraw proxy requires an explicit supported network', () => {
  assertEquals(bendystrawProxyHost('mainnet'), 'bendystraw.xyz');
  assertEquals(bendystrawProxyHost('testnet'), 'testnet.bendystraw.xyz');
  assertEquals(bendystrawProxyHost(undefined), null);
  assertEquals(bendystrawProxyHost('staging'), null);
});
