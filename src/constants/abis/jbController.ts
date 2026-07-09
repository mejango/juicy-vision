// JBController ABI - Juicebox V6
// Contract Address: 0x3fcec3572e84b624477bcff4e2cf1f7deab648f1 (same on all chains)
// Generated from deploy-all-v6/deployments/ethereum/JBController.json (Juicebox V6).
// Regenerate with scripts in deploy-all-v6; do not hand-edit ABI fragments.

export const JB_CONTROLLER_ADDRESS = '0x3fcec3572e84b624477bcff4e2cf1f7deab648f1' as const

export const JB_CONTROLLER_ABI = [
  {
    "type": "function",
    "name": "currentRulesetOf",
    "inputs": [
      {
        "name": "projectId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "ruleset",
        "type": "tuple",
        "internalType": "struct JBRuleset",
        "components": [
          {
            "name": "cycleNumber",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "id",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "basedOnId",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "start",
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
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
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
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "deployERC20For",
    "inputs": [
      {
        "name": "projectId",
        "type": "uint256",
        "internalType": "uint256"
      },
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
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "contract IJBToken"
      }
    ],
    "stateMutability": "nonpayable"
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
      }
    ],
    "outputs": [
      {
        "name": "projectId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "payable"
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
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "sendReservedTokensToSplitsOf",
    "inputs": [
      {
        "name": "projectId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
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
    "name": "setUriOf",
    "inputs": [
      {
        "name": "projectId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "uri",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  }
] as const
