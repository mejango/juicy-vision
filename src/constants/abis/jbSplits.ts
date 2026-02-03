// JBSplits ABI - Shared contract for managing split configurations
// Contract Address: 0x7160a322fea44945a6ef9adfd65c322258df3c5e (same on all chains via CREATE2)
// Works with both V5 and V5.1 projects

export const JB_SPLITS_ADDRESS = '0x7160a322fea44945a6ef9adfd65c322258df3c5e' as const

// Split group IDs
export const SPLIT_GROUP_RESERVED = 1n // Reserved token splits

// Helper to compute payout split group ID from token address
// In JB V5, payout split groups are keyed by uint256(uint160(token))
export function getPayoutSplitGroup(tokenAddress: `0x${string}`): bigint {
  return BigInt(tokenAddress)
}

// Native token address (used as payout token for ETH projects)
export const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as const

// JBSplit struct (matches contract struct layout)
export interface JBSplit {
  preferAddToBalance: boolean
  percent: number // uint32 - basis points (0-1,000,000,000 = 0-100%)
  projectId: bigint // uint64 - 0 if not a project split
  beneficiary: `0x${string}` // address - recipient
  lockedUntil: number // uint48 - timestamp, 0 if not locked
  hook: `0x${string}` // address - zero if none
}

// JBSplitGroup struct for setting splits
export interface JBSplitGroup {
  groupId: bigint // uint256 - SPLIT_GROUP_RESERVED(1) or token address for payouts
  splits: JBSplit[]
}

export const JB_SPLITS_ABI = [
  // Read function - get splits for a project/ruleset/group
  {
    name: 'splitsOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
      { name: 'group', type: 'uint256' },
    ],
    outputs: [
      {
        name: 'splits',
        type: 'tuple[]',
        components: [
          { name: 'preferAddToBalance', type: 'bool' },
          { name: 'percent', type: 'uint32' },
          { name: 'projectId', type: 'uint64' },
          { name: 'beneficiary', type: 'address' },
          { name: 'lockedUntil', type: 'uint48' },
          { name: 'hook', type: 'address' },
        ],
      },
    ],
  },
  // Write function - set splits for a project/ruleset
  // Only callable by project owner or operator with SET_SPLITS permission
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
              { name: 'projectId', type: 'uint64' },
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

// IMPORTANT: Locked splits cannot be modified
// A split with lockedUntil > now cannot be changed until after that timestamp
// When setting new splits, locked splits from current config MUST be included unchanged
