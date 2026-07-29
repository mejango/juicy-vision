import { assertEquals, assertRejects } from 'std/assert/mod.ts';
import { assertDagPbCid, IpfsClient } from './ipfs.ts';

const CID_V0 = 'Qmb7EZvTHUeVTDi6YmwDFQvKEfCR4UGciUka24coJcNJzS';
const DAG_PB_CID_V1 = 'bafybeif5xakuko65fh226ynfihtdqlt2vtuga5vjxi6kh5vtxx34lcvcp4';
const RAW_CID_V1 = 'bafkreif5xakuko65fh226ynfihtdqlt2vtuga5vjxi6kh5vtxx34lcvcp4';

Deno.test('metadata pinning accepts only DAG-PB compatible CIDs', async () => {
  assertDagPbCid(CID_V0);
  assertDagPbCid(DAG_PB_CID_V1);
  await assertRejects(
    () => Promise.resolve().then(() => assertDagPbCid(RAW_CID_V1)),
    Error,
    'not a DAG-PB',
  );
});

Deno.test('pinning uploads to Filebase and replicates the exact CID to Pinata', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; authorization: string | null; body: BodyInit | null }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      authorization: headers.get('authorization'),
      body: init?.body ?? null,
    });
    return Promise.resolve(
      url.startsWith('https://rpc.filebase.io/')
        ? Response.json({ Hash: CID_V0, Size: '12' })
        : Response.json({ data: { cid: CID_V0, status: 'prechecking' } }),
    );
  }) as typeof fetch;

  try {
    const client = new IpfsClient({
      enabled: true,
      filebaseToken: 'filebase-token',
      pinataJwt: 'pinata-jwt',
    });
    const result = await client.pinJson({ name: 'Juicy' }, 'project.json');
    assertEquals(result.cid, CID_V0);
    assertEquals(calls.length, 2);
    assertEquals(
      calls[0].url,
      'https://rpc.filebase.io/api/v0/add?pin=true&cid-version=0',
    );
    assertEquals(calls[0].authorization, 'Bearer filebase-token');
    assertEquals(
      calls[1].url,
      'https://api.pinata.cloud/v3/files/public/pin_by_cid',
    );
    assertEquals(calls[1].authorization, 'Bearer pinata-jwt');
    assertEquals(
      JSON.parse(String(calls[1].body)),
      { cid: CID_V0, name: 'project.json' },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('pinning fails when Pinata does not acknowledge the Filebase CID', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) =>
    Promise.resolve(
      String(input).startsWith('https://rpc.filebase.io/')
        ? Response.json({ Hash: CID_V0, Size: '12' })
        : Response.json({ data: { cid: DAG_PB_CID_V1 } }),
    )) as typeof fetch;

  try {
    const client = new IpfsClient({
      enabled: true,
      filebaseToken: 'filebase-token',
      pinataJwt: 'pinata-jwt',
    });
    await assertRejects(
      () => client.pinJson({ name: 'Juicy' }),
      Error,
      'mismatched CID',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
