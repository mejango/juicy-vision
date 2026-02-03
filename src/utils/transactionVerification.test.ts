import { describe, it, expect } from 'vitest'
import {
  verifyPayParams,
  verifyCashOutParams,
  verifySendPayoutsParams,
  verifySendReservedTokensParams,
  verifyUseAllowanceParams,
  verifyDeployERC20Params,
  verifyQueueRulesetParams,
  verifyLaunchProjectParams,
  verifyDeployRevnetParams,
  createVerificationResult,
  autoCorrectAddress,
  autoCorrectTerminalConfigurations,
  autoCorrectChainConfigs,
  type TransactionDoubt,
  type VerificationResult,
} from './transactionVerification'
import { NATIVE_TOKEN } from '../constants/abis'

describe('transactionVerification', () => {
  const VALID_ADDRESS = '0x1234567890123456789012345678901234567890'
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
  const INVALID_ADDRESS = '0xinvalid'

  describe('verifyPayParams', () => {
    const validParams = {
      projectId: 1n,
      token: NATIVE_TOKEN,
      amount: 1000000000000000000n, // 1 ETH
      beneficiary: VALID_ADDRESS,
      minReturnedTokens: 0n,
      memo: 'Test payment',
    }

    it('accepts valid parameters', () => {
      const result = verifyPayParams(validParams)
      expect(result.isValid).toBe(true)
      expect(result.doubts.filter(d => d.severity === 'critical')).toHaveLength(0)
    })

    it('accepts string and number project IDs', () => {
      const resultString = verifyPayParams({ ...validParams, projectId: '123' })
      const resultNumber = verifyPayParams({ ...validParams, projectId: 123 })
      expect(resultString.isValid).toBe(true)
      expect(resultNumber.isValid).toBe(true)
    })

    it('rejects invalid project ID (zero)', () => {
      const result = verifyPayParams({ ...validParams, projectId: 0n })
      expect(result.isValid).toBe(false)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
          field: 'projectId',
          message: 'Invalid project ID',
        })
      )
    })

    it('rejects invalid project ID (negative)', () => {
      const result = verifyPayParams({ ...validParams, projectId: -1n })
      expect(result.isValid).toBe(false)
    })

    it('rejects invalid token address', () => {
      const result = verifyPayParams({ ...validParams, token: INVALID_ADDRESS })
      expect(result.isValid).toBe(false)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
          field: 'token',
          message: 'Invalid token address format',
        })
      )
    })

    it('rejects invalid beneficiary address', () => {
      const result = verifyPayParams({ ...validParams, beneficiary: INVALID_ADDRESS })
      expect(result.isValid).toBe(false)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
          field: 'beneficiary',
        })
      )
    })

    it('rejects zero address beneficiary', () => {
      const result = verifyPayParams({ ...validParams, beneficiary: ZERO_ADDRESS })
      expect(result.isValid).toBe(false)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
          field: 'beneficiary',
          message: 'Beneficiary is zero address',
        })
      )
    })

    it('warns on zero amount', () => {
      const result = verifyPayParams({ ...validParams, amount: 0n })
      expect(result.isValid).toBe(true) // Warning, not critical
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          field: 'amount',
          message: 'Payment amount is zero',
        })
      )
    })

    it('warns on very small amount', () => {
      const result = verifyPayParams({ ...validParams, amount: 100n }) // Way less than MIN_REASONABLE_AMOUNT
      expect(result.isValid).toBe(true)
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings[0]).toMatch(/Very small payment amount/)
    })

    it('warns on large amount', () => {
      const largeAmount = BigInt('2000000000000000000000') // 2000 ETH
      const result = verifyPayParams({ ...validParams, amount: largeAmount })
      expect(result.isValid).toBe(true)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          field: 'amount',
          message: expect.stringContaining('Large payment amount'),
        })
      )
    })

    it('includes verified params in result', () => {
      const result = verifyPayParams(validParams)
      expect(result.verifiedParams).toEqual({
        projectId: '1',
        token: NATIVE_TOKEN,
        amount: '1000000000000000000',
        beneficiary: VALID_ADDRESS,
        minReturnedTokens: '0',
        memo: 'Test payment',
        metadata: '0x',
      })
    })
  })

  describe('verifyCashOutParams', () => {
    const validParams = {
      holder: VALID_ADDRESS,
      projectId: 1n,
      cashOutCount: 1000000000000000000000n, // 1000 tokens
      tokenToReclaim: NATIVE_TOKEN,
      minTokensReclaimed: 0n,
      beneficiary: VALID_ADDRESS,
    }

    it('accepts valid parameters', () => {
      const result = verifyCashOutParams(validParams)
      expect(result.isValid).toBe(true)
    })

    it('rejects invalid holder address', () => {
      const result = verifyCashOutParams({ ...validParams, holder: INVALID_ADDRESS })
      expect(result.isValid).toBe(false)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
          field: 'holder',
        })
      )
    })

    it('rejects zero address beneficiary', () => {
      const result = verifyCashOutParams({ ...validParams, beneficiary: ZERO_ADDRESS })
      expect(result.isValid).toBe(false)
    })

    it('warns on zero cash out amount', () => {
      const result = verifyCashOutParams({ ...validParams, cashOutCount: 0n })
      expect(result.isValid).toBe(true)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          field: 'cashOutCount',
        })
      )
    })

    it('warns on large token burn', () => {
      const largeAmount = BigInt('2000000000000000000000000000') // 2 billion tokens
      const result = verifyCashOutParams({ ...validParams, cashOutCount: largeAmount })
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          field: 'cashOutCount',
          message: expect.stringContaining('Large token burn'),
        })
      )
    })

    it('rejects invalid token to reclaim', () => {
      const result = verifyCashOutParams({ ...validParams, tokenToReclaim: INVALID_ADDRESS })
      expect(result.isValid).toBe(false)
    })
  })

  describe('verifySendPayoutsParams', () => {
    const validParams = {
      projectId: 1n,
      token: NATIVE_TOKEN,
      amount: 1000000000000000000n, // 1 ETH
      currency: 1n,
      minTokensPaidOut: 0n,
    }

    it('accepts valid parameters', () => {
      const result = verifySendPayoutsParams(validParams)
      expect(result.isValid).toBe(true)
    })

    it('rejects invalid project ID', () => {
      const result = verifySendPayoutsParams({ ...validParams, projectId: 0n })
      expect(result.isValid).toBe(false)
    })

    it('rejects invalid token address', () => {
      const result = verifySendPayoutsParams({ ...validParams, token: INVALID_ADDRESS })
      expect(result.isValid).toBe(false)
    })

    it('warns on zero amount', () => {
      const result = verifySendPayoutsParams({ ...validParams, amount: 0n })
      expect(result.isValid).toBe(true)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          field: 'amount',
          message: 'Payout amount is zero',
        })
      )
    })

    it('warns on large payout', () => {
      const largeAmount = BigInt('2000000000000000000000') // 2000 ETH
      const result = verifySendPayoutsParams({ ...validParams, amount: largeAmount })
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('Large payout amount'),
        })
      )
    })

    it('warns on unusual currency code', () => {
      const result = verifySendPayoutsParams({ ...validParams, currency: 99n })
      expect(result.warnings).toContainEqual(expect.stringContaining('Unusual currency code'))
    })

    it('accepts ETH currency (1)', () => {
      const result = verifySendPayoutsParams({ ...validParams, currency: 1 })
      expect(result.warnings).not.toContainEqual(expect.stringContaining('Unusual currency'))
    })

    it('accepts USD currency (2)', () => {
      const result = verifySendPayoutsParams({ ...validParams, currency: 2 })
      expect(result.warnings).not.toContainEqual(expect.stringContaining('Unusual currency'))
    })
  })

  describe('verifyUseAllowanceParams', () => {
    const validParams = {
      projectId: 1n,
      token: NATIVE_TOKEN,
      amount: 1000000000000000000n,
      currency: 1n,
      minTokensPaidOut: 0n,
      beneficiary: VALID_ADDRESS,
      feeBeneficiary: VALID_ADDRESS,
      memo: 'Withdrawal',
    }

    it('accepts valid parameters', () => {
      const result = verifyUseAllowanceParams(validParams)
      expect(result.isValid).toBe(true)
    })

    it('rejects zero address beneficiary', () => {
      const result = verifyUseAllowanceParams({ ...validParams, beneficiary: ZERO_ADDRESS })
      expect(result.isValid).toBe(false)
    })

    it('rejects invalid fee beneficiary', () => {
      const result = verifyUseAllowanceParams({ ...validParams, feeBeneficiary: INVALID_ADDRESS })
      expect(result.isValid).toBe(false)
    })

    it('warns on large withdrawal', () => {
      const largeAmount = BigInt('2000000000000000000000')
      const result = verifyUseAllowanceParams({ ...validParams, amount: largeAmount })
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('Large withdrawal'),
        })
      )
    })
  })

  describe('verifyDeployERC20Params', () => {
    const validParams = {
      projectId: 1n,
      name: 'Test Token',
      symbol: 'TEST',
    }

    it('accepts valid parameters', () => {
      const result = verifyDeployERC20Params(validParams)
      expect(result.isValid).toBe(true)
    })

    it('rejects empty name', () => {
      const result = verifyDeployERC20Params({ ...validParams, name: '' })
      expect(result.isValid).toBe(false)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
          field: 'name',
          message: 'Token name is required',
        })
      )
    })

    it('rejects whitespace-only name', () => {
      const result = verifyDeployERC20Params({ ...validParams, name: '   ' })
      expect(result.isValid).toBe(false)
    })

    it('rejects empty symbol', () => {
      const result = verifyDeployERC20Params({ ...validParams, symbol: '' })
      expect(result.isValid).toBe(false)
    })

    it('warns on long name', () => {
      const longName = 'A'.repeat(60)
      const result = verifyDeployERC20Params({ ...validParams, name: longName })
      expect(result.warnings).toContainEqual('Token name is unusually long')
    })

    it('warns on long symbol', () => {
      const longSymbol = 'A'.repeat(15)
      const result = verifyDeployERC20Params({ ...validParams, symbol: longSymbol })
      expect(result.warnings).toContainEqual('Token symbol is unusually long')
    })

    it('includes salt placeholder in verified params', () => {
      const result = verifyDeployERC20Params(validParams)
      expect(result.verifiedParams.salt).toBe('(generated at execution)')
    })

    it('uses provided salt', () => {
      const result = verifyDeployERC20Params({ ...validParams, salt: '0x123' })
      expect(result.verifiedParams.salt).toBe('0x123')
    })
  })

  describe('verifyQueueRulesetParams', () => {
    const validParams = {
      projectId: 1n,
      rulesetConfigurations: [
        {
          mustStartAtOrAfter: Math.floor(Date.now() / 1000) + 86400, // Tomorrow
          duration: 604800, // 7 days
          weight: 1000000000000000000000000n,
          metadata: {
            reservedPercent: 1000, // 10%
            cashOutTaxRate: 500, // 5%
            baseCurrency: 1,
          },
        },
      ],
      memo: 'Queue new ruleset',
    }

    it('accepts valid parameters', () => {
      const result = verifyQueueRulesetParams(validParams)
      expect(result.isValid).toBe(true)
    })

    it('rejects invalid project ID', () => {
      const result = verifyQueueRulesetParams({ ...validParams, projectId: 0n })
      expect(result.isValid).toBe(false)
    })

    it('rejects empty ruleset configurations', () => {
      const result = verifyQueueRulesetParams({ ...validParams, rulesetConfigurations: [] })
      expect(result.isValid).toBe(false)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
          message: 'At least one ruleset configuration is required',
        })
      )
    })

    it('warns on high reserved percent (>50%)', () => {
      const highReservedParams = {
        ...validParams,
        rulesetConfigurations: [
          {
            ...validParams.rulesetConfigurations[0],
            metadata: { reservedPercent: 6000 }, // 60%
          },
        ],
      }
      const result = verifyQueueRulesetParams(highReservedParams)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('High reserved percentage'),
        })
      )
    })

    it('warns when cash outs are disabled (100% tax)', () => {
      const disabledCashOutParams = {
        ...validParams,
        rulesetConfigurations: [
          {
            ...validParams.rulesetConfigurations[0],
            metadata: { cashOutTaxRate: 10000 }, // 100%
          },
        ],
      }
      const result = verifyQueueRulesetParams(disabledCashOutParams)
      expect(result.warnings).toContainEqual(expect.stringContaining('Cash outs are disabled'))
    })

    it('warns when start time is in the past', () => {
      const pastStartParams = {
        ...validParams,
        rulesetConfigurations: [
          {
            ...validParams.rulesetConfigurations[0],
            mustStartAtOrAfter: Math.floor(Date.now() / 1000) - 86400, // Yesterday
          },
        ],
      }
      const result = verifyQueueRulesetParams(pastStartParams)
      expect(result.warnings).toContainEqual(expect.stringContaining('Start time is in the past'))
    })

    it('rejects weight overflow (>uint112)', () => {
      const overflowParams = {
        ...validParams,
        rulesetConfigurations: [
          {
            ...validParams.rulesetConfigurations[0],
            weight: BigInt(2) ** BigInt(120), // Exceeds uint112
          },
        ],
      }
      const result = verifyQueueRulesetParams(overflowParams)
      expect(result.isValid).toBe(false)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
          message: 'Weight exceeds maximum value',
        })
      )
    })
  })

  describe('verifyLaunchProjectParams', () => {
    const validParams = {
      owner: VALID_ADDRESS,
      projectUri: 'ipfs://QmXyz123',
      chainIds: [1, 10, 8453],
      rulesetConfigurations: [{ /* ruleset */ }],
      terminalConfigurations: [{ /* terminal */ }],
      memo: 'Launch project',
    }

    it('accepts valid parameters', () => {
      const result = verifyLaunchProjectParams(validParams)
      expect(result.isValid).toBe(true)
    })

    it('rejects invalid owner address', () => {
      const result = verifyLaunchProjectParams({ ...validParams, owner: INVALID_ADDRESS })
      expect(result.isValid).toBe(false)
    })

    it('rejects zero address owner', () => {
      const result = verifyLaunchProjectParams({ ...validParams, owner: ZERO_ADDRESS })
      expect(result.isValid).toBe(false)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
          message: 'Owner is zero address',
        })
      )
    })

    it('warns on missing project URI', () => {
      const result = verifyLaunchProjectParams({ ...validParams, projectUri: '' })
      expect(result.warnings).toContainEqual('No project metadata URI provided')
    })

    it('warns on non-IPFS project URI', () => {
      const result = verifyLaunchProjectParams({ ...validParams, projectUri: 'https://example.com' })
      expect(result.warnings).toContainEqual('Project URI is not an IPFS link')
    })

    it('warns on unsupported chain ID', () => {
      const result = verifyLaunchProjectParams({ ...validParams, chainIds: [1, 999] })
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: 'Unsupported chain ID: 999',
        })
      )
    })

    it('warns on duplicate chain IDs', () => {
      const result = verifyLaunchProjectParams({ ...validParams, chainIds: [1, 10, 1] })
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: 'Duplicate chain IDs detected',
        })
      )
    })

    it('rejects empty ruleset configurations', () => {
      const result = verifyLaunchProjectParams({ ...validParams, rulesetConfigurations: [] })
      expect(result.isValid).toBe(false)
    })

    it('rejects empty terminal configurations', () => {
      const result = verifyLaunchProjectParams({ ...validParams, terminalConfigurations: [] })
      expect(result.isValid).toBe(false)
    })
  })

  describe('verifyDeployRevnetParams', () => {
    const validParams = {
      name: 'Test Revnet',
      tagline: 'A test revenue network',
      splitOperator: VALID_ADDRESS,
      chainIds: [1, 10, 8453],
      stageConfigurations: [
        {
          startsAtOrAfter: Math.floor(Date.now() / 1000) + 300,
          splitPercent: 200000000, // 20%
          initialIssuance: 1000000000000000000000000n,
          issuanceDecayFrequency: 604800,
          issuanceDecayPercent: 50000000, // 5%
          cashOutTaxRate: 1000,
        },
      ],
    }

    it('accepts valid parameters', () => {
      const result = verifyDeployRevnetParams(validParams)
      expect(result.isValid).toBe(true)
    })

    it('rejects empty name', () => {
      const result = verifyDeployRevnetParams({ ...validParams, name: '' })
      expect(result.isValid).toBe(false)
    })

    it('rejects invalid split operator', () => {
      const result = verifyDeployRevnetParams({ ...validParams, splitOperator: INVALID_ADDRESS })
      expect(result.isValid).toBe(false)
    })

    it('rejects zero address split operator', () => {
      const result = verifyDeployRevnetParams({ ...validParams, splitOperator: ZERO_ADDRESS })
      expect(result.isValid).toBe(false)
    })

    it('warns on unsupported chain ID', () => {
      const result = verifyDeployRevnetParams({ ...validParams, chainIds: [1, 999] })
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: 'Unsupported chain ID: 999',
        })
      )
    })

    it('rejects empty stage configurations', () => {
      const result = verifyDeployRevnetParams({ ...validParams, stageConfigurations: [] })
      expect(result.isValid).toBe(false)
    })

    it('warns on high operator split (>50%)', () => {
      const highSplitParams = {
        ...validParams,
        stageConfigurations: [
          {
            ...validParams.stageConfigurations[0],
            splitPercent: 600000000, // 60%
          },
        ],
      }
      const result = verifyDeployRevnetParams(highSplitParams)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('High operator split'),
        })
      )
    })

    it('warns on high issuance decay (>50%)', () => {
      const highDecayParams = {
        ...validParams,
        stageConfigurations: [
          {
            ...validParams.stageConfigurations[0],
            issuanceDecayPercent: 600000000, // 60%
          },
        ],
      }
      const result = verifyDeployRevnetParams(highDecayParams)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('High issuance decay'),
        })
      )
    })

    it('warns when cash outs are disabled', () => {
      const disabledCashOutParams = {
        ...validParams,
        stageConfigurations: [
          {
            ...validParams.stageConfigurations[0],
            cashOutTaxRate: 10000, // 100%
          },
        ],
      }
      const result = verifyDeployRevnetParams(disabledCashOutParams)
      expect(result.warnings).toContainEqual(expect.stringContaining('Cash outs are disabled'))
    })
  })

  describe('verifySendReservedTokensParams', () => {
    const validParams = {
      projectId: 1n,
      pendingReservedTokens: 1000000000000000000000n, // 1000 tokens
      reservedRate: 10, // 10%
      splits: [
        {
          beneficiary: VALID_ADDRESS,
          percent: 100,
        },
      ],
    }

    it('accepts valid parameters', () => {
      const result = verifySendReservedTokensParams(validParams)
      expect(result.isValid).toBe(true)
      expect(result.doubts.filter(d => d.severity === 'critical')).toHaveLength(0)
    })

    it('accepts string and number project IDs', () => {
      const resultString = verifySendReservedTokensParams({ ...validParams, projectId: '123' })
      const resultNumber = verifySendReservedTokensParams({ ...validParams, projectId: 123 })
      expect(resultString.isValid).toBe(true)
      expect(resultNumber.isValid).toBe(true)
    })

    it('rejects invalid project ID (zero)', () => {
      const result = verifySendReservedTokensParams({ ...validParams, projectId: 0n })
      expect(result.isValid).toBe(false)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
          field: 'projectId',
          message: 'Invalid project ID',
        })
      )
    })

    it('warns when no reserved tokens to distribute', () => {
      const result = verifySendReservedTokensParams({ ...validParams, pendingReservedTokens: 0n })
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          field: 'pendingReservedTokens',
          message: 'No reserved tokens to distribute',
        })
      )
    })

    it('warns on large distribution', () => {
      const largeAmount = 2000000000000000000000000000n // 2 billion tokens
      const result = verifySendReservedTokensParams({ ...validParams, pendingReservedTokens: largeAmount })
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          field: 'pendingReservedTokens',
          message: expect.stringContaining('Large distribution'),
        })
      )
    })

    it('rejects invalid beneficiary in splits', () => {
      const result = verifySendReservedTokensParams({
        ...validParams,
        splits: [{ beneficiary: INVALID_ADDRESS, percent: 100 }],
      })
      expect(result.isValid).toBe(false)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
          message: 'Invalid beneficiary address in split 1',
        })
      )
    })

    it('rejects zero beneficiary without project ID', () => {
      const result = verifySendReservedTokensParams({
        ...validParams,
        splits: [{ beneficiary: ZERO_ADDRESS, percent: 100 }],
      })
      expect(result.isValid).toBe(false)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
          message: 'Split 1 has zero beneficiary without project ID',
        })
      )
    })

    it('allows zero beneficiary with project ID', () => {
      const result = verifySendReservedTokensParams({
        ...validParams,
        splits: [{ beneficiary: ZERO_ADDRESS, percent: 100, projectId: 123 }],
      })
      expect(result.isValid).toBe(true)
    })

    it('warns on zero reserved rate', () => {
      const result = verifySendReservedTokensParams({ ...validParams, reservedRate: 0 })
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          field: 'reservedRate',
          message: 'Reserved rate is 0%',
        })
      )
    })

    it('warns about locked splits', () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 86400 // 24 hours from now
      const result = verifySendReservedTokensParams({
        ...validParams,
        splits: [{ beneficiary: VALID_ADDRESS, percent: 100, lockedUntil: futureTimestamp }],
      })
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings[0]).toContain('locked until')
    })

    it('accepts params without optional fields', () => {
      const minimalParams = { projectId: 1n }
      const result = verifySendReservedTokensParams(minimalParams)
      expect(result.isValid).toBe(true)
    })
  })

  describe('createVerificationResult', () => {
    it('creates valid result with defaults', () => {
      const result = createVerificationResult(true)
      expect(result).toEqual({
        isValid: true,
        doubts: [],
        warnings: [],
        verifiedParams: {},
      })
    })

    it('creates result with all params', () => {
      const doubts: TransactionDoubt[] = [{ severity: 'warning', message: 'test' }]
      const warnings = ['warning1']
      const verifiedParams = { key: 'value' }

      const result = createVerificationResult(false, doubts, warnings, verifiedParams)
      expect(result).toEqual({
        isValid: false,
        doubts,
        warnings,
        verifiedParams,
      })
    })
  })

  describe('edge cases', () => {
    it('handles max uint256 amount detection', () => {
      const maxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
      const result = verifyPayParams({
        projectId: 1n,
        token: NATIVE_TOKEN,
        amount: maxUint256 + 1n, // Overflow
        beneficiary: VALID_ADDRESS,
        minReturnedTokens: 0n,
        memo: '',
      })
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
          message: 'Amount exceeds maximum value',
        })
      )
    })

    it('handles checksummed and lowercase addresses', () => {
      const checksummed = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
      const lowercase = checksummed.toLowerCase()

      const resultChecksummed = verifyPayParams({
        projectId: 1n,
        token: NATIVE_TOKEN,
        amount: 1000000000000000000n,
        beneficiary: checksummed,
        minReturnedTokens: 0n,
        memo: '',
      })

      const resultLowercase = verifyPayParams({
        projectId: 1n,
        token: NATIVE_TOKEN,
        amount: 1000000000000000000n,
        beneficiary: lowercase,
        minReturnedTokens: 0n,
        memo: '',
      })

      // Both should be valid
      expect(resultChecksummed.isValid).toBe(true)
      expect(resultLowercase.isValid).toBe(true)
    })

    it('handles string amounts', () => {
      const result = verifyPayParams({
        projectId: '1',
        token: NATIVE_TOKEN,
        amount: '1000000000000000000',
        beneficiary: VALID_ADDRESS,
        minReturnedTokens: '0',
        memo: '',
      })
      expect(result.isValid).toBe(true)
      expect(result.verifiedParams.amount).toBe('1000000000000000000')
    })
  })

  describe('autoCorrectAddress', () => {
    it('does not modify valid addresses', () => {
      const result = autoCorrectAddress('0x1234567890123456789012345678901234567890')
      expect(result.wasCorrected).toBe(false)
      expect(result.address).toBe('0x1234567890123456789012345678901234567890')
    })

    it('does not modify known canonical addresses', () => {
      const result = autoCorrectAddress('0x52869db3d61dde1e391967f2ce5039ad0ecd371c')
      expect(result.wasCorrected).toBe(false)
    })

    it('corrects hallucinated JBSwapTerminalUSDCRegistry address (missing "05")', () => {
      // AI dropped '05' from 'de05810' making it 'de1810'
      const hallucinated = '0x1ce40d201cdec791de1810d17aaf501be167422'
      const correct = '0x1ce40d201cdec791de05810d17aaf501be167422'

      const result = autoCorrectAddress(hallucinated)
      expect(result.wasCorrected).toBe(true)
      expect(result.address).toBe(correct)
      expect(result.originalAddress).toBe(hallucinated)
      expect(result.matchedContract).toBe('JBSwapTerminalUSDCRegistry')
    })

    it('corrects hallucinated JBMultiTerminal5_1 address (missing characters)', () => {
      // AI dropped 'd' from 'ad0ecd' making it 'a0ecd'
      const hallucinated = '0x52869db3d61dde1e391967f2ce5039a0ecd371c'
      const correct = '0x52869db3d61dde1e391967f2ce5039ad0ecd371c'

      const result = autoCorrectAddress(hallucinated)
      expect(result.wasCorrected).toBe(true)
      expect(result.address).toBe(correct)
      expect(result.matchedContract).toBe('JBMultiTerminal5_1')
    })

    it('does not correct addresses with too many differences', () => {
      // This is a completely different address
      const different = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      const result = autoCorrectAddress(different)
      expect(result.wasCorrected).toBe(false)
    })

    it('handles empty and null addresses', () => {
      expect(autoCorrectAddress('').wasCorrected).toBe(false)
      expect(autoCorrectAddress(null as unknown as string).wasCorrected).toBe(false)
    })
  })

  describe('autoCorrectTerminalConfigurations', () => {
    it('corrects hallucinated terminal addresses', () => {
      const configs = [
        {
          terminal: '0x52869db3d61dde1e391967f2ce5039a0ecd371c', // Missing 'd'
          accountingContextsToAccept: [
            { token: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' }
          ]
        }
      ]

      const corrections = autoCorrectTerminalConfigurations(configs)

      expect(corrections.length).toBe(1)
      expect(corrections[0].field).toBe('terminalConfigurations[0].terminal')
      expect(corrections[0].corrected).toBe('0x52869db3d61dde1e391967f2ce5039ad0ecd371c')
      // Mutated in place
      expect(configs[0].terminal).toBe('0x52869db3d61dde1e391967f2ce5039ad0ecd371c')
    })

    it('handles configs with no corrections needed', () => {
      const configs = [
        {
          terminal: '0x52869db3d61dde1e391967f2ce5039ad0ecd371c',
          accountingContextsToAccept: []
        }
      ]

      const corrections = autoCorrectTerminalConfigurations(configs)
      expect(corrections.length).toBe(0)
    })
  })

  describe('autoCorrectChainConfigs', () => {
    it('corrects addresses in chain config overrides', () => {
      const chainConfigs = [
        {
          chainId: 11155111,
          overrides: {
            terminalConfigurations: [
              {
                terminal: '0x1ce40d201cdec791de1810d17aaf501be167422', // Missing '05'
                accountingContextsToAccept: []
              }
            ]
          }
        }
      ]

      const corrections = autoCorrectChainConfigs(chainConfigs)

      expect(corrections.length).toBe(1)
      expect(corrections[0].corrected).toBe('0x1ce40d201cdec791de05810d17aaf501be167422')
      // Mutated in place
      expect(chainConfigs[0].overrides?.terminalConfigurations?.[0].terminal)
        .toBe('0x1ce40d201cdec791de05810d17aaf501be167422')
    })
  })
})
