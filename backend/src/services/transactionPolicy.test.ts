import { assertRejects } from 'std/assert/mod.ts';
import { type Address, encodeFunctionData } from 'viem';
import { JB_721_TIERS_HOOK_ABI } from '../../../src/constants/abis/jb721TiersHook.ts';
import { REV_DEPLOYER_ABI } from '../../../src/constants/abis/revDeployer.ts';
import { assertManagedTransactionAllowed } from './transactionPolicy.ts';

const PAY_ABI = [{
  name: 'pay',
  type: 'function',
  stateMutability: 'payable',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'beneficiary', type: 'address' },
    { name: 'minReturnedTokens', type: 'uint256' },
    { name: 'memo', type: 'string' },
    { name: 'metadata', type: 'bytes' },
  ],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;

const ADD_TO_BALANCE_ABI = [{
  name: 'addToBalanceOf',
  type: 'function',
  stateMutability: 'payable',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'shouldReturnHeldFees', type: 'bool' },
    { name: 'memo', type: 'string' },
    { name: 'metadata', type: 'bytes' },
  ],
  outputs: [],
}] as const;

const USE_ALLOWANCE_ABI = [{
  name: 'useAllowanceOf',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'currency', type: 'uint256' },
    { name: 'minTokensPaidOut', type: 'uint256' },
    { name: 'beneficiary', type: 'address' },
    { name: 'feeBeneficiary', type: 'address' },
    { name: 'memo', type: 'string' },
  ],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;

const SET_URI_ABI = [{
  name: 'setUriOf',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'uri', type: 'string' },
  ],
  outputs: [],
}] as const;

const DEPLOY_ERC20_ABI = [{
  name: 'deployERC20For',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'name', type: 'string' },
    { name: 'symbol', type: 'string' },
    { name: 'salt', type: 'bytes32' },
  ],
  outputs: [{ name: 'token', type: 'address' }],
}] as const;

const SET_SPLIT_GROUPS_ABI = [{
  name: 'setSplitGroupsOf',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'rulesetId', type: 'uint256' },
    {
      name: 'splitGroups',
      type: 'tuple[]',
      components: [
        { name: 'groupId', type: 'uint256' },
        {
          name: 'splits',
          type: 'tuple[]',
          components: [
            { name: 'percent', type: 'uint32' },
            { name: 'projectId', type: 'uint64' },
            { name: 'beneficiary', type: 'address' },
            { name: 'preferAddToBalance', type: 'bool' },
            { name: 'lockedUntil', type: 'uint48' },
            { name: 'hook', type: 'address' },
          ],
        },
      ],
    },
  ],
  outputs: [],
}] as const;

const NATIVE_TOKEN = '0x000000000000000000000000000000000000eeee' as Address;
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as Address;
const ACCOUNT = '0x1234567890123456789012345678901234567890' as Address;
const UNKNOWN_CONTRACT = '0x9999999999999999999999999999999999999999' as Address;
const OTHER_ACCOUNT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const REV_DEPLOYER = '0xb552eb94284f94b833837d4b2cbb237128415d4e' as Address;
const NONZERO_SALT = `0x${'0'.repeat(63)}1` as const;

function payData(amount: bigint, token: Address = NATIVE_TOKEN) {
  return encodeFunctionData({
    abi: PAY_ABI,
    functionName: 'pay',
    args: [1n, token, amount, ACCOUNT, 0n, '', '0x'],
  });
}

function addToBalanceData(amount: bigint, metadata: `0x${string}` = '0x') {
  return encodeFunctionData({
    abi: ADD_TO_BALANCE_ABI,
    functionName: 'addToBalanceOf',
    args: [1n, NATIVE_TOKEN, amount, false, '', metadata],
  });
}

function allowanceData(beneficiary: Address, feeBeneficiary: Address = beneficiary) {
  const amount = 1_000_000_000_000_000_000n;
  return encodeFunctionData({
    abi: USE_ALLOWANCE_ABI,
    functionName: 'useAllowanceOf',
    args: [
      1n,
      NATIVE_TOKEN,
      amount,
      BigInt(NATIVE_TOKEN) & 0xffff_ffffn,
      amount - (amount / 40n),
      beneficiary,
      feeBeneficiary,
      '',
    ],
  });
}

