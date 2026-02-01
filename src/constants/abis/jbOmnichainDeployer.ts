// JBOmnichainDeployer ABI - Version 5.1
// Contract Address: 0x587bf86677ec0d1b766d9ba0d7ac2a51c6c2fc71
// Source: https://github.com/Bananapus/nana-omnichain-deployers-v5

export const JB_OMNICHAIN_DEPLOYER_ADDRESS = '0x587bf86677ec0d1b766d9ba0d7ac2a51c6c2fc71' as const

export const JB_OMNICHAIN_DEPLOYER_ABI = [
  // launchProjectFor - Creates a new project with optional sucker deployment
  // https://github.com/Bananapus/nana-omnichain-deployers-v5/blob/main/src/JBOmnichainDeployer.sol#L285
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
      {
        name: 'suckerDeploymentConfiguration',
        type: 'tuple',
        components: [
          {
            name: 'deployerConfigurations',
            type: 'tuple[]',
            components: [
              { name: 'deployer', type: 'address' },
              {
                name: 'mappings',
                type: 'tuple[]',
                components: [
                  { name: 'localToken', type: 'address' },
                  { name: 'minGas', type: 'uint32' },
                  { name: 'remoteToken', type: 'address' },
                  { name: 'minBridgeAmount', type: 'uint256' },
                ],
              },
            ],
          },
          { name: 'salt', type: 'bytes32' },
        ],
      },
      { name: 'controller', type: 'address' },
    ],
    outputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'suckers', type: 'address[]' },
    ],
  },
  // launch721RulesetsFor - Launches rulesets with 721 tiers hook
  // https://github.com/Bananapus/nana-omnichain-deployers-v5/blob/main/src/JBOmnichainDeployer.sol#L341
  {
    name: 'launch721RulesetsFor',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      {
        name: 'deployTiersHookConfig',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'baseUri', type: 'string' },
          {
            name: 'tokenUriResolver',
            type: 'address',
          },
          { name: 'contractUri', type: 'string' },
          {
            name: 'tiersConfig',
            type: 'tuple',
            components: [
              {
                name: 'tiers',
                type: 'tuple[]',
                components: [
                  { name: 'price', type: 'uint104' },
                  { name: 'initialSupply', type: 'uint32' },
                  { name: 'votingUnits', type: 'uint32' },
                  { name: 'reserveFrequency', type: 'uint16' },
                  { name: 'reserveBeneficiary', type: 'address' },
                  { name: 'encodedIPFSUri', type: 'bytes32' },
                  { name: 'category', type: 'uint24' },
                  { name: 'discountPercent', type: 'uint8' },
                  { name: 'allowOwnerMint', type: 'bool' },
                  { name: 'useReserveBeneficiaryAsDefault', type: 'bool' },
                  { name: 'transfersPausable', type: 'bool' },
                  { name: 'useVotingUnits', type: 'bool' },
                  { name: 'cannotBeRemoved', type: 'bool' },
                  { name: 'cannotIncreaseDiscountPercent', type: 'bool' },
                ],
              },
              { name: 'currency', type: 'uint32' },
              { name: 'decimals', type: 'uint8' },
              { name: 'prices', type: 'address' },
            ],
          },
          { name: 'reserveBeneficiary', type: 'address' },
          {
            name: 'flags',
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
      {
        name: 'launchRulesetsConfig',
        type: 'tuple',
        components: [
          { name: 'projectId', type: 'uint56' },
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
      },
      { name: 'controller', type: 'address' },
      { name: 'salt', type: 'bytes32' },
    ],
    outputs: [
      { name: 'rulesetId', type: 'uint256' },
      { name: 'hook', type: 'address' },
    ],
  },
  // queueRulesetsOf - Queue rulesets for existing project (without 721s)
  // https://github.com/Bananapus/nana-omnichain-deployers-v5/blob/main/src/JBOmnichainDeployer.sol#L504
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
      { name: 'controller', type: 'address' },
    ],
    outputs: [{ name: 'rulesetId', type: 'uint256' }],
  },
  // queue721RulesetsOf - Queue rulesets with 721 tiers hook for existing project
  // https://github.com/Bananapus/nana-omnichain-deployers-v5/blob/main/src/JBOmnichainDeployer.sol#L536
  {
    name: 'queue721RulesetsOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      {
        name: 'deployTiersHookConfig',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'baseUri', type: 'string' },
          { name: 'tokenUriResolver', type: 'address' },
          { name: 'contractUri', type: 'string' },
          {
            name: 'tiersConfig',
            type: 'tuple',
            components: [
              {
                name: 'tiers',
                type: 'tuple[]',
                components: [
                  { name: 'price', type: 'uint104' },
                  { name: 'initialSupply', type: 'uint32' },
                  { name: 'votingUnits', type: 'uint32' },
                  { name: 'reserveFrequency', type: 'uint16' },
                  { name: 'reserveBeneficiary', type: 'address' },
                  { name: 'encodedIPFSUri', type: 'bytes32' },
                  { name: 'category', type: 'uint24' },
                  { name: 'discountPercent', type: 'uint8' },
                  { name: 'allowOwnerMint', type: 'bool' },
                  { name: 'useReserveBeneficiaryAsDefault', type: 'bool' },
                  { name: 'transfersPausable', type: 'bool' },
                  { name: 'useVotingUnits', type: 'bool' },
                  { name: 'cannotBeRemoved', type: 'bool' },
                  { name: 'cannotIncreaseDiscountPercent', type: 'bool' },
                ],
              },
              { name: 'currency', type: 'uint32' },
              { name: 'decimals', type: 'uint8' },
              { name: 'prices', type: 'address' },
            ],
          },
          { name: 'reserveBeneficiary', type: 'address' },
          {
            name: 'flags',
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
      {
        name: 'queueRulesetsConfig',
        type: 'tuple',
        components: [
          { name: 'projectId', type: 'uint56' },
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
      },
      { name: 'controller', type: 'address' },
      { name: 'salt', type: 'bytes32' },
    ],
    outputs: [
      { name: 'rulesetId', type: 'uint256' },
      { name: 'hook', type: 'address' },
    ],
  },
] as const
