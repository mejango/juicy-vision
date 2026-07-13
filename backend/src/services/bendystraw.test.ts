import { assertEquals, assertRejects, assertThrows } from 'std/assert/mod.ts';
import {
  bendystrawEndpointForChain,
  bendystrawHostForChain,
  participantHasPaymentVolume,
  resolveProjectMetadataForDisplay,
  USER_PARTICIPANT_QUERY,
} from './bendystraw.ts';
import { SUCKER_TRANSACTIONS_QUERY } from './omnichain.ts';

Deno.test('Bendystraw endpoint follows the requested chain network', () => {
  assertEquals(bendystrawHostForChain(1), 'bendystraw.xyz');
  assertEquals(bendystrawHostForChain(84532), 'testnet.bendystraw.xyz');
  assertEquals(
    bendystrawEndpointForChain('key', 421614),
    'https://testnet.bendystraw.xyz/key/graphql',
  );
  assertThrows(() => bendystrawHostForChain(999), Error, 'Unsupported Bendystraw chain');
  assertThrows(() => bendystrawEndpointForChain('', 1), Error, 'not configured');
});

Deno.test('embedded Bendystraw metadata is primary and indexed columns fill gaps', async () => {
  const result = await resolveProjectMetadataForDisplay({
    indexedMetadata: JSON.stringify({ name: 'Embedded', storeCategories: { 2: 'Merch' } }),
    indexedFields: {
      name: 'Column name',
      description: 'Indexed description',
      tags: ['public-goods'],
    },
    indexedMetadataUri: 'ipfs://QmYwAPJzv5CZsnAzt8auVZRnGfQWPn8iCq8M4HfYJ7zXkA',
    fetchMetadata: () => {
      throw new Error('embedded metadata should not be fetched again');
    },
  });

  assertEquals(result.source, 'bendystraw');
  assertEquals(result.metadata?.name, 'Embedded');
  assertEquals(result.metadata?.description, 'Indexed description');
  assertEquals(result.metadata?.tags, ['public-goods']);
  assertEquals(result.metadata?.storeCategories, { 2: 'Merch' });
});

Deno.test('empty embedded metadata fetches the indexed URI before controller fallback', async () => {
  const fetched: string[] = [];
  const result = await resolveProjectMetadataForDisplay({
    indexedMetadata: {},
    indexedFields: { name: 'Indexed column' },
    indexedMetadataUri: 'ipfs://bafyindexedmetadata',
    loadOnchainMetadataUri: () => Promise.resolve('ipfs://bafyonchainmetadata'),
    fetchMetadata: (uri) => {
      fetched.push(uri);
      return Promise.resolve(
        uri.includes('indexed') ? { name: 'Indexed URI', description: 'Current index' } : null,
      );
    },
  });

  assertEquals(fetched, ['ipfs://bafyindexedmetadata']);
  assertEquals(result.source, 'bendystraw');
  assertEquals(result.metadata?.name, 'Indexed URI');
  assertEquals(result.metadata?.description, 'Current index');
});

Deno.test('controller metadata fills only missing indexed display fields', async () => {
  const result = await resolveProjectMetadataForDisplay({
    indexedMetadata: null,
    indexedFields: { name: 'Indexed name' },
    loadOnchainMetadataUri: () => Promise.resolve('ipfs://bafyonchainmetadata'),
    fetchMetadata: () =>
      Promise.resolve({ name: 'Controller name', description: 'Controller description' }),
  });

  assertEquals(result.source, 'bendystraw');
  assertEquals(result.metadata?.name, 'Indexed name');
  assertEquals(result.metadata?.description, 'Controller description');
});

Deno.test('malformed known metadata fields are not exposed as display values', async () => {
  const result = await resolveProjectMetadataForDisplay({
    indexedMetadata: {
      name: { unsafe: true },
      description: 123,
      tags: ['valid', 4, null],
      storeCategories: { 1: 'Tickets', 2: { unsafe: true } },
    },
  });

  assertEquals(result.metadata?.name, undefined);
  assertEquals(result.metadata?.description, undefined);
  assertEquals(result.metadata?.tags, ['valid']);
  assertEquals(result.metadata?.storeCategories, { 1: 'Tickets' });
});

Deno.test('metadata resolver surfaces a failing required loader', async () => {
  await assertRejects(
    () =>
      resolveProjectMetadataForDisplay({
        indexedMetadata: null,
        loadOnchainMetadataUri: () => Promise.reject(new Error('controller read failed')),
      }),
    Error,
    'controller read failed',
  );
});

Deno.test('participant payment gating distinguishes verified zero from unavailable', () => {
  assertEquals(participantHasPaymentVolume('0'), false);
  assertEquals(participantHasPaymentVolume('1'), true);
  assertThrows(
    () => participantHasPaymentVolume(undefined),
    Error,
    'payment volume is unavailable',
  );
});

Deno.test('supporter verification query uses only current participant fields', () => {
  assertEquals(USER_PARTICIPANT_QUERY.includes('version: 6'), true);
  assertEquals(USER_PARTICIPANT_QUERY.includes('\n        volume\n'), true);
  assertEquals(USER_PARTICIPANT_QUERY.includes('\n        id\n'), false);
  assertEquals(USER_PARTICIPANT_QUERY.includes('stakedBalance'), false);
});

Deno.test('bridge transaction query uses only current sucker transaction fields', () => {
  assertEquals(SUCKER_TRANSACTIONS_QUERY.includes('version: 6'), true);
  assertEquals(SUCKER_TRANSACTIONS_QUERY.includes('\n        id\n'), false);
  assertEquals(SUCKER_TRANSACTIONS_QUERY.includes('projectTokenCount'), true);
});
