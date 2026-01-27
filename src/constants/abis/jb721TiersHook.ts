// JB721TiersHook ABI - Version 5
// Source: https://github.com/Bananapus/nana-721-hook-v5
// Note: Hook address is per-project, not a fixed contract address

export const JB_721_TIERS_HOOK_ABI = [
  // adjustTiers - Add new tiers and/or remove existing tiers
  // https://github.com/Bananapus/nana-721-hook-v5/blob/main/src/JB721TiersHook.sol#L444
  {
    name: 'adjustTiers',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'tiersToAdd',
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
      {
        name: 'tierIdsToRemove',
        type: 'uint256[]',
      },
    ],
    outputs: [],
  },
  // setMetadata - Update base URI, contract URI, token URI resolver, or tier IPFS URI
  // https://github.com/Bananapus/nana-721-hook-v5/blob/main/src/JB721TiersHook.sol
  {
    name: 'setMetadata',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'baseUri', type: 'string' },
      { name: 'contractUri', type: 'string' },
      { name: 'tokenUriResolver', type: 'address' },
      { name: 'encodedIPFSTUriTierId', type: 'uint256' },
      { name: 'encodedIPFSUri', type: 'bytes32' },
    ],
    outputs: [],
  },
  // setDiscountPercentOf - Set discount percentage for a single tier
  {
    name: 'setDiscountPercentOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tierId', type: 'uint256' },
      { name: 'discountPercent', type: 'uint256' },
    ],
    outputs: [],
  },
  // setDiscountPercentsOf - Batch set discount percentages for multiple tiers
  {
    name: 'setDiscountPercentsOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'configs',
        type: 'tuple[]',
        components: [
          { name: 'tierId', type: 'uint32' },
          { name: 'discountPercent', type: 'uint16' },
        ],
      },
    ],
    outputs: [],
  },
  // mintPendingReservesFor - Mint pending reserved NFTs for a tier
  // https://github.com/Bananapus/nana-721-hook-v5/blob/main/src/JB721TiersHook.sol#L409
  {
    name: 'mintPendingReservesFor',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tierId', type: 'uint256' },
      { name: 'count', type: 'uint256' },
    ],
    outputs: [],
  },
  // mintFor - Mint specific tiers to beneficiaries (owner only)
  {
    name: 'mintFor',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'mintConfigs',
        type: 'tuple[]',
        components: [
          { name: 'tierId', type: 'uint32' },
          { name: 'count', type: 'uint32' },
          { name: 'beneficiary', type: 'address' },
        ],
      },
    ],
    outputs: [{ name: 'tokenIds', type: 'uint256[]' }],
  },
] as const
