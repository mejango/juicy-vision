import { assertEquals, assertThrows } from 'std/assert/mod.ts';
import { type Address, encodeAbiParameters, encodeEventTopics, type Hex } from 'viem';
import { CONTRACTS, KNOWN_BUYBACK_HOOKS } from '@shared/chains.ts';
import { verifyProtectedPaymentReceipt } from './paymentReceipt.ts';

const PAY_EVENT_ABI = [{
  name: 'Pay',
  type: 'event',
  inputs: [
    { name: 'rulesetId', type: 'uint256', indexed: true },
    { name: 'rulesetCycleNumber', type: 'uint256', indexed: true },
    { name: 'projectId', type: 'uint256', indexed: true },
    { name: 'payer', type: 'address', indexed: false },
    { name: 'beneficiary', type: 'address', indexed: false },
    { name: 'amount', type: 'uint256', indexed: false },
    { name: 'newlyIssuedTokenCount', type: 'uint256', indexed: false },
    { name: 'memo', type: 'string', indexed: false },
    { name: 'metadata', type: 'bytes', indexed: false },
    { name: 'caller', type: 'address', indexed: false },
  ],
}] as const;

const MINT_EVENT_ABI = [{
  name: 'MintTokens',
  type: 'event',
  inputs: [
    { name: 'beneficiary', type: 'address', indexed: true },
    { name: 'projectId', type: 'uint256', indexed: true },
    { name: 'tokenCount', type: 'uint256', indexed: false },
    { name: 'beneficiaryTokenCount', type: 'uint256', indexed: false },
    { name: 'memo', type: 'string', indexed: false },
    { name: 'reservedPercent', type: 'uint256', indexed: false },
    { name: 'caller', type: 'address', indexed: false },
  ],
}] as const;

const PROJECT_ID = 7n;
const PAYER = '0x1111111111111111111111111111111111111111' as Address;
const BENEFICIARY = '0x2222222222222222222222222222222222222222' as Address;
const AMOUNT = 1_000_000n;
const MEMO = 'protected payment';

function payLog(issued: bigint, payer: Address = PAYER) {
  return {
    address: CONTRACTS.JBMultiTerminal as Address,
    topics: encodeEventTopics({
      abi: PAY_EVENT_ABI,
      eventName: 'Pay',
      args: { rulesetId: 10n, rulesetCycleNumber: 1n, projectId: PROJECT_ID },
    }) as Hex[],
    data: encodeAbiParameters([
      { type: 'address' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'string' },
      { type: 'bytes' },
      { type: 'address' },
    ], [payer, BENEFICIARY, AMOUNT, issued, MEMO, '0x', PAYER]),
  };
}

function mintLog(beneficiaryIssued: bigint, caller: Address) {
  return {
    address: CONTRACTS.JBController as Address,
    topics: encodeEventTopics({
      abi: MINT_EVENT_ABI,
      eventName: 'MintTokens',
      args: { beneficiary: BENEFICIARY, projectId: PROJECT_ID },
    }) as Hex[],
    data: encodeAbiParameters([
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'string' },
      { type: 'uint256' },
      { type: 'address' },
    ], [beneficiaryIssued, beneficiaryIssued, '', 0n, caller]),
  };
}

const expected = (minimum: bigint) => ({
  entrypoint: CONTRACTS.JBMultiTerminal as Address,
  projectId: PROJECT_ID,
  payer: PAYER,
  beneficiary: BENEFICIARY,
  amount: AMOUNT,
  memo: MEMO,
  metadata: '0x' as Hex,
  minimum,
});

Deno.test('payment receipt verifies a router-registry payment forwarded through the router', () => {
  assertEquals(
    verifyProtectedPaymentReceipt({
      ...expected(1_000n),
      entrypoint: CONTRACTS.JBRouterTerminalRegistry as Address,
      logs: [
        payLog(1_000n, CONTRACTS.JBRouterTerminal as Address),
        mintLog(1_000n, CONTRACTS.JBMultiTerminal as Address),
      ],
    }),
    1_000n,
  );
});

Deno.test('payment receipt verifies direct terminal issuance', () => {
  assertEquals(
    verifyProtectedPaymentReceipt({
      ...expected(1_000n),
      logs: [payLog(1_000n), mintLog(1_000n, CONTRACTS.JBMultiTerminal as Address)],
    }),
    1_000n,
  );
});

Deno.test('payment receipt recovers buyback issuance emitted after the Pay event', () => {
  assertEquals(
    verifyProtectedPaymentReceipt({
      ...expected(990n),
      logs: [payLog(0n), mintLog(1_000n, CONTRACTS.JBBuybackHook as Address)],
    }),
    1_000n,
  );
});

Deno.test('payment receipt counts mints from every known-good buyback hook (registry-pinned pre-upgrade instance)', () => {
  for (const hook of KNOWN_BUYBACK_HOOKS) {
    assertEquals(
      verifyProtectedPaymentReceipt({
        ...expected(990n),
        logs: [payLog(0n), mintLog(1_000n, hook as Address)],
      }),
      1_000n,
    );
  }
});

Deno.test('payment receipt rejects an unrelated controller mint', () => {
  assertThrows(
    () =>
      verifyProtectedPaymentReceipt({
        ...expected(990n),
        logs: [payLog(0n), mintLog(1_000n, PAYER)],
      }),
    Error,
    'protected project-token minimum',
  );
});
