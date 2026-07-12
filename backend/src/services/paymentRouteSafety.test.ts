import { assertRejects } from 'std/assert/mod.ts';
import { type Address, type PublicClient } from 'viem';
import { assertRecognizedPaymentRouteWithClient } from './chainReader.ts';

const MULTI = '0x130f5dd2bd8805443cf41755253d778a75a67f53' as Address;
const ROUTER = '0x0fbcbb3d10c8f524840d74ef81c1a9f161c418d7' as Address;
const REGISTRY = '0xe0427f250fdb0379c8e98e884ee4570521208cbc' as Address;
const UNKNOWN = '0x9999999999999999999999999999999999999999' as Address;

function readerReturning(...values: unknown[]): Pick<PublicClient, 'readContract'> {
  return {
    readContract: (() => Promise.resolve(values.shift())) as PublicClient['readContract'],
  };
}

Deno.test('recognized payment route accepts a live registered multi terminal', async () => {
  await assertRecognizedPaymentRouteWithClient(readerReturning([MULTI]), 1n, MULTI);
});

Deno.test('recognized payment route blocks an unknown registry destination', async () => {
  await assertRejects(
    () =>
      assertRecognizedPaymentRouteWithClient(readerReturning([REGISTRY], UNKNOWN), 1n, REGISTRY),
    Error,
    'Terminal not recognized in payment route',
  );
});

Deno.test('recognized payment route blocks an unknown router candidate', async () => {
  await assertRejects(
    () =>
      assertRecognizedPaymentRouteWithClient(
        readerReturning([ROUTER, MULTI, UNKNOWN]),
        1n,
        ROUTER,
      ),
    Error,
    'Terminal not recognized in payment route',
  );
});

Deno.test('recognized payment route accepts a router with only recognized candidates', async () => {
  await assertRecognizedPaymentRouteWithClient(readerReturning([ROUTER, MULTI]), 1n, ROUTER);
});

Deno.test('recognized multi terminal still blocks another unknown project route', async () => {
  await assertRejects(
    () => assertRecognizedPaymentRouteWithClient(readerReturning([MULTI, UNKNOWN]), 1n, MULTI),
    Error,
    'Terminal not recognized in payment route',
  );
});

Deno.test('recognized router must be the live destination of a recognized registry', async () => {
  await assertRecognizedPaymentRouteWithClient(
    readerReturning([REGISTRY, MULTI], ROUTER),
    1n,
    ROUTER,
  );
});
