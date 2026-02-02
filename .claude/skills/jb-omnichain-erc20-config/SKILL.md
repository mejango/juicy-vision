---
name: jb-omnichain-erc20-config
description: |
  Fix omnichain Juicebox V5 deployments using wrong ERC20 token addresses across chains.
  Use when: (1) USDC-based project sends same token address to all chains despite each chain
  having different USDC addresses, (2) sucker configs use NATIVE_TOKEN instead of ERC20
  addresses, (3) contract reverts at SUCKER_REGISTRY.deploySuckersFor(), (4) terminal
  configurations don't reflect per-chain token addresses, (5) deploying revnets or 721
  tier projects with ERC20 tokens. Covers JBOmnichainDeployer, REVDeployer, sucker token
  mappings, and per-chain terminal configuration overrides.
author: Claude Code
version: 1.1.0
date: 2026-02-01
---

# Juicebox V5 Omnichain ERC20 Token Configuration

## Problem
When deploying Juicebox V5 projects across multiple chains with ERC20 tokens (e.g., USDC),
two issues can occur:
1. Terminal configurations use the same token address for all chains (e.g., Sepolia USDC
   address sent to Base Sepolia)
2. Sucker (cross-chain bridge) configurations hardcode NATIVE_TOKEN instead of using the
   actual ERC20 token addresses for each chain

## Context / Trigger Conditions
- Deploying to multiple chains via JBOmnichainDeployer
- Project accepts ERC20 tokens (USDC, etc.) instead of or in addition to ETH
- Contract reverts at `SUCKER_REGISTRY.deploySuckersFor()`
- Transaction preview shows wrong token address for non-primary chains
- Each chain has different token contract addresses (USDC addresses differ per chain)

**Example per-chain USDC addresses (testnets):**
- Sepolia: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
- OP Sepolia: `0x5fd84259d66Cd46123540766Be93DFE6D43130D7`
- Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Arb Sepolia: `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`

## Solution

### 1. Support Per-Chain Terminal Configuration Overrides

Add `chainConfigs` parameter to pass per-chain terminal configurations:

```typescript
interface ChainConfigOverride {
  chainId: number
  terminalConfigurations?: JBTerminalConfig[]
}

function buildOmnichainLaunchTransactions(params: {
  chainIds: number[]
  terminalConfigurations: JBTerminalConfig[]  // Default configs
  chainConfigs?: ChainConfigOverride[]        // Per-chain overrides
  // ...other params
})
```

### 2. Apply Per-Chain Overrides in Transaction Building

```typescript
// Build map of chainId -> config
const chainConfigMap = new Map<number, ChainConfigOverride>()
for (const cfg of chainConfigs) {
  chainConfigMap.set(cfg.chainId, cfg)
}

// For each chain, use override if available
const transactions = chainIds.map(chainId => {
  const chainConfig = chainConfigMap.get(chainId)
  const terminalConfigurations = chainConfig?.terminalConfigurations ?? params.terminalConfigurations

  return buildLaunchProjectTransaction({
    ...params,
    terminalConfigurations,  // Per-chain terminals
    chainId,
  })
})
```

### 3. Extract ERC20 Token Addresses for Sucker Config

```typescript
// Extract per-chain token addresses from terminal configs
const tokenAddresses: Record<number, `0x${string}`> = {}
for (const chainId of chainIds) {
  const chainConfig = chainConfigMap.get(chainId)
  const terminalConfigs = chainConfig?.terminalConfigurations ?? params.terminalConfigurations

  for (const terminal of terminalConfigs) {
    for (const ctx of terminal.accountingContextsToAccept) {
      // Skip native token, capture ERC20
      if (ctx.token?.toLowerCase() !== '0x000000000000000000000000000000000000eeee') {
        tokenAddresses[chainId] = ctx.token as `0x${string}`
        break
      }
    }
  }
}
```

### 4. Update Sucker Config Generation

```typescript
interface ParseSuckerDeployerConfigOptions {
  minBridgeAmount?: bigint
  tokenAddresses?: Record<number, `0x${string}`>  // Per-chain token addresses
}

function parseSuckerDeployerConfig(targetChainId, allChainIds, opts) {
  const localToken = opts.tokenAddresses?.[targetChainId] ?? NATIVE_TOKEN

  // For each remote chain
  for (const remoteChainId of remoteChainIds) {
    const remoteToken = opts.tokenAddresses?.[remoteChainId] ?? NATIVE_TOKEN

    mappings.push({
      localToken,
      minGas: 200_000,
      remoteToken,
      minBridgeAmount: opts.minBridgeAmount ?? DEFAULT_MIN_BRIDGE_AMOUNT,
    })
  }
}
```

## Verification

1. Check console logs show different token addresses per chain
2. Terminal configurations in transaction preview show correct per-chain USDC addresses
3. Sucker config shows correct token mappings (e.g., Sepolia USDC -> OP Sepolia USDC)
4. Transaction simulates successfully without revert at SUCKER_REGISTRY

## Example

