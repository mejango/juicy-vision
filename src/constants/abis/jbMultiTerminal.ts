// JBMultiTerminal ABI - Version 5.1
// Contract Address: 0x52869db3d61dde1e391967f2ce5039ad0ecd371c

export const JB_MULTI_TERMINAL_ADDRESS = '0x52869db3d61dde1e391967f2ce5039ad0ecd371c' as const

export const JB_MULTI_TERMINAL_ABI = [
  {
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
    outputs: [{ name: 'beneficiaryTokenCount', type: 'uint256' }],
  },
  {
    name: 'cashOutTokensOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'holder', type: 'address' },
      { name: 'projectId', type: 'uint256' },
      { name: 'cashOutCount', type: 'uint256' },
      { name: 'tokenToReclaim', type: 'address' },
      { name: 'minTokensReclaimed', type: 'uint256' },
      { name: 'beneficiary', type: 'address' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [{ name: 'reclaimAmount', type: 'uint256' }],
  },
  {
    name: 'sendPayoutsOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'currency', type: 'uint256' },
      { name: 'minTokensPaidOut', type: 'uint256' },
    ],
    outputs: [{ name: 'amountPaidOut', type: 'uint256' }],
  },
  {
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
    outputs: [{ name: 'amountPaidOut', type: 'uint256' }],
  },
] as const

// Native token constant used by JBMultiTerminal
export const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as const
