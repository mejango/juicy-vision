// REVDeployer ABI - Juicebox V6 (revnet-core)
// Contract Address: 0xb552eb94284f94b833837d4b2cbb237128415d4e (same on all chains)
// V6 notes: deployFor is payable (project creation fee) and takes accounting contexts directly
// (no terminal configurations / buyback hook configuration params). Revnet project NFTs are
// owned by the singleton REVOwner, which exposes tiered721HookOf(revnetId).
// Generated from deploy-all-v6/deployments/ethereum/REVDeployer.json (Juicebox V6).
// Regenerate with scripts in deploy-all-v6; do not hand-edit ABI fragments.

export const REV_DEPLOYER_ADDRESS = '0xb552eb94284f94b833837d4b2cbb237128415d4e' as const

// Singleton owner contract for all V6 revnets (holds the project NFTs + 721 hook mapping)
export const REV_OWNER_ADDRESS = '0x2ba4705ad0332cdfb299b452068438bcba3faaf3' as const

export const REV_DEPLOYER_ABI = [
  {
    "type": "function",
    "name": "deployFor",
    "inputs": [
      {
        "name": "revnetId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "configuration",
        "type": "tuple",
        "internalType": "struct REVConfig",
        "components": [
          {
            "name": "description",
            "type": "tuple",
            "internalType": "struct REVDescription",
            "components": [
              {
                "name": "name",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "ticker",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "uri",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "salt",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "baseCurrency",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "scopeCashOutsToLocalBalances",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "stageConfigurations",
            "type": "tuple[]",
            "internalType": "struct REVStageConfig[]",
            "components": [
              {
                "name": "startsAtOrAfter",
                "type": "uint48",
                "internalType": "uint48"
              },
              {
                "name": "autoIssuances",
                "type": "tuple[]",
                "internalType": "struct REVAutoIssuance[]",
                "components": [
                  {
                    "name": "chainId",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "count",
                    "type": "uint104",
                    "internalType": "uint104"
                  },
                  {
                    "name": "beneficiary",
                    "type": "address",
                    "internalType": "address"
                  }
                ]
              },
              {
                "name": "splitPercent",
                "type": "uint16",
                "internalType": "uint16"
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
              },
              {
                "name": "initialIssuance",
                "type": "uint112",
                "internalType": "uint112"
              },
              {
                "name": "issuanceCutFrequency",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "issuanceCutPercent",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "cashOutTaxRate",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "extraMetadata",
                "type": "uint16",
                "internalType": "uint16"
              }
            ]
          }
        ]
      },
      {
        "name": "accountingContextsToAccept",
        "type": "tuple[]",
        "internalType": "struct JBAccountingContext[]",
        "components": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "decimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "currency",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "name": "suckerDeploymentConfiguration",
        "type": "tuple",
        "internalType": "struct REVSuckerDeploymentConfig",
        "components": [
          {
            "name": "deployerConfigurations",
            "type": "tuple[]",
            "internalType": "struct JBSuckerDeployerConfig[]",
            "components": [
              {
                "name": "deployer",
                "type": "address",
                "internalType": "contract IJBSuckerDeployer"
              },
              {
                "name": "peer",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "mappings",
                "type": "tuple[]",
                "internalType": "struct JBTokenMapping[]",
                "components": [
                  {
                    "name": "localToken",
                    "type": "address",
                    "internalType": "address"
                  },
                  {
                    "name": "minGas",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "remoteToken",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  }
                ]
              }
            ]
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hook",
        "type": "address",
        "internalType": "contract IJB721TiersHook"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "deployFor",
    "inputs": [
      {
        "name": "revnetId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "configuration",
        "type": "tuple",
        "internalType": "struct REVConfig",
        "components": [
          {
            "name": "description",
            "type": "tuple",
            "internalType": "struct REVDescription",
            "components": [
              {
                "name": "name",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "ticker",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "uri",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "salt",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "baseCurrency",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "scopeCashOutsToLocalBalances",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "stageConfigurations",
            "type": "tuple[]",
            "internalType": "struct REVStageConfig[]",
            "components": [
              {
                "name": "startsAtOrAfter",
                "type": "uint48",
                "internalType": "uint48"
              },
              {
                "name": "autoIssuances",
                "type": "tuple[]",
                "internalType": "struct REVAutoIssuance[]",
                "components": [
                  {
                    "name": "chainId",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "count",
                    "type": "uint104",
                    "internalType": "uint104"
                  },
                  {
                    "name": "beneficiary",
                    "type": "address",
                    "internalType": "address"
                  }
                ]
              },
              {
                "name": "splitPercent",
                "type": "uint16",
                "internalType": "uint16"
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
              },
              {
                "name": "initialIssuance",
                "type": "uint112",
                "internalType": "uint112"
              },
              {
                "name": "issuanceCutFrequency",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "issuanceCutPercent",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "cashOutTaxRate",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "extraMetadata",
                "type": "uint16",
                "internalType": "uint16"
              }
            ]
          }
        ]
      },
      {
        "name": "accountingContextsToAccept",
        "type": "tuple[]",
        "internalType": "struct JBAccountingContext[]",
        "components": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "decimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "currency",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "name": "suckerDeploymentConfiguration",
        "type": "tuple",
        "internalType": "struct REVSuckerDeploymentConfig",
        "components": [
          {
            "name": "deployerConfigurations",
            "type": "tuple[]",
            "internalType": "struct JBSuckerDeployerConfig[]",
            "components": [
              {
                "name": "deployer",
                "type": "address",
                "internalType": "contract IJBSuckerDeployer"
              },
              {
                "name": "peer",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "mappings",
                "type": "tuple[]",
                "internalType": "struct JBTokenMapping[]",
                "components": [
                  {
                    "name": "localToken",
                    "type": "address",
                    "internalType": "address"
                  },
                  {
                    "name": "minGas",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "remoteToken",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  }
                ]
              }
            ]
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "tiered721HookConfiguration",
        "type": "tuple",
        "internalType": "struct REVDeploy721TiersHookConfig",
        "components": [
          {
            "name": "baseline721HookConfiguration",
            "type": "tuple",
            "internalType": "struct REVBaseline721HookConfig",
            "components": [
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
                "name": "tokenUriResolver",
                "type": "address",
                "internalType": "contract IJB721TokenUriResolver"
              },
              {
                "name": "contractUri",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "tiersConfig",
                "type": "tuple",
                "internalType": "struct JB721InitTiersConfig",
                "components": [
                  {
                    "name": "tiers",
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
                    "name": "currency",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "decimals",
                    "type": "uint8",
                    "internalType": "uint8"
                  }
                ]
              },
              {
                "name": "flags",
                "type": "tuple",
                "internalType": "struct REV721TiersHookFlags",
                "components": [
                  {
                    "name": "noNewTiersWithReserves",
                    "type": "bool",
                    "internalType": "bool"
                  },
                  {
                    "name": "noNewTiersWithVotes",
                    "type": "bool",
                    "internalType": "bool"
                  },
                  {
                    "name": "noNewTiersWithOwnerMinting",
                    "type": "bool",
                    "internalType": "bool"
                  },
                  {
                    "name": "preventOverspending",
                    "type": "bool",
                    "internalType": "bool"
                  }
                ]
              }
            ]
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "preventOperatorAdjustingTiers",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "preventOperatorUpdatingMetadata",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "preventOperatorMinting",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "preventOperatorIncreasingDiscountPercent",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      },
      {
        "name": "allowedPosts",
        "type": "tuple[]",
        "internalType": "struct REVCroptopAllowedPost[]",
        "components": [
          {
            "name": "category",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "minimumPrice",
            "type": "uint104",
            "internalType": "uint104"
          },
          {
            "name": "minimumTotalSupply",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maximumTotalSupply",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maximumSplitPercent",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "allowedAddresses",
            "type": "address[]",
            "internalType": "address[]"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hook",
        "type": "address",
        "internalType": "contract IJB721TiersHook"
      }
    ],
    "stateMutability": "payable"
  }
] as const

const REV_OWNER_ABI = [
  {
    "type": "function",
    "name": "tiered721HookOf",
    "inputs": [
      {
        "name": "revnetId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "tiered721Hook",
        "type": "address",
        "internalType": "contract IJB721TiersHook"
      }
    ],
    "stateMutability": "view"
  }
] as const

// tiered721HookOf lives on REVOwner: query REVOwner for a revnet's 721 hook.
export const REV_OWNER_TIERED_721_HOOK_ABI = REV_OWNER_ABI
