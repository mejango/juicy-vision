// REVDeployer ABI
// Contract Address: 0x2ca27bde7e7d33e353b44c27acfcf6c78dde251d

export const REV_DEPLOYER_ADDRESS = '0x2ca27bde7e7d33e353b44c27acfcf6c78dde251d' as const

export const REV_DEPLOYER_ABI = [
  {
    name: 'deployFor',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'revnetId', type: 'uint256' },
      {
        name: 'configuration',
        type: 'tuple',
        components: [
          {
            name: 'description',
            type: 'tuple',
            components: [
              { name: 'name', type: 'string' },
              { name: 'ticker', type: 'string' },
              { name: 'uri', type: 'string' },
              { name: 'salt', type: 'bytes32' },
            ],
          },
          { name: 'baseCurrency', type: 'uint32' },
          { name: 'splitOperator', type: 'address' },
          {
            name: 'stageConfigurations',
            type: 'tuple[]',
            components: [
              { name: 'startsAtOrAfter', type: 'uint40' },
              { name: 'splitPercent', type: 'uint32' },
              { name: 'initialIssuance', type: 'uint104' },
              { name: 'issuanceDecayFrequency', type: 'uint32' },
              { name: 'issuanceDecayPercent', type: 'uint32' },
              { name: 'cashOutTaxRate', type: 'uint16' },
              { name: 'extraMetadata', type: 'uint16' },
            ],
          },
          {
            name: 'loanSources',
            type: 'tuple[]',
            components: [
              { name: 'token', type: 'address' },
              { name: 'terminal', type: 'address' },
            ],
          },
          {
            name: 'loans',
            type: 'tuple[]',
            components: [
              { name: 'amount', type: 'uint112' },
              { name: 'source', type: 'uint8' },
              { name: 'beneficiary', type: 'address' },
            ],
          },
          { name: 'allowCrosschainSuckerExtension', type: 'bool' },
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
      {
        name: 'buybackHookConfiguration',
        type: 'tuple',
        components: [
          { name: 'hook', type: 'address' },
          {
            name: 'pools',
            type: 'tuple[]',
            components: [
              { name: 'token', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'twapWindow', type: 'uint32' },
              { name: 'twapSlippageTolerance', type: 'uint32' },
            ],
          },
        ],
      },
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
      { name: 'hookConfiguration', type: 'tuple', components: [] },
      { name: 'otherPayHooksSpecifications', type: 'tuple[]', components: [] },
      { name: 'extraHookMetadata', type: 'uint16' },
      { name: 'dataHook', type: 'address' },
    ],
    outputs: [
      { name: 'revnetId', type: 'uint256' },
      { name: 'tokenAddress', type: 'address' },
    ],
  },
] as const