function revnetData(baseCurrency: 1 | 2) {
  return encodeFunctionData({
    abi: REV_DEPLOYER_ABI,
    functionName: 'deployFor',
    args: [
      0n,
      {
        description: {
          name: 'Truthful Revnet',
          ticker: 'TRUTH',
          uri: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3gq2t5lz2wqzzx4m6w6v7s7qm',
          salt: NONZERO_SALT,
        },
        baseCurrency,
        operator: ACCOUNT,
        scopeCashOutsToLocalBalances: false,
        stageConfigurations: [{
          startsAtOrAfter: 2_000_000_000,
          autoIssuances: [],
          splitPercent: 0,
          splits: [],
          initialIssuance: 1_000_000_000_000_000_000n,
          issuanceCutFrequency: 86_400,
          issuanceCutPercent: 0,
          cashOutTaxRate: 0,
          extraMetadata: 0,
        }],
      },
      [{ token: NATIVE_TOKEN, decimals: 18, currency: 61_166 }],
      { deployerConfigurations: [], salt: `0x${'0'.repeat(64)}` },
    ],
  });
}

Deno.test('managed transaction policy blocks exact pay calldata sent to an unknown contract', async () => {
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data: payData(1n),
        value: 1n,
      }),
    Error,
    'Terminal not recognized',
  );
});

Deno.test('managed transaction policy blocks a valid revnet interface sent to an unknown contract', async () => {
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data: revnetData(1),
        value: 0n,
        expectedAccount: ACCOUNT,
      }),
    Error,
    'Deployment contract not recognized',
  );
});

Deno.test('managed transaction policy blocks a revnet base currency that mismatches its token', async () => {
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: REV_DEPLOYER,
        data: revnetData(2),
        value: 0n,
        expectedAccount: ACCOUNT,
      }),
    Error,
    'base currency does not match',
  );
});

Deno.test('managed transaction policy blocks zero-value pay calls before RPC lookup', async () => {
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data: payData(0n),
        value: 0n,
      }),
    Error,
    'Payment amount must be greater than zero',
  );
});

Deno.test('managed transaction policy limits onchain pay to the native token', async () => {
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data: payData(1_000_000n, USDC),
        value: 0n,
        expectedAccount: ACCOUNT,
      }),
    Error,
    'native token only',
  );
});

Deno.test('managed transaction policy binds Add to Balance amount to native value', async () => {
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data: addToBalanceData(2n),
        value: 1n,
      }),
    Error,
    'Balance contribution value is incorrect',
  );
});

Deno.test('managed transaction policy rejects metadata on Add to Balance', async () => {
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data: addToBalanceData(1n, '0x1234'),
        value: 1n,
      }),
    Error,
    'Balance contribution metadata is not supported',
  );
});

Deno.test('managed transaction policy blocks unknown function selectors', async () => {
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data: '0x12345678',
        value: 0n,
      }),
    Error,
    'Transaction function not supported',
  );
});

Deno.test('managed transaction policy blocks ruleset calls to unknown contracts before decoding', async () => {
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data: '0x3141db70',
        value: 0n,
      }),
    Error,
    'Ruleset queue target not recognized',
  );
});

Deno.test('managed transaction policy blocks allowance calls to unknown contracts', async () => {
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data: allowanceData(ACCOUNT),
        value: 0n,
        expectedAccount: ACCOUNT,
      }),
    Error,
    'Terminal not recognized',
  );
});

Deno.test('managed transaction policy blocks redirected allowance beneficiaries before RPC lookup', async () => {
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data: allowanceData(OTHER_ACCOUNT),
        value: 0n,
        expectedAccount: ACCOUNT,
      }),
    Error,
    'Allowance beneficiaries must be the managed account',
  );
});

Deno.test('managed transaction policy blocks non-IPFS metadata before RPC lookup', async () => {
  const data = encodeFunctionData({
    abi: SET_URI_ABI,
    functionName: 'setUriOf',
    args: [1n, 'https://example.com/project.json'],
  });
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data,
        value: 0n,
      }),
    Error,
    'Project metadata URI must be a pinned IPFS URI',
  );
});

