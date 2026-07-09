// JBSplits ABI - Juicebox V6
// Contract Address: 0x28b3d11fcb8d2ad0a143c5b193cd9f2e4d43f4c3 (same on all chains)
// Generated from deploy-all-v6/deployments/ethereum/JBSplits.json (Juicebox V6).
// Regenerate with scripts in deploy-all-v6; do not hand-edit ABI fragments.

export const JB_SPLITS_ADDRESS = '0x28b3d11fcb8d2ad0a143c5b193cd9f2e4d43f4c3' as const

// Split group IDs
export const SPLIT_GROUP_RESERVED = 1n // Reserved token splits

// Helper to compute payout split group ID from token address
// In JB V6, payout split groups are keyed by uint256(uint160(token))
export function getPayoutSplitGroup(tokenAddress: `0x${string}`): bigint {
  return BigInt(tokenAddress)
}

// Native token address (used as payout token for ETH projects)
export const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as const

// JBSplit struct (matches the V6 contract struct layout)
export interface JBSplit {
  percent: number // uint32 - out of 1,000,000,000 = 100%
  projectId: bigint // uint64 - 0 if not a project split
  beneficiary: `0x${string}` // address - recipient
  preferAddToBalance: boolean
  lockedUntil: number // uint48 - timestamp, 0 if not locked
  hook: `0x${string}` // address - zero if none
}

// JBSplitGroup struct for setting splits
export interface JBSplitGroup {
  groupId: bigint // uint256 - SPLIT_GROUP_RESERVED(1) or token address for payouts
  splits: JBSplit[]
}

export const JB_SPLITS_ABI = [
  {
    "type": "function",
    "name": "setSplitGroupsOf",
    "inputs": [
      {
        "name": "projectId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "rulesetId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "splitGroups",
        "type": "tuple[]",
        "internalType": "struct JBSplitGroup[]",
        "components": [
          {
            "name": "groupId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "splits",
            "type": "tuple[]",
            "internalType": "struct JBSplit[]",
            "components": [
              {
                "name": "percent",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "projectId",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "beneficiary",
                "type": "address",
                "internalType": "address payable"
              },
              {
                "name": "preferAddToBalance",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "lockedUntil",
                "type": "uint48",
                "internalType": "uint48"
              },
              {
                "name": "hook",
                "type": "address",
                "internalType": "contract IJBSplitHook"
              }
            ]
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "splitsOf",
    "inputs": [
      {
        "name": "projectId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "rulesetId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "groupId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "splits",
        "type": "tuple[]",
        "internalType": "struct JBSplit[]",
        "components": [
          {
            "name": "percent",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "projectId",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "beneficiary",
            "type": "address",
            "internalType": "address payable"
          },
          {
            "name": "preferAddToBalance",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "lockedUntil",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "hook",
            "type": "address",
            "internalType": "contract IJBSplitHook"
          }
        ]
      }
    ],
    "stateMutability": "view"
  }
] as const

// IMPORTANT: Locked splits cannot be modified
// A split with lockedUntil > now cannot be changed until after that timestamp
// When setting new splits, locked splits from current config MUST be included unchanged
