// ERC2771 Trusted Forwarder for meta-transactions
// Same address on all supported chains
export const ERC2771_FORWARDER_ADDRESS = '0xc29d6995ab3b0df4650ad643adeac55e7acbb566' as const

// Minimal ABI for ERC2771Forwarder - only what we need for signing
export const ERC2771_FORWARDER_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'owner', type: 'address' }],
    name: 'nonces',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'from', type: 'address' },
          { internalType: 'address', name: 'to', type: 'address' },
          { internalType: 'uint256', name: 'value', type: 'uint256' },
          { internalType: 'uint256', name: 'gas', type: 'uint256' },
          { internalType: 'uint48', name: 'deadline', type: 'uint48' },
          { internalType: 'bytes', name: 'data', type: 'bytes' },
          { internalType: 'bytes', name: 'signature', type: 'bytes' },
        ],
        internalType: 'struct ERC2771Forwarder.ForwardRequestData',
        name: 'request',
        type: 'tuple',
      },
    ],
    name: 'execute',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
] as const

// EIP-712 typed data types for ForwardRequest signing
export const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
} as const
