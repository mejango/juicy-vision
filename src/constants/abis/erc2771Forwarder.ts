// ERC2771 Trusted Forwarder for meta-transactions - Juicebox V6 deployment
// Contract Address: 0x3ba60b60933916a7c87d0860dcee62a0ce34e3e2 (same on all chains)
// Generated from deploy-all-v6/deployments/ethereum/ERC2771Forwarder.json (Juicebox V6).
// Regenerate with scripts in deploy-all-v6; do not hand-edit ABI fragments.

export const ERC2771_FORWARDER_ADDRESS = '0x3ba60b60933916a7c87d0860dcee62a0ce34e3e2' as const

export const ERC2771_FORWARDER_ABI = [
  {
    "type": "function",
    "name": "execute",
    "inputs": [
      {
        "name": "request",
        "type": "tuple",
        "internalType": "struct ERC2771Forwarder.ForwardRequestData",
        "components": [
          {
            "name": "from",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "to",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "gas",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "data",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "nonces",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  }
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
