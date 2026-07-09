// JBSuckerRegistry ABI - Juicebox V6
// Contract Address: 0x7903a854ae91eaf635430d120a1a434085cef297 (same on all chains)
// V6 notes: JBSuckerDeployerConfig gained a `peer` (bytes32; zero = default same-address peer);
// JBTokenMapping.remoteToken is now bytes32 and minBridgeAmount was removed.
// Generated from deploy-all-v6/deployments/ethereum/JBSuckerRegistry.json (Juicebox V6).
// Regenerate with scripts in deploy-all-v6; do not hand-edit ABI fragments.

export const JB_SUCKER_REGISTRY_ADDRESS = '0x7903a854ae91eaf635430d120a1a434085cef297' as const

export const JB_SUCKER_REGISTRY_ABI = [
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
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "configurations",
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
    "name": "isSuckerOf",
    "inputs": [
      {
        "name": "projectId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "addr",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "suckersOf",
    "inputs": [
      {
        "name": "projectId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "suckers",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "view"
  }
] as const
