import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  verifyCashOutParams,
  verifySendPayoutsParams,
  verifySendReservedTokensParams,
  verifyUseAllowanceParams,
  verifyDeployERC20Params,
  verifyQueueRulesetParams,
  verifyLaunchProjectParams,
  verifyDeployRevnetParams,
  createVerificationResult,
  type TransactionDoubt,
} from './transactionVerification'
import { ALL_CHAIN_IDS, JB_CONTRACTS, NATIVE_TOKEN } from '../constants'

describe('transactionVerification', () => {
  const VALID_ADDRESS = '0x1234567890123456789012345678901234567890'
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
  const INVALID_ADDRESS = '0xinvalid'
  const NATIVE_CURRENCY = BigInt(NATIVE_TOKEN) & 0xffff_ffffn

  describe('verifyCashOutParams', () => {
    const validParams = {
      holder: VALID_ADDRESS,
      projectId: 1n,
      cashOutCount: 1000000000000000000000n, // 1000 tokens
      tokenToReclaim: NATIVE_TOKEN,
      minTokensReclaimed: 1n,
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

    it('rejects a zero cash out amount', () => {
      const result = verifyCashOutParams({ ...validParams, cashOutCount: 0n })
      expect(result.isValid).toBe(false)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
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

    it('accepts a recognized buyback route with its minimum in hook metadata', () => {
      const result = verifyCashOutParams({
        ...validParams,
        minTokensReclaimed: 0n,
        metadata: '0x1234',
        buybackRoute: true,
      })
      expect(result.isValid).toBe(true)
    })

    it('rejects buyback-shaped calldata unless the live preview selected that route', () => {
      const result = verifyCashOutParams({
        ...validParams,
        minTokensReclaimed: 0n,
        metadata: '0x1234',
      })
      expect(result.isValid).toBe(false)
      expect(result.doubts.map(doubt => doubt.field)).toEqual(
        expect.arrayContaining(['minTokensReclaimed', 'metadata']),
      )
    })
  })

  describe('verifySendPayoutsParams', () => {
    const validParams = {
      projectId: 1n,
      token: NATIVE_TOKEN,
      amount: 1000000000000000000n, // 1 ETH
      currency: NATIVE_CURRENCY,
      accountingCurrency: NATIVE_CURRENCY,
      minTokensPaidOut: 1000000000000000000n,
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

    it('rejects a zero amount', () => {
      const result = verifySendPayoutsParams({ ...validParams, amount: 0n, minTokensPaidOut: 0n })
      expect(result.isValid).toBe(false)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
          field: 'amount',
          message: 'Payout amount is zero',
        })
      )
    })

    it('keeps large payout amounts as exact bigint values', () => {
      const largeAmount = BigInt('2000000000000000000000') // 2000 ETH
      const result = verifySendPayoutsParams({ ...validParams, amount: largeAmount, minTokensPaidOut: largeAmount })
      expect(result.isValid).toBe(true)
      expect(result.verifiedParams.amount).toBe(largeAmount.toString())
    })

    it('accepts an exact configured currency ID distinct from the accounting currency', () => {
      const result = verifySendPayoutsParams({
        ...validParams,
        currency: 2n,
        accountingCurrency: NATIVE_CURRENCY,
        minTokensPaidOut: 1n,
      })
      expect(result.isValid).toBe(true)
      expect(result.verifiedParams.currency).toBe('2')
      expect(result.verifiedParams.accountingCurrency).toBe(NATIVE_CURRENCY.toString())
    })

    it('accepts the native token-keyed currency', () => {
      const result = verifySendPayoutsParams({ ...validParams, currency: NATIVE_CURRENCY })
      expect(result.isValid).toBe(true)
    })

    it('does not conflate ETH ID 1, USD ID 2, and the native accounting currency', () => {
      expect(verifySendPayoutsParams({
        ...validParams,
        currency: 1n,
        accountingCurrency: NATIVE_CURRENCY,
        minTokensPaidOut: 1n,
      }).isValid).toBe(true)
      expect(verifySendPayoutsParams({
        ...validParams,
        currency: 2n,
        accountingCurrency: NATIVE_CURRENCY,
        minTokensPaidOut: 1n,
      }).isValid).toBe(true)
      expect(verifySendPayoutsParams({
        ...validParams,
        currency: 1n,
        accountingCurrency: 1n,
        minTokensPaidOut: 1n,
      }).isValid).toBe(false)
    })

    it('rejects a zero simulated minimum', () => {
      const result = verifySendPayoutsParams({ ...validParams, minTokensPaidOut: 0n })
      expect(result.isValid).toBe(false)
      expect(result.doubts).toContainEqual(expect.objectContaining({ field: 'minTokensPaidOut', severity: 'critical' }))
    })
  })

  describe('verifyUseAllowanceParams', () => {
    const validParams = {
      projectId: 1n,
      token: NATIVE_TOKEN,
      amount: 1000000000000000000n,
      currency: NATIVE_CURRENCY,
      accountingCurrency: NATIVE_CURRENCY,
      minTokensPaidOut: 975000000000000000n,
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

    it('keeps large withdrawal amounts as exact bigint values', () => {
      const largeAmount = BigInt('2000000000000000000000')
      const result = verifyUseAllowanceParams({
        ...validParams,
        amount: largeAmount,
        minTokensPaidOut: largeAmount - (largeAmount / 40n),
      })
      expect(result.isValid).toBe(true)
      expect(result.verifiedParams.amount).toBe(largeAmount.toString())
    })

    it('accepts a cross-currency live minimum and rejects zero', () => {
      expect(verifyUseAllowanceParams({
        ...validParams,
        currency: 2n,
        accountingCurrency: NATIVE_CURRENCY,
        minTokensPaidOut: 1n,
      }).isValid).toBe(true)
      expect(verifyUseAllowanceParams({ ...validParams, minTokensPaidOut: 0n }).isValid).toBe(false)
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

    it('warns when cash outs use the disabled sentinel', () => {
      const disabledCashOutParams = {
        ...validParams,
        rulesetConfigurations: [
          {
            ...validParams.rulesetConfigurations[0],
            metadata: { cashOutTaxRate: 10000 }, // Disabled sentinel
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
      projectUri: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3gq2t5lz2wqzzx4m6w6v7s7qm',
      chainIds: ALL_CHAIN_IDS.slice(0, 3),
      rulesetConfigurations: [{ /* ruleset */ }],
      terminalConfigurations: [{
        terminal: JB_CONTRACTS.JBMultiTerminal,
        accountingContextsToAccept: [{
          token: NATIVE_TOKEN,
          decimals: 18,
          currency: Number(NATIVE_CURRENCY),
        }],
      }],
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

    it('rejects a missing project URI', () => {
      const result = verifyLaunchProjectParams({ ...validParams, projectUri: '' })
      expect(result.doubts).toContainEqual(expect.objectContaining({ field: 'projectUri', severity: 'critical' }))
    })

    it('rejects a non-IPFS project URI', () => {
      const result = verifyLaunchProjectParams({ ...validParams, projectUri: 'https://example.com' })
      expect(result.doubts).toContainEqual(expect.objectContaining({ field: 'projectUri', severity: 'critical' }))
    })

    it('rejects an unsupported chain ID', () => {
      const result = verifyLaunchProjectParams({ ...validParams, chainIds: [ALL_CHAIN_IDS[0], 999] })
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
          message: 'Unsupported chain ID: 999',
        })
      )
    })

    it('rejects duplicate chain IDs', () => {
      const result = verifyLaunchProjectParams({ ...validParams, chainIds: [ALL_CHAIN_IDS[0], ALL_CHAIN_IDS[0]] })
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
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

    it('does not correct a near-miss terminal address', () => {
      const nearMiss = '0x130f5dd2bd8805443cf41755253d78a75a67f53'
      const terminalConfigurations = [{
        terminal: nearMiss,
        accountingContextsToAccept: [{ token: NATIVE_TOKEN, decimals: 18, currency: Number(NATIVE_CURRENCY) }],
      }]
      const result = verifyLaunchProjectParams({ ...validParams, terminalConfigurations })
      expect(result.isValid).toBe(false)
      expect(terminalConfigurations[0].terminal).toBe(nearMiss)
      expect(result.doubts).toContainEqual(expect.objectContaining({
        field: 'terminalConfigurations[0].terminal',
        severity: 'critical',
      }))
    })
  })

  describe('verifyDeployRevnetParams', () => {
    const validParams = {
      name: 'Test Revnet',
      ticker: 'TEST',
      tagline: 'A test revenue network',
      projectUri: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3gq2t5lz2wqzzx4m6w6v7s7qm',
      splitOperator: VALID_ADDRESS,
      chainIds: ALL_CHAIN_IDS.slice(0, 3),
      stageConfigurations: [
        {
          startsAtOrAfter: Math.floor(Date.now() / 1000) + 300,
          splitPercent: 2000, // 20%
          initialIssuance: 1000000000000000000000000n,
          issuanceCutFrequency: 604800,
          issuanceCutPercent: 50000000, // 5%
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

    it('rejects an unsupported chain ID', () => {
      const result = verifyDeployRevnetParams({ ...validParams, chainIds: [ALL_CHAIN_IDS[0], 999] })
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'critical',
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
            splitPercent: 6000, // 60%
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

    it('warns on high issuance cut (>50%)', () => {
      const highCutParams = {
        ...validParams,
        stageConfigurations: [
          {
            ...validParams.stageConfigurations[0],
            issuanceCutPercent: 600000000, // 60%
          },
        ],
      }
      const result = verifyDeployRevnetParams(highCutParams)
      expect(result.doubts).toContainEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('High issuance cut'),
        })
      )
    })

    it('rejects a 100% cash-out tax', () => {
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
      expect(result.isValid).toBe(false)
      expect(result.doubts).toContainEqual(expect.objectContaining({
        severity: 'critical',
        field: 'stageConfigurations[0].cashOutTaxRate',
      }))
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

  // ===========================================================================
  // Property-Based Tests (fast-check)
  // ===========================================================================

  describe('property-based tests', () => {
    // Arbitrary for positive bigints (valid project IDs)
    const positiveBigIntArb = fc.bigInt({ min: 1n, max: BigInt(Number.MAX_SAFE_INTEGER) })

    describe('token deployment validation', () => {
      it('accepts any non-empty name and symbol', () => {
        fc.assert(
          fc.property(
            positiveBigIntArb,
            fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
            fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0),
            (projectId, name, symbol) => {
              const result = verifyDeployERC20Params({
                projectId,
                name,
                symbol,
              })
              return result.isValid
            }
          ),
          { numRuns: 50 }
        )
      })

      it('rejects empty or whitespace-only names', () => {
        fc.assert(
          fc.property(
            positiveBigIntArb,
            fc.constantFrom('', '   ', '\t', '\n'),
            (projectId, name) => {
              const result = verifyDeployERC20Params({
                projectId,
                name,
                symbol: 'TEST',
              })
              return !result.isValid &&
                result.doubts.some(d => d.field === 'name' && d.severity === 'critical')
            }
          ),
          { numRuns: 20 }
        )
      })
    })

    describe('ruleset configuration validation', () => {
      it('validates weight boundaries (uint112)', () => {
        fc.assert(
          fc.property(
            positiveBigIntArb,
            fc.bigInt({ min: BigInt(2) ** BigInt(112), max: BigInt(2) ** BigInt(120) }),
            (projectId, weight) => {
              const result = verifyQueueRulesetParams({
                projectId,
                rulesetConfigurations: [{ weight }],
                memo: '',
              })
              return result.doubts.some(d =>
                d.severity === 'critical' &&
                d.message === 'Weight exceeds maximum value'
              )
            }
          ),
          { numRuns: 20 }
        )
      })

      it('accepts weights within uint112 range', () => {
        fc.assert(
          fc.property(
            positiveBigIntArb,
            fc.bigInt({ min: 1n, max: BigInt(2) ** BigInt(112) - 1n }),
            (projectId, weight) => {
              const result = verifyQueueRulesetParams({
                projectId,
                rulesetConfigurations: [{ weight }],
                memo: '',
              })
              return !result.doubts.some(d =>
                d.message === 'Weight exceeds maximum value'
              )
            }
          ),
          { numRuns: 50 }
        )
      })
    })
  })
})
