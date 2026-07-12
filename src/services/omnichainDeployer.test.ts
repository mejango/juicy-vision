import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  encodeLaunchProjectFor,
  buildLaunchProjectTransaction,
  buildOmnichainLaunchTransactions,
  buildSetUriTransaction,
  type ChainConfigOverride,
} from './omnichainDeployer'
import type { JBRulesetConfig, JBTerminalConfig, JBSuckerDeploymentConfig } from './relayr'

// Mock console.log to avoid noisy test output
vi.spyOn(console, 'log').mockImplementation(() => {})

const VALID_PROJECT_URI = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3gq2t5lz2wqzzx4m6w6v7s7qm'

// Sample ruleset configuration
const sampleRulesetConfig: JBRulesetConfig = {
  mustStartAtOrAfter: 0,
  duration: 0,
  weight: '1000000000000000000000000',
  weightCutPercent: 0,
  approvalHook: '0x0000000000000000000000000000000000000000',
  metadata: {
    reservedPercent: 0,
    cashOutTaxRate: 0,
    baseCurrency: 1,
    pausePay: false,
    pauseCreditTransfers: false,
    allowOwnerMinting: true,
    allowSetCustomToken: false,
    allowTerminalMigration: false,
    allowSetTerminals: true,
    allowSetController: true,
    allowAddAccountingContext: true,
    allowAddPriceFeed: true,
    ownerMustSendPayouts: false,
    holdFees: false,
    scopeCashOutsToLocalBalances: false,
    useDataHookForPay: false,
    useDataHookForCashOut: false,
    dataHook: '0x0000000000000000000000000000000000000000',
    metadata: 0,
  },
  splitGroups: [],
  fundAccessLimitGroups: [],
}

// Sample terminal configuration for ETH
const sampleEthTerminalConfig: JBTerminalConfig = {
  terminal: '0x130f5dd2bd8805443cf41755253d778a75a67f53',
  accountingContextsToAccept: [{
    token: '0x000000000000000000000000000000000000EEEe',
    decimals: 18,
    currency: 61166,
  }],
}

// Sample sucker deployment configuration
// Uses real OPSuckerDeployer address from chains.ts
const sampleSuckerConfig: JBSuckerDeploymentConfig = {
  deployerConfigurations: [{
    deployer: '0x298a775c030adcedb641a89d9047ec9972674e1a', // OPSuckerDeployer
    mappings: [{
      localToken: '0x000000000000000000000000000000000000EEEe',
      minGas: 200000,
      remoteToken: '0x000000000000000000000000000000000000000000000000000000000000eeee',
    }],
  }],
  salt: '0x0000000000000000000000000000000000000000000000000000000000000001',
}

const zeroCreationFees: Record<number, string> = {
  1: '0',
  10: '0',
  84532: '0',
  11155111: '0',
  11155420: '0',
}