When AI provides chainConfigs with per-chain overrides:
```json
{
  "chainConfigs": [
    {"chainId": "11155111", "overrides": {"terminalConfigurations": [
      {"terminal": "0x52869...", "accountingContextsToAccept": [
        {"token": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", "decimals": 6, "currency": 909516616}
      ]}
    ]}},
    {"chainId": "84532", "overrides": {"terminalConfigurations": [
      {"terminal": "0x52869...", "accountingContextsToAccept": [
        {"token": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "decimals": 6, "currency": 3169378579}
      ]}
    ]}}
  ]
}
```

The system will:
1. Use correct USDC address per chain in terminal configurations
2. Generate sucker mappings pairing USDC addresses across chains

## Critical Gotcha: Preview vs Launch Data Separation

**IMPORTANT**: Preview-generated sucker configs are for DISPLAY ONLY.

The preview component may generate sucker configs for the first chain to show in the UI.
If this config is passed to the launch function, `buildOmnichainLaunchTransactions` will
see non-empty `deployerConfigurations` and use that SAME config for ALL chains!

**Wrong pattern:**
```typescript
// Preview generates config for first chain
const suckerConfig = parseSuckerDeployerConfig(firstChainId, allChainIds, opts)

// DON'T pass this to launch!
await launch({ suckerDeploymentConfiguration: suckerConfig })  // BUG!
```

**Correct pattern:**
```typescript
// Preview generates config for display only
const previewConfig = parseSuckerDeployerConfig(firstChainId, allChainIds, opts)
// Show previewConfig in UI...

// DON'T pass suckerDeploymentConfiguration - let buildOmnichainLaunchTransactions
// auto-generate correct per-chain configs
await launch({ chainConfigs })  // No suckerDeploymentConfiguration!
```

## Extracting Project IDs After Deployment

After deployment, extract project IDs from transaction receipts:

```typescript
async function getProjectIdFromReceipt(chainId: number, txHash: `0x${string}`): Promise<number | null> {
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash })
  // Project ID is in first log's first indexed parameter (topics[1])
  // topics[0] is event signature, topics[1] is first indexed param
  const projectIdHex = receipt.logs[0]?.topics[1]
  return projectIdHex ? Number(BigInt(projectIdHex)) : null
}
```

## Notes

- JBTokenMapping Solidity struct order: `localToken, minGas, remoteToken, minBridgeAmount`
- Same CCIP sucker deployer address is used on both sides of each chain pair
- Salt must be shared across all chains for deterministic sucker addresses
- Currency values differ per chain even for the same token (USDC)
- Terminal addresses may be the same across chains (JBMultiTerminal), but token addresses differ
- Sucker deployers are organized by chain PAIR, not per-chain. E.g., ETH↔OP deployer handles both directions.
- For testnets use short names: SEP, OPSEP, BASESEP, ARBSEP

## Applying to Revnets and 721 Deployments

The same patterns apply to revnet and NFT tier deployments:

### Revnets with ERC20 Tokens

```typescript
// useOmnichainDeployRevnet now accepts chainConfigs and terminalConfigurations
await deploy({
  chainIds: [11155111, 11155420, 84532],
  stageConfigurations: [{ ... }],
  splitOperator: '0x...',
  name: 'My Revnet',
  tagline: 'USDC-based revnet',
  terminalConfigurations: [{ ... }],  // Default terminals
  chainConfigs: [                      // Per-chain overrides
    { chainId: 11155111, terminalConfigurations: [{ token: SEPOLIA_USDC, ... }] },
    { chainId: 11155420, terminalConfigurations: [{ token: OP_SEP_USDC, ... }] },
    { chainId: 84532, terminalConfigurations: [{ token: BASE_SEP_USDC, ... }] },
  ],
  // DON'T pass suckerDeploymentConfiguration - auto-generated per-chain
})
```

### 721 Tier Deployments

```typescript
// buildOmnichainLaunch721RulesetsTransactions supports chainConfigs
const transactions = buildOmnichainLaunch721RulesetsTransactions({
  chainIds: [11155111, 11155420],
  projectId: 123,
  deployTiersHookConfig: { ... },
  launchRulesetsConfig: { ... },
  chainConfigs: [  // Per-chain terminal overrides
    { chainId: 11155111, terminalConfigurations: [{ token: SEPOLIA_USDC, ... }] },
    { chainId: 11155420, terminalConfigurations: [{ token: OP_SEP_USDC, ... }] },
  ],
})
```

### Sucker Deployments

The `buildOmnichainDeploySuckersTransactions` function now auto-generates correct
chain-pair specific deployers instead of using the same deployer for all chains:

```typescript
// Auto-generates correct deployers for each chain pair
const transactions = buildOmnichainDeploySuckersTransactions({
  chainIds: [11155111, 11155420, 84532],
  projectIds: { 11155111: 1, 11155420: 2, 84532: 3 },
  salt: '0x...',
  tokenMappings: [{ ... }],
  // Don't need deployerOverrides - auto-determined from chain pairs
})
```

## Related Skills
- jb-permit2-metadata: For Permit2 gasless ERC20 payments
- jb-suckers: Cross-chain token bridging mechanics
- jb-terminal-selection: Dynamic terminal selection for multi-token support
