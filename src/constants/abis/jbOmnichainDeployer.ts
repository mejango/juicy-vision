// JBOmnichainDeployer ABI - Juicebox V6
// Contract Address: 0xb853758a70a6b4216c09f1d071ea2344aba0a34f (same on all chains)
// V6 notes: no `controller` parameter (the deployer is wired to the canonical JBController);
// launchProjectFor is payable (msg.value must equal JBProjects.creationFee());
// 721 variants are overloads taking a JBOmnichain721Config `deploy721Config` argument.
// Generated from deploy-all-v6/deployments/ethereum/JBOmnichainDeployer.json (Juicebox V6).
// Regenerate with scripts in deploy-all-v6; do not hand-edit ABI fragments.

export const JB_OMNICHAIN_DEPLOYER_ADDRESS = '0xb853758a70a6b4216c09f1d071ea2344aba0a34f' as const

export const JB_OMNICHAIN_DEPLOYER_ABI = [
  {
    "type": "function",
    "name": "deploySuckersFor",
    "inputs": [
      {
        "name": "projectId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "suckerDeploymentConfiguration",
        "type": "tuple",
        "internalType": "struct JBSuckerDeploymentConfig",
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
        "name": "suckers",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "extraDataHookOf",
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
      }
    ],
    "outputs": [
      {
        "name": "hook",
        "type": "tuple",
        "internalType": "struct JBDeployerHookConfig",
        "components": [
          {
            "name": "dataHook",
            "type": "address",
            "internalType": "contract IJBRulesetDataHook"
          },
          {
            "name": "useDataHookForPay",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "useDataHookForCashOut",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "launchProjectFor",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "projectUri",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "deploy721Config",
        "type": "tuple",
        "internalType": "struct JBOmnichain721Config",
        "components": [
          {
            "name": "deployTiersHookConfig",
            "type": "tuple",
            "internalType": "struct JBDeploy721TiersHookConfig",
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
                "internalType": "struct JB721TiersHookFlags",
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
                  },
                  {
                    "name": "issueTokensForSplits",
                    "type": "bool",
                    "internalType": "bool"
                  }
                ]
              }
            ]
          },
          {
            "name": "useDataHookForCashOut",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "rulesetConfigurations",
        "type": "tuple[]",
        "internalType": "struct JBRulesetConfig[]",
        "components": [
          {
            "name": "mustStartAtOrAfter",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "duration",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "weight",
            "type": "uint112",
            "internalType": "uint112"
          },
          {
            "name": "weightCutPercent",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "approvalHook",
            "type": "address",
            "internalType": "contract IJBRulesetApprovalHook"
          },
          {
            "name": "metadata",
            "type": "tuple",
            "internalType": "struct JBRulesetMetadata",
            "components": [
              {
                "name": "reservedPercent",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "cashOutTaxRate",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "baseCurrency",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "pausePay",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "pauseCreditTransfers",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowOwnerMinting",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetCustomToken",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowTerminalMigration",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetTerminals",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetController",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowAddAccountingContext",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowAddPriceFeed",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "ownerMustSendPayouts",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "holdFees",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "scopeCashOutsToLocalBalances",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "useDataHookForPay",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "useDataHookForCashOut",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "dataHook",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "metadata",
                "type": "uint16",
                "internalType": "uint16"
              }
            ]
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
          },
          {
            "name": "fundAccessLimitGroups",
            "type": "tuple[]",
            "internalType": "struct JBFundAccessLimitGroup[]",
            "components": [
              {
                "name": "terminal",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "token",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "payoutLimits",
                "type": "tuple[]",
                "internalType": "struct JBCurrencyAmount[]",
                "components": [
                  {
                    "name": "amount",
                    "type": "uint224",
                    "internalType": "uint224"
                  },
                  {
                    "name": "currency",
                    "type": "uint32",
                    "internalType": "uint32"
                  }
                ]
              },
              {
                "name": "surplusAllowances",
                "type": "tuple[]",
                "internalType": "struct JBCurrencyAmount[]",
                "components": [
                  {
                    "name": "amount",
                    "type": "uint224",
                    "internalType": "uint224"
                  },
                  {
                    "name": "currency",
                    "type": "uint32",
                    "internalType": "uint32"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "name": "terminalConfigurations",
        "type": "tuple[]",
        "internalType": "struct JBTerminalConfig[]",
        "components": [
          {
            "name": "terminal",
            "type": "address",
            "internalType": "contract IJBTerminal"
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
          }
        ]
      },
      {
        "name": "memo",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "suckerDeploymentConfiguration",
        "type": "tuple",
        "internalType": "struct JBSuckerDeploymentConfig",
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
        "name": "projectId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hook",
        "type": "address",
        "internalType": "contract IJB721TiersHook"
      },
      {
        "name": "suckers",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "launchProjectFor",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "projectUri",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "rulesetConfigurations",
        "type": "tuple[]",
        "internalType": "struct JBRulesetConfig[]",
        "components": [
          {
            "name": "mustStartAtOrAfter",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "duration",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "weight",
            "type": "uint112",
            "internalType": "uint112"
          },
          {
            "name": "weightCutPercent",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "approvalHook",
            "type": "address",
            "internalType": "contract IJBRulesetApprovalHook"
          },
          {
            "name": "metadata",
            "type": "tuple",
            "internalType": "struct JBRulesetMetadata",
            "components": [
              {
                "name": "reservedPercent",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "cashOutTaxRate",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "baseCurrency",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "pausePay",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "pauseCreditTransfers",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowOwnerMinting",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetCustomToken",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowTerminalMigration",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetTerminals",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetController",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowAddAccountingContext",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowAddPriceFeed",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "ownerMustSendPayouts",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "holdFees",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "scopeCashOutsToLocalBalances",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "useDataHookForPay",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "useDataHookForCashOut",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "dataHook",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "metadata",
                "type": "uint16",
                "internalType": "uint16"
              }
            ]
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
          },
          {
            "name": "fundAccessLimitGroups",
            "type": "tuple[]",
            "internalType": "struct JBFundAccessLimitGroup[]",
            "components": [
              {
                "name": "terminal",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "token",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "payoutLimits",
                "type": "tuple[]",
                "internalType": "struct JBCurrencyAmount[]",
                "components": [
                  {
                    "name": "amount",
                    "type": "uint224",
                    "internalType": "uint224"
                  },
                  {
                    "name": "currency",
                    "type": "uint32",
                    "internalType": "uint32"
                  }
                ]
              },
              {
                "name": "surplusAllowances",
                "type": "tuple[]",
                "internalType": "struct JBCurrencyAmount[]",
                "components": [
                  {
                    "name": "amount",
                    "type": "uint224",
                    "internalType": "uint224"
                  },
                  {
                    "name": "currency",
                    "type": "uint32",
                    "internalType": "uint32"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "name": "terminalConfigurations",
        "type": "tuple[]",
        "internalType": "struct JBTerminalConfig[]",
        "components": [
          {
            "name": "terminal",
            "type": "address",
            "internalType": "contract IJBTerminal"
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
          }
        ]
      },
      {
        "name": "memo",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "suckerDeploymentConfiguration",
        "type": "tuple",
        "internalType": "struct JBSuckerDeploymentConfig",
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
        "name": "projectId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hook",
        "type": "address",
        "internalType": "contract IJB721TiersHook"
      },
      {
        "name": "suckers",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "launchRulesetsFor",
    "inputs": [
      {
        "name": "projectId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "projectUri",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "rulesetConfigurations",
        "type": "tuple[]",
        "internalType": "struct JBRulesetConfig[]",
        "components": [
          {
            "name": "mustStartAtOrAfter",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "duration",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "weight",
            "type": "uint112",
            "internalType": "uint112"
          },
          {
            "name": "weightCutPercent",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "approvalHook",
            "type": "address",
            "internalType": "contract IJBRulesetApprovalHook"
          },
          {
            "name": "metadata",
            "type": "tuple",
            "internalType": "struct JBRulesetMetadata",
            "components": [
              {
                "name": "reservedPercent",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "cashOutTaxRate",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "baseCurrency",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "pausePay",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "pauseCreditTransfers",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowOwnerMinting",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetCustomToken",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowTerminalMigration",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetTerminals",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetController",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowAddAccountingContext",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowAddPriceFeed",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "ownerMustSendPayouts",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "holdFees",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "scopeCashOutsToLocalBalances",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "useDataHookForPay",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "useDataHookForCashOut",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "dataHook",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "metadata",
                "type": "uint16",
                "internalType": "uint16"
              }
            ]
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
          },
          {
            "name": "fundAccessLimitGroups",
            "type": "tuple[]",
            "internalType": "struct JBFundAccessLimitGroup[]",
            "components": [
              {
                "name": "terminal",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "token",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "payoutLimits",
                "type": "tuple[]",
                "internalType": "struct JBCurrencyAmount[]",
                "components": [
                  {
                    "name": "amount",
                    "type": "uint224",
                    "internalType": "uint224"
                  },
                  {
                    "name": "currency",
                    "type": "uint32",
                    "internalType": "uint32"
                  }
                ]
              },
              {
                "name": "surplusAllowances",
                "type": "tuple[]",
                "internalType": "struct JBCurrencyAmount[]",
                "components": [
                  {
                    "name": "amount",
                    "type": "uint224",
                    "internalType": "uint224"
                  },
                  {
                    "name": "currency",
                    "type": "uint32",
                    "internalType": "uint32"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "name": "terminalConfigurations",
        "type": "tuple[]",
        "internalType": "struct JBTerminalConfig[]",
        "components": [
          {
            "name": "terminal",
            "type": "address",
            "internalType": "contract IJBTerminal"
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
          }
        ]
      },
      {
        "name": "memo",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "rulesetId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hook",
        "type": "address",
        "internalType": "contract IJB721TiersHook"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "launchRulesetsFor",
    "inputs": [
      {
        "name": "projectId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "projectUri",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "deploy721Config",
        "type": "tuple",
        "internalType": "struct JBOmnichain721Config",
        "components": [
          {
            "name": "deployTiersHookConfig",
            "type": "tuple",
            "internalType": "struct JBDeploy721TiersHookConfig",
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
                "internalType": "struct JB721TiersHookFlags",
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
                  },
                  {
                    "name": "issueTokensForSplits",
                    "type": "bool",
                    "internalType": "bool"
                  }
                ]
              }
            ]
          },
          {
            "name": "useDataHookForCashOut",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "rulesetConfigurations",
        "type": "tuple[]",
        "internalType": "struct JBRulesetConfig[]",
        "components": [
          {
            "name": "mustStartAtOrAfter",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "duration",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "weight",
            "type": "uint112",
            "internalType": "uint112"
          },
          {
            "name": "weightCutPercent",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "approvalHook",
            "type": "address",
            "internalType": "contract IJBRulesetApprovalHook"
          },
          {
            "name": "metadata",
            "type": "tuple",
            "internalType": "struct JBRulesetMetadata",
            "components": [
              {
                "name": "reservedPercent",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "cashOutTaxRate",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "baseCurrency",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "pausePay",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "pauseCreditTransfers",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowOwnerMinting",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetCustomToken",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowTerminalMigration",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetTerminals",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetController",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowAddAccountingContext",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowAddPriceFeed",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "ownerMustSendPayouts",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "holdFees",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "scopeCashOutsToLocalBalances",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "useDataHookForPay",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "useDataHookForCashOut",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "dataHook",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "metadata",
                "type": "uint16",
                "internalType": "uint16"
              }
            ]
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
          },
          {
            "name": "fundAccessLimitGroups",
            "type": "tuple[]",
            "internalType": "struct JBFundAccessLimitGroup[]",
            "components": [
              {
                "name": "terminal",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "token",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "payoutLimits",
                "type": "tuple[]",
                "internalType": "struct JBCurrencyAmount[]",
                "components": [
                  {
                    "name": "amount",
                    "type": "uint224",
                    "internalType": "uint224"
                  },
                  {
                    "name": "currency",
                    "type": "uint32",
                    "internalType": "uint32"
                  }
                ]
              },
              {
                "name": "surplusAllowances",
                "type": "tuple[]",
                "internalType": "struct JBCurrencyAmount[]",
                "components": [
                  {
                    "name": "amount",
                    "type": "uint224",
                    "internalType": "uint224"
                  },
                  {
                    "name": "currency",
                    "type": "uint32",
                    "internalType": "uint32"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "name": "terminalConfigurations",
        "type": "tuple[]",
        "internalType": "struct JBTerminalConfig[]",
        "components": [
          {
            "name": "terminal",
            "type": "address",
            "internalType": "contract IJBTerminal"
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
          }
        ]
      },
      {
        "name": "memo",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "rulesetId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hook",
        "type": "address",
        "internalType": "contract IJB721TiersHook"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "queueRulesetsOf",
    "inputs": [
      {
        "name": "projectId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "rulesetConfigurations",
        "type": "tuple[]",
        "internalType": "struct JBRulesetConfig[]",
        "components": [
          {
            "name": "mustStartAtOrAfter",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "duration",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "weight",
            "type": "uint112",
            "internalType": "uint112"
          },
          {
            "name": "weightCutPercent",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "approvalHook",
            "type": "address",
            "internalType": "contract IJBRulesetApprovalHook"
          },
          {
            "name": "metadata",
            "type": "tuple",
            "internalType": "struct JBRulesetMetadata",
            "components": [
              {
                "name": "reservedPercent",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "cashOutTaxRate",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "baseCurrency",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "pausePay",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "pauseCreditTransfers",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowOwnerMinting",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetCustomToken",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowTerminalMigration",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetTerminals",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetController",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowAddAccountingContext",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowAddPriceFeed",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "ownerMustSendPayouts",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "holdFees",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "scopeCashOutsToLocalBalances",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "useDataHookForPay",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "useDataHookForCashOut",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "dataHook",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "metadata",
                "type": "uint16",
                "internalType": "uint16"
              }
            ]
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
          },
          {
            "name": "fundAccessLimitGroups",
            "type": "tuple[]",
            "internalType": "struct JBFundAccessLimitGroup[]",
            "components": [
              {
                "name": "terminal",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "token",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "payoutLimits",
                "type": "tuple[]",
                "internalType": "struct JBCurrencyAmount[]",
                "components": [
                  {
                    "name": "amount",
                    "type": "uint224",
                    "internalType": "uint224"
                  },
                  {
                    "name": "currency",
                    "type": "uint32",
                    "internalType": "uint32"
                  }
                ]
              },
              {
                "name": "surplusAllowances",
                "type": "tuple[]",
                "internalType": "struct JBCurrencyAmount[]",
                "components": [
                  {
                    "name": "amount",
                    "type": "uint224",
                    "internalType": "uint224"
                  },
                  {
                    "name": "currency",
                    "type": "uint32",
                    "internalType": "uint32"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "name": "memo",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "rulesetId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hook",
        "type": "address",
        "internalType": "contract IJB721TiersHook"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "queueRulesetsOf",
    "inputs": [
      {
        "name": "projectId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deploy721Config",
        "type": "tuple",
        "internalType": "struct JBOmnichain721Config",
        "components": [
          {
            "name": "deployTiersHookConfig",
            "type": "tuple",
            "internalType": "struct JBDeploy721TiersHookConfig",
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
                "internalType": "struct JB721TiersHookFlags",
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
                  },
                  {
                    "name": "issueTokensForSplits",
                    "type": "bool",
                    "internalType": "bool"
                  }
                ]
              }
            ]
          },
          {
            "name": "useDataHookForCashOut",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "rulesetConfigurations",
        "type": "tuple[]",
        "internalType": "struct JBRulesetConfig[]",
        "components": [
          {
            "name": "mustStartAtOrAfter",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "duration",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "weight",
            "type": "uint112",
            "internalType": "uint112"
          },
          {
            "name": "weightCutPercent",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "approvalHook",
            "type": "address",
            "internalType": "contract IJBRulesetApprovalHook"
          },
          {
            "name": "metadata",
            "type": "tuple",
            "internalType": "struct JBRulesetMetadata",
            "components": [
              {
                "name": "reservedPercent",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "cashOutTaxRate",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "baseCurrency",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "pausePay",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "pauseCreditTransfers",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowOwnerMinting",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetCustomToken",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowTerminalMigration",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetTerminals",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowSetController",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowAddAccountingContext",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "allowAddPriceFeed",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "ownerMustSendPayouts",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "holdFees",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "scopeCashOutsToLocalBalances",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "useDataHookForPay",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "useDataHookForCashOut",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "dataHook",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "metadata",
                "type": "uint16",
                "internalType": "uint16"
              }
            ]
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
          },
          {
            "name": "fundAccessLimitGroups",
            "type": "tuple[]",
            "internalType": "struct JBFundAccessLimitGroup[]",
            "components": [
              {
                "name": "terminal",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "token",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "payoutLimits",
                "type": "tuple[]",
                "internalType": "struct JBCurrencyAmount[]",
                "components": [
                  {
                    "name": "amount",
                    "type": "uint224",
                    "internalType": "uint224"
                  },
                  {
                    "name": "currency",
                    "type": "uint32",
                    "internalType": "uint32"
                  }
                ]
              },
              {
                "name": "surplusAllowances",
                "type": "tuple[]",
                "internalType": "struct JBCurrencyAmount[]",
                "components": [
                  {
                    "name": "amount",
                    "type": "uint224",
                    "internalType": "uint224"
                  },
                  {
                    "name": "currency",
                    "type": "uint32",
                    "internalType": "uint32"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "name": "memo",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "rulesetId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hook",
        "type": "address",
        "internalType": "contract IJB721TiersHook"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "tiered721HookOf",
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
      }
    ],
    "outputs": [
      {
        "name": "hook",
        "type": "address",
        "internalType": "contract IJB721TiersHook"
      },
      {
        "name": "useDataHookForCashOut",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  }
] as const
