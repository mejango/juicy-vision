// JB721TiersHook ABI - Juicebox V6 (nana-721-hook)
// Note: Hook address is per-project, not a fixed contract address
// V6 notes: tier config uses a nested `flags` tuple (7 bools incl. cantBuyWithCredits),
// `encodedIpfsUri` casing, per-tier `splitPercent` + `splits`; setMetadata now includes
// name/symbol; mintFor takes (uint16[] tierIds, address beneficiary).
// Generated from deploy-all-v6/deployments/ethereum/JB721TiersHook.json (Juicebox V6).
// Regenerate with scripts in deploy-all-v6; do not hand-edit ABI fragments.

export const JB_721_TIERS_HOOK_ABI = [
  {
    "type": "function",
    "name": "adjustTiers",
    "inputs": [
      {
        "name": "tiersToAdd",
        "type": "tuple[]",
        "internalType": "struct JB721TierConfig[]",
        "components": [
          {
            "name": "price",
            "type": "uint104",
            "internalType": "uint104"
          },
          {
            "name": "initialSupply",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "votingUnits",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "reserveFrequency",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "reserveBeneficiary",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "encodedIpfsUri",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "category",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "discountPercent",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "flags",
            "type": "tuple",
            "internalType": "struct JB721TierConfigFlags",
            "components": [
              {
                "name": "allowOwnerMint",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "useReserveBeneficiaryAsDefault",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "transfersPausable",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "useVotingUnits",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "cantBeRemoved",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "cantIncreaseDiscountPercent",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "cantBuyWithCredits",
                "type": "bool",
                "internalType": "bool"
              }
            ]
          },
          {
            "name": "splitPercent",
            "type": "uint32",
            "internalType": "uint32"
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
      },
      {
        "name": "tierIdsToRemove",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "mintFor",
    "inputs": [
      {
        "name": "tierIds",
        "type": "uint16[]",
        "internalType": "uint16[]"
      },
      {
        "name": "beneficiary",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "tokenIds",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "mintPendingReservesFor",
    "inputs": [
      {
        "name": "tierId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "mintPendingReservesFor",
    "inputs": [
      {
        "name": "reserveMintConfigs",
        "type": "tuple[]",
        "internalType": "struct JB721TiersMintReservesConfig[]",
        "components": [
          {
            "name": "tierId",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "count",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setDiscountPercentsOf",
    "inputs": [
      {
        "name": "configs",
        "type": "tuple[]",
        "internalType": "struct JB721TiersSetDiscountPercentConfig[]",
        "components": [
          {
            "name": "tierId",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "discountPercent",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setMetadata",
    "inputs": [
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "symbol",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "baseUri",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "contractUri",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "tokenUriResolver",
        "type": "address",
        "internalType": "contract IJB721TokenUriResolver"
      },
      {
        "name": "encodedIpfsUriTierId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "encodedIpfsUri",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  }
] as const
