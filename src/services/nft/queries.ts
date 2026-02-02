// ABI definitions for 721 tier hook contracts

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
  {
    name: 'FLAGS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'noNewTiersWithReserves', type: 'bool' },
          { name: 'noNewTiersWithVotes', type: 'bool' },
          { name: 'noNewTiersWithOwnerMinting', type: 'bool' },
          { name: 'preventOverspending', type: 'bool' },
        ],
      },
    ],
  },
] as const

/**
 * JB721TierStore ABI (partial - functions we need)
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
        components: [
          { name: 'id', type: 'uint32' },
          { name: 'price', type: 'uint104' },
          { name: 'remainingSupply', type: 'uint32' },
          { name: 'initialSupply', type: 'uint32' },
          { name: 'votingUnits', type: 'uint104' },
          { name: 'reservedRate', type: 'uint16' },
          { name: 'reserveFrequency', type: 'uint16' },
          { name: 'category', type: 'uint24' },
          { name: 'allowOwnerMint', type: 'bool' },
          { name: 'transfersPausable', type: 'bool' },
          { name: 'cannotBeRemoved', type: 'bool' },
          { name: 'cannotIncreaseDiscountPercent', type: 'bool' },
          { name: 'resolvedUri', type: 'string' },
        ],
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
        components: [
          { name: 'id', type: 'uint32' },
          { name: 'price', type: 'uint104' },
          { name: 'remainingSupply', type: 'uint32' },
          { name: 'initialSupply', type: 'uint32' },
          { name: 'votingUnits', type: 'uint104' },
          { name: 'reservedRate', type: 'uint16' },
          { name: 'reserveFrequency', type: 'uint16' },
          { name: 'category', type: 'uint24' },
          { name: 'allowOwnerMint', type: 'bool' },
          { name: 'transfersPausable', type: 'bool' },
          { name: 'cannotBeRemoved', type: 'bool' },
          { name: 'cannotIncreaseDiscountPercent', type: 'bool' },
          { name: 'resolvedUri', type: 'string' },
        ],
      },
    ],
  },
  {
    name: 'numberOfTiersOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'hook', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
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
 * JBController ABI (to get ruleset with data hook)
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
          { name: 'useTotalSurplusForCashOuts', type: 'bool' },
          { name: 'useDataHookForPay', type: 'bool' },
          { name: 'useDataHookForCashOut', type: 'bool' },
          { name: 'dataHook', type: 'address' },
          { name: 'metadata', type: 'uint16' },
        ],
      },
    ],
  },
] as const
