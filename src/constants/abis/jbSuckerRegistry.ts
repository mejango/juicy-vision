// JBSuckerRegistry ABI
// Contract Address: 0x696c7e794fe2a7c2e3b7da4ae91733345fc1bf68

export const JB_SUCKER_REGISTRY_ADDRESS = '0x696c7e794fe2a7c2e3b7da4ae91733345fc1bf68' as const

export const JB_SUCKER_REGISTRY_ABI = [
  {
    name: 'deploySuckersFor',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'salt', type: 'bytes32' },
      {
        name: 'configurations',
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
    ],
    outputs: [{ name: 'suckers', type: 'address[]' }],
  },
  {
    name: 'suckersOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    name: 'isSuckerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'suckerAddress', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const