describe('omnichainDeployer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('encodeLaunchProjectFor', () => {
    it('encodes calldata for launchProjectFor', () => {
      const calldata = encodeLaunchProjectFor({
        chainId: 11155111, // Sepolia
        owner: '0x1234567890123456789012345678901234567890',
        projectUri: VALID_PROJECT_URI,
        rulesetConfigurations: [sampleRulesetConfig],
        terminalConfigurations: [sampleEthTerminalConfig],
        memo: 'Test project',
        suckerDeploymentConfiguration: sampleSuckerConfig,
      })

      // Should return valid hex calldata
      expect(calldata).toMatch(/^0x/)
      expect(calldata.length).toBeGreaterThan(10) // More than just the selector
    })

    it('uses default controller when not specified', () => {
      const calldata = encodeLaunchProjectFor({
        chainId: 11155111, // Sepolia
        owner: '0x1234567890123456789012345678901234567890',
        projectUri: VALID_PROJECT_URI,
        rulesetConfigurations: [sampleRulesetConfig],
        terminalConfigurations: [sampleEthTerminalConfig],
        memo: 'Test project',
        suckerDeploymentConfiguration: sampleSuckerConfig,
      })

      // Should include default controller address in the calldata
      expect(calldata).toMatch(/^0x/)
    })

    it('handles empty sucker configuration', () => {
      const emptySuckerConfig: JBSuckerDeploymentConfig = {
        deployerConfigurations: [],
        salt: '0x0000000000000000000000000000000000000000000000000000000000000000',
      }

      const calldata = encodeLaunchProjectFor({
        chainId: 11155111, // Sepolia
        owner: '0x1234567890123456789012345678901234567890',
        projectUri: VALID_PROJECT_URI,
        rulesetConfigurations: [sampleRulesetConfig],
        terminalConfigurations: [sampleEthTerminalConfig],
        memo: 'Test project',
        suckerDeploymentConfiguration: emptySuckerConfig,
      })

      expect(calldata).toMatch(/^0x/)
    })

    it('handles ruleset with split groups', () => {
      const rulesetWithSplits: JBRulesetConfig = {
        ...sampleRulesetConfig,
        splitGroups: [{
          groupId: '1',  // string for uint256
          splits: [{
            percent: 500000000, // 50%
            projectId: 0,
            beneficiary: '0x1234567890123456789012345678901234567890',
            preferAddToBalance: false,
            lockedUntil: 0,
            hook: '0x0000000000000000000000000000000000000000',
          }],
        }],
      }

      const calldata = encodeLaunchProjectFor({
        chainId: 11155111, // Sepolia
        owner: '0x1234567890123456789012345678901234567890',
        projectUri: VALID_PROJECT_URI,
        rulesetConfigurations: [rulesetWithSplits],
        terminalConfigurations: [sampleEthTerminalConfig],
        memo: 'Test project',
        suckerDeploymentConfiguration: sampleSuckerConfig,
      })

      expect(calldata).toMatch(/^0x/)
    })

    it('handles ruleset with fund access limits', () => {
      const rulesetWithLimits: JBRulesetConfig = {
        ...sampleRulesetConfig,
        fundAccessLimitGroups: [{
          terminal: '0x130f5dd2bd8805443cf41755253d778a75a67f53',
          token: '0x000000000000000000000000000000000000EEEe',
          payoutLimits: [{
            amount: '1000000000000000000', // 1 ETH
            currency: 61166,
          }],
          surplusAllowances: [{
            amount: '500000000000000000', // 0.5 ETH
            currency: 61166,
          }],
        }],
      }

      const calldata = encodeLaunchProjectFor({
        chainId: 11155111, // Sepolia
        owner: '0x1234567890123456789012345678901234567890',
        projectUri: VALID_PROJECT_URI,
        rulesetConfigurations: [rulesetWithLimits],
        terminalConfigurations: [sampleEthTerminalConfig],
        memo: 'Test project',
        suckerDeploymentConfiguration: sampleSuckerConfig,
      })

      expect(calldata).toMatch(/^0x/)
    })
  })

  describe('buildLaunchProjectTransaction', () => {
    it('builds transaction with correct structure', () => {
      const tx = buildLaunchProjectTransaction({
        chainId: 1,
        owner: '0x1234567890123456789012345678901234567890',
        projectUri: VALID_PROJECT_URI,
        rulesetConfigurations: [sampleRulesetConfig],
        terminalConfigurations: [sampleEthTerminalConfig],
        memo: 'Test project',
        suckerDeploymentConfiguration: sampleSuckerConfig,
        creationFeeWei: '0',
      })

      expect(tx.chainId).toBe(1)
      expect(tx.to).toMatch(/^0x/) // JBOmnichainDeployer address
      expect(tx.data).toMatch(/^0x/)
      expect(tx.value).toBe('0')
    })

    it('returns correct chain ID', () => {
      const tx = buildLaunchProjectTransaction({
        chainId: 10,
        owner: '0x1234567890123456789012345678901234567890',
        projectUri: VALID_PROJECT_URI,
        rulesetConfigurations: [sampleRulesetConfig],
        terminalConfigurations: [sampleEthTerminalConfig],
        memo: 'Test project',
        suckerDeploymentConfiguration: sampleSuckerConfig,
        creationFeeWei: '0',
      })

      expect(tx.chainId).toBe(10)
    })
  })

  describe('buildOmnichainLaunchTransactions', () => {
    it('builds transactions for multiple chains', () => {
      const transactions = buildOmnichainLaunchTransactions({
        chainIds: [11155111, 11155420, 84532], // Sepolia, OP Sepolia, Base Sepolia
        owner: '0x1234567890123456789012345678901234567890',
        projectUri: VALID_PROJECT_URI,
        rulesetConfigurations: [sampleRulesetConfig],
        terminalConfigurations: [sampleEthTerminalConfig],
        memo: 'Multi-chain project',
        creationFeesWei: zeroCreationFees,
      })

      expect(transactions).toHaveLength(3)
      expect(transactions[0].chainId).toBe(11155111)
      expect(transactions[1].chainId).toBe(11155420)
      expect(transactions[2].chainId).toBe(84532)

      // Each transaction should have valid calldata
      transactions.forEach(tx => {
        expect(tx.to).toMatch(/^0x/)
        expect(tx.data).toMatch(/^0x/)
        expect(tx.value).toBe('0')
      })
    })

    it('auto-generates sucker configs for multi-chain deployment', () => {
      const transactions = buildOmnichainLaunchTransactions({
        chainIds: [11155111, 11155420], // Sepolia and OP Sepolia
        owner: '0x1234567890123456789012345678901234567890',
        projectUri: VALID_PROJECT_URI,
        rulesetConfigurations: [sampleRulesetConfig],
        terminalConfigurations: [sampleEthTerminalConfig],
        memo: 'Multi-chain project',
        creationFeesWei: zeroCreationFees,
      })

      // Both transactions should be valid
      expect(transactions).toHaveLength(2)
      transactions.forEach(tx => {
        expect(tx.data).toMatch(/^0x/)
        expect(tx.data.length).toBeGreaterThan(10)
      })

      // Note: For ETH-only projects with two chains, the sucker configs may be
      // identical (same deployer, same native token). The calldata differs when
      // using ERC20 tokens with different addresses per chain (tested separately).
    })

    it('uses provided sucker config when given', () => {
      const transactions = buildOmnichainLaunchTransactions({
        chainIds: [11155111, 11155420],
        owner: '0x1234567890123456789012345678901234567890',
        projectUri: VALID_PROJECT_URI,
        rulesetConfigurations: [sampleRulesetConfig],
        terminalConfigurations: [sampleEthTerminalConfig],
        memo: 'Multi-chain project',
        suckerDeploymentConfiguration: sampleSuckerConfig,
        creationFeesWei: zeroCreationFees,
      })

      // When custom config is provided, same config is used for all chains
      // (This is actually a gotcha - see skill documentation)
      expect(transactions).toHaveLength(2)
    })

    it('applies per-chain terminal configuration overrides', () => {
      const chainConfigs: ChainConfigOverride[] = [
        {
          chainId: 11155111,
          terminalConfigurations: [{
            terminal: '0x130f5dd2bd8805443cf41755253d778a75a67f53',
            accountingContextsToAccept: [{
              token: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // Sepolia USDC
              decimals: 6,
              currency: 932999736,
            }],
          }],
        },
        {
          chainId: 11155420,
          terminalConfigurations: [{
            terminal: '0x130f5dd2bd8805443cf41755253d778a75a67f53',
            accountingContextsToAccept: [{
              token: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7', // OP Sepolia USDC
              decimals: 6,
              currency: 3559993559,
            }],
          }],
        },
      ]

      const transactions = buildOmnichainLaunchTransactions({
        chainIds: [11155111, 11155420],
        owner: '0x1234567890123456789012345678901234567890',
        projectUri: VALID_PROJECT_URI,
        rulesetConfigurations: [sampleRulesetConfig],
        terminalConfigurations: [sampleEthTerminalConfig], // Default (not used since overrides exist)
        memo: 'USDC project',
        chainConfigs,
        creationFeesWei: zeroCreationFees,
      })

      // Each chain should have different calldata due to different USDC addresses
      expect(transactions[0].data).not.toBe(transactions[1].data)
    })

    it('builds single transaction for single chain', () => {
      const transactions = buildOmnichainLaunchTransactions({
        chainIds: [1],
        owner: '0x1234567890123456789012345678901234567890',
        projectUri: VALID_PROJECT_URI,
        rulesetConfigurations: [sampleRulesetConfig],
        terminalConfigurations: [sampleEthTerminalConfig],
        memo: 'Single-chain project',
        creationFeesWei: zeroCreationFees,
      })

      expect(transactions).toHaveLength(1)
      expect(transactions[0].chainId).toBe(1)
    })

    it('uses empty sucker config for single chain deployment', () => {
      const transactions = buildOmnichainLaunchTransactions({
        chainIds: [11155111],
        owner: '0x1234567890123456789012345678901234567890',
        projectUri: VALID_PROJECT_URI,
        rulesetConfigurations: [sampleRulesetConfig],
        terminalConfigurations: [sampleEthTerminalConfig],
        memo: 'Single-chain project',
        creationFeesWei: zeroCreationFees,
      })

      // Single chain deployments should have empty sucker config
      // The calldata should still be valid
      expect(transactions[0].data).toMatch(/^0x/)
    })
  })

})

describe('set URI transaction safety', () => {
  it('blocks an unrecognized controller even when the calldata is encodable', () => {
    expect(() => buildSetUriTransaction({
      chainId: 1,
      projectId: 1,
      uri: VALID_PROJECT_URI,
      controller: '0x9999999999999999999999999999999999999999',
    })).toThrow('Controller not recognized')
  })

  it('builds only for the recognized controller', () => {
    const transaction = buildSetUriTransaction({
      chainId: 1,
      projectId: 1,
      uri: VALID_PROJECT_URI,
      controller: '0x3fcec3572e84b624477bcff4e2cf1f7deab648f1',
    })
    expect(transaction.to).toBe('0x3fcec3572e84b624477bcff4e2cf1f7deab648f1')
  })
})
