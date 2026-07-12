import { assertRejects } from 'std/assert/mod.ts';
import { assertDagPbCid } from './ipfs.ts';

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