Deno.test('managed transaction policy blocks invalid token metadata before controller lookup', async () => {
  const data = encodeFunctionData({
    abi: DEPLOY_ERC20_ABI,
    functionName: 'deployERC20For',
    args: [1n, 'Token', '!', `0x${'0'.repeat(63)}1`],
  });
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data,
        value: 0n,
      }),
    Error,
    'Token symbol must be 2-10 letters or numbers',
  );
});

Deno.test('managed transaction policy blocks same-project split routes before RPC lookup', async () => {
  const data = encodeFunctionData({
    abi: SET_SPLIT_GROUPS_ABI,
    functionName: 'setSplitGroupsOf',
    args: [1n, 1n, [
      {
        groupId: BigInt(NATIVE_TOKEN),
        splits: [{
          percent: 1_000_000_000,
          projectId: 1n,
          beneficiary: ACCOUNT,
          preferAddToBalance: true,
          lockedUntil: 0,
          hook: '0x0000000000000000000000000000000000000000',
        }],
      },
      { groupId: 1n, splits: [] },
    ]],
  });
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data,
        value: 0n,
      }),
    Error,
    'cannot route back to its source project',
  );
});

Deno.test('managed transaction policy blocks implicit split recipients before RPC lookup', async () => {
  const data = encodeFunctionData({
    abi: SET_SPLIT_GROUPS_ABI,
    functionName: 'setSplitGroupsOf',
    args: [1n, 1n, [
      {
        groupId: BigInt(NATIVE_TOKEN),
        splits: [{
          percent: 1_000_000_000,
          projectId: 0n,
          beneficiary: '0x0000000000000000000000000000000000000000',
          preferAddToBalance: false,
          lockedUntil: 0,
          hook: '0x0000000000000000000000000000000000000000',
        }],
      },
      { groupId: 1n, splits: [] },
    ]],
  });
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data,
        value: 0n,
      }),
    Error,
    'has no explicit recipient',
  );
});

Deno.test('managed transaction policy blocks collection-wide reserve changes before hook lookup', async () => {
  const data = encodeFunctionData({
    abi: JB_721_TIERS_HOOK_ABI,
    functionName: 'adjustTiers',
    args: [[{
      price: 1_000_000n,
      initialSupply: 100,
      votingUnits: 0,
      reserveFrequency: 5,
      reserveBeneficiary: ACCOUNT,
      encodedIpfsUri: `0x${'0'.repeat(63)}1`,
      category: 0,
      discountPercent: 0,
      flags: {
        allowOwnerMint: false,
        useReserveBeneficiaryAsDefault: true,
        transfersPausable: false,
        useVotingUnits: false,
        cantBeRemoved: false,
        cantIncreaseDiscountPercent: false,
        cantBuyWithCredits: false,
      },
      splitPercent: 0,
      splits: [],
    }], []],
  });
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data,
        value: 0n,
      }),
    Error,
    'collection-wide reserve beneficiary',
  );
});

Deno.test('managed transaction policy rejects out-of-range tier discounts before hook lookup', async () => {
  const data = encodeFunctionData({
    abi: JB_721_TIERS_HOOK_ABI,
    functionName: 'setDiscountPercentsOf',
    args: [[{ tierId: 1, discountPercent: 201 }]],
  });
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data,
        value: 0n,
      }),
    Error,
    'Invalid discount for tier 1',
  );
});

Deno.test('managed transaction policy rejects duplicate tier discounts before hook lookup', async () => {
  const data = encodeFunctionData({
    abi: JB_721_TIERS_HOOK_ABI,
    functionName: 'setDiscountPercentsOf',
    args: [[
      { tierId: 1, discountPercent: 20 },
      { tierId: 1, discountPercent: 10 },
    ]],
  });
  await assertRejects(
    () =>
      assertManagedTransactionAllowed({
        chainId: 1,
        to: UNKNOWN_CONTRACT,
        data,
        value: 0n,
      }),
    Error,
    'Duplicate discount for tier 1',
  );
});
