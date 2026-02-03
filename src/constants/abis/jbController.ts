// JBController ABI - Version 5.1
// Contract Address: 0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1

export const JB_CONTROLLER_ADDRESS = '0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1' as const

export const JB_CONTROLLER_ABI = [
  {
    name: 'launchProjectFor',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'projectUri', type: 'string' },
      {
        name: 'rulesetConfigurations',
        type: 'tuple[]',
        components: [
          { name: 'mustStartAtOrAfter', type: 'uint48' },
          { name: 'duration', type: 'uint32' },
          { name: 'weight', type: 'uint112' },
          { name: 'weightCutPercent', type: 'uint32' },
          { name: 'approvalHook', type: 'address' },
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
          {
            name: 'splitGroups',
            type: 'tuple[]',
            components: [
              { name: 'groupId', type: 'uint256' },
              {
                name: 'splits',
                type: 'tuple[]',
                components: [
                  { name: 'preferAddToBalance', type: 'bool' },
                  { name: 'percent', type: 'uint32' },
                  { name: 'projectId', type: 'uint56' },
                  { name: 'beneficiary', type: 'address' },
                  { name: 'lockedUntil', type: 'uint48' },
                  { name: 'hook', type: 'address' },
                ],
              },
            ],
          },
          {
            name: 'fundAccessLimitGroups',
            type: 'tuple[]',
            components: [
              { name: 'terminal', type: 'address' },
              { name: 'token', type: 'address' },
              {
                name: 'payoutLimits',
                type: 'tuple[]',
                components: [
                  { name: 'amount', type: 'uint224' },
                  { name: 'currency', type: 'uint32' },
                ],
              },
              {
                name: 'surplusAllowances',
                type: 'tuple[]',
                components: [
                  { name: 'amount', type: 'uint224' },
                  { name: 'currency', type: 'uint32' },
                ],
              },
            ],
          },
        ],
      },
      {
        name: 'terminalConfigurations',
        type: 'tuple[]',
        components: [
          { name: 'terminal', type: 'address' },
          {
            name: 'accountingContextsToAccept',
            type: 'tuple[]',
            components: [
              { name: 'token', type: 'address' },
              { name: 'decimals', type: 'uint8' },
              { name: 'currency', type: 'uint32' },
            ],
          },
        ],
      },
      { name: 'memo', type: 'string' },
    ],
    outputs: [{ name: 'projectId', type: 'uint256' }],
  },
  {
    name: 'queueRulesetsOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      {
        name: 'rulesetConfigurations',
        type: 'tuple[]',
        components: [
          { name: 'mustStartAtOrAfter', type: 'uint48' },
          { name: 'duration', type: 'uint32' },
          { name: 'weight', type: 'uint112' },
          { name: 'weightCutPercent', type: 'uint32' },
          { name: 'approvalHook', type: 'address' },
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
          {
            name: 'splitGroups',
            type: 'tuple[]',
            components: [
              { name: 'groupId', type: 'uint256' },
              {
                name: 'splits',
                type: 'tuple[]',
                components: [
                  { name: 'preferAddToBalance', type: 'bool' },
                  { name: 'percent', type: 'uint32' },
                  { name: 'projectId', type: 'uint56' },
                  { name: 'beneficiary', type: 'address' },
                  { name: 'lockedUntil', type: 'uint48' },
                  { name: 'hook', type: 'address' },
                ],
              },
            ],
          },
          {
            name: 'fundAccessLimitGroups',
            type: 'tuple[]',
            components: [
              { name: 'terminal', type: 'address' },
              { name: 'token', type: 'address' },
              {
                name: 'payoutLimits',
                type: 'tuple[]',
                components: [
                  { name: 'amount', type: 'uint224' },
                  { name: 'currency', type: 'uint32' },
                ],
              },
              {
                name: 'surplusAllowances',
                type: 'tuple[]',
                components: [
                  { name: 'amount', type: 'uint224' },
                  { name: 'currency', type: 'uint32' },
                ],
              },
            ],
          },
        ],
      },
      { name: 'memo', type: 'string' },
    ],
    outputs: [{ name: 'rulesetId', type: 'uint256' }],
  },
  {
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
  },
  {
    name: 'sendReservedTokensToSplitsOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
    ],
    outputs: [{ name: 'tokenCount', type: 'uint256' }],
  },
  {
    name: 'setUriOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'uri', type: 'string' },
    ],
    outputs: [],
  },
  {
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
              { name: 'preferAddToBalance', type: 'bool' },
              { name: 'percent', type: 'uint32' },
              { name: 'projectId', type: 'uint56' },
              { name: 'beneficiary', type: 'address' },
              { name: 'lockedUntil', type: 'uint48' },
              { name: 'hook', type: 'address' },
            ],
          },
        ],
      },
    ],
    outputs: [],
  },
] as const
