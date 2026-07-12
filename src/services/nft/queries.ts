// ABI definitions for 721 tier hook contracts (Juicebox V6)

// V6 JB721Tier struct components (returned by the store's tiersOf/tierOf)
// V6 moved the per-tier booleans into a nested `flags` tuple, renamed
// encodedIPFSUri -> encodedIpfsUri, and added splitPercent.
const JB721_TIER_COMPONENTS = [
  { name: 'id', type: 'uint32' },
  { name: 'price', type: 'uint104' },
  { name: 'remainingSupply', type: 'uint32' },
  { name: 'initialSupply', type: 'uint32' },
  { name: 'votingUnits', type: 'uint104' },
  { name: 'reserveFrequency', type: 'uint16' },
  { name: 'reserveBeneficiary', type: 'address' },
  { name: 'encodedIpfsUri', type: 'bytes32' },
  { name: 'category', type: 'uint24' },
  { name: 'discountPercent', type: 'uint8' },
  {
    name: 'flags',
    type: 'tuple',
    components: [
      { name: 'allowOwnerMint', type: 'bool' },
      { name: 'transfersPausable', type: 'bool' },
      { name: 'cantBeRemoved', type: 'bool' },
      { name: 'cantIncreaseDiscountPercent', type: 'bool' },
      { name: 'cantBuyWithCredits', type: 'bool' },
    ],
  },
  { name: 'splitPercent', type: 'uint32' },
  { name: 'resolvedUri', type: 'string' },
] as const

/**
 * JB721TiersHook ABI (partial - functions we need)
 */
export const JB721TiersHookAbi = [
  {
    name: 'STORE',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'PROJECT_ID',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'DIRECTORY',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

/**
 * JB721TiersHookStore ABI (partial - functions we need)
 */
export const JB721TierStoreAbi = [
  {
    name: 'tiersOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'hook', type: 'address' },
      { name: 'categories', type: 'uint256[]' },
      { name: 'includeResolvedUri', type: 'bool' },
      { name: 'startingId', type: 'uint256' },
      { name: 'size', type: 'uint256' },
    ],
    outputs: [
      {
        name: 'tiers',
        type: 'tuple[]',
        components: JB721_TIER_COMPONENTS,
      },
    ],
  },
  {
    name: 'tierOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'hook', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'includeResolvedUri', type: 'bool' },
    ],
    outputs: [
      {
        name: 'tier',
        type: 'tuple',
        components: JB721_TIER_COMPONENTS,
      },
    ],
  },
  {
    name: 'maxTierIdOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'hook', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'flagsOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'hook', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'noNewTiersWithReserves', type: 'bool' },
          { name: 'noNewTiersWithVotes', type: 'bool' },
          { name: 'noNewTiersWithOwnerMinting', type: 'bool' },
          { name: 'preventOverspending', type: 'bool' },
          { name: 'issueTokensForSplits', type: 'bool' },
        ],
      },
    ],
  },
] as const

/**
 * JBDirectory ABI (to get data hook for a project)
 */
export const JBDirectoryDataHookAbi = [
  {
    name: 'controllerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

/**
 * JBController ABI (to get ruleset with data hook) - Juicebox V6.
 * V6 renamed useTotalSurplusForCashOuts -> scopeCashOutsToLocalBalances.
 */
export const JBControllerRulesetAbi = [
  {
    name: 'currentRulesetOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [
      {
        name: 'ruleset',
        type: 'tuple',
        components: [
          { name: 'cycleNumber', type: 'uint48' },
          { name: 'id', type: 'uint48' },
          { name: 'basedOnId', type: 'uint48' },
          { name: 'start', type: 'uint48' },
          { name: 'duration', type: 'uint32' },
          { name: 'weight', type: 'uint112' },
          { name: 'weightCutPercent', type: 'uint32' },
          { name: 'approvalHook', type: 'address' },
          { name: 'metadata', type: 'uint256' },
        ],
      },
      {
        name: 'metadata',
        type: 'tuple',
        components: [
          { name: 'reservedPercent', type: 'uint16' },
          { name: 'cashOutTaxRate', type: 'uint16' },
          { name: 'baseCurrency', type: 'uint32' },
          { name: 'pausePay', type: 'bool' },
          { name: 'pauseCreditTransfers', type: 'bool' },
          { name: 'allowOwnerMinting', type: 'bool' },
          { name: 'allowSetCustomToken', type: 'bool' },
          { name: 'allowTerminalMigration', type: 'bool' },
          { name: 'allowSetTerminals', type: 'bool' },
          { name: 'allowSetController', type: 'bool' },
          { name: 'allowAddAccountingContext', type: 'bool' },
          { name: 'allowAddPriceFeed', type: 'bool' },
          { name: 'ownerMustSendPayouts', type: 'bool' },
          { name: 'holdFees', type: 'bool' },
          { name: 'scopeCashOutsToLocalBalances', type: 'bool' },
          { name: 'useDataHookForPay', type: 'bool' },
          { name: 'useDataHookForCashOut', type: 'bool' },
          { name: 'dataHook', type: 'address' },
          { name: 'metadata', type: 'uint16' },
        ],
      },
    ],
  },
] as const
