// Transaction verification utilities
// Validates transaction parameters against contract ABIs before display

import {
  NATIVE_TOKEN,
} from '../constants/abis'
import { ALL_CHAIN_IDS, JB_ROUTER_TERMINAL_REGISTRY } from '../constants'
import { recognizedTerminalType } from './paymentTerminal'
import {
  requireRecognizedApprovalHook,
  requireRecognizedNewProjectDataHook,
} from './projectTrust'
import { isUsdcAddress } from './technicalDetails'
import { isIpfsUri } from './ipfs'

// Types
export interface TransactionDoubt {
  severity: 'warning' | 'critical'
  field?: string
  message: string
  technicalNote?: string
}

export interface VerificationResult {
  isValid: boolean
  doubts: TransactionDoubt[]
  warnings: string[]
  verifiedParams: Record<string, unknown>
}

// Constants
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const MAX_REASONABLE_ETH = BigInt('1000000000000000000000') // 1000 ETH
const MAX_REASONABLE_TOKENS = BigInt('1000000000000000000000000000') // 1 billion tokens
const MIN_REASONABLE_AMOUNT = BigInt('1000000000000') // 0.000001 ETH (1e12 wei)

// Validation helpers
function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

function isZeroAddress(address: string): boolean {
  return address.toLowerCase() === ZERO_ADDRESS.toLowerCase()
}

function isNativeToken(address: string): boolean {
  return address.toLowerCase() === NATIVE_TOKEN.toLowerCase()
}

function isRecognizedAccountingToken(address: string): boolean {
  return isNativeToken(address) || isUsdcAddress(address)
}

function accountingCurrencyOf(address: string): bigint {
  return BigInt(address) & 0xffff_ffffn
}

function validateLaunchTerminalConfigurations(
  terminalConfigs: Array<{
    terminal?: string
    accountingContextsToAccept?: Array<{ token?: string; decimals?: number; currency?: number }>
  }>,
  prefix: string,
  doubts: TransactionDoubt[],
): void {
  const seen = new Set<string>()
  terminalConfigs.forEach((config, terminalIndex) => {
    const field = `${prefix}[${terminalIndex}]`
    if (!config.terminal || !isValidAddress(config.terminal)) {
      doubts.push({ severity: 'critical', field: `${field}.terminal`, message: 'Invalid terminal address' })
      return
    }
    const normalized = config.terminal.toLowerCase()
    const terminalType = recognizedTerminalType(config.terminal as `0x${string}`)
    const isRegistry = normalized === JB_ROUTER_TERMINAL_REGISTRY.toLowerCase()
    if (!terminalType || (terminalType === 'router' && !isRegistry)) {
      doubts.push({
        severity: 'critical',
        field: `${field}.terminal`,
        message: terminalType === 'router'
          ? 'Configure the recognized router registry, not a router implementation'
          : `Terminal not recognized: ${config.terminal}`,
      })
      return
    }
    if (seen.has(normalized)) {
      doubts.push({ severity: 'critical', field: `${field}.terminal`, message: 'Duplicate terminal configuration' })
    }
    seen.add(normalized)

    const contexts = config.accountingContextsToAccept ?? []
    if (isRegistry) {
      if (contexts.length > 0) {
        doubts.push({
          severity: 'critical',
          field: `${field}.accountingContextsToAccept`,
          message: 'The router registry must not define accounting contexts',
        })
      }
      return
    }
    if (contexts.length === 0) {
      doubts.push({
        severity: 'critical',
        field: `${field}.accountingContextsToAccept`,
        message: 'JBMultiTerminal requires at least one accounting context',
      })
    }
    contexts.forEach((context, contextIndex) => {
      const contextField = `${field}.accountingContextsToAccept[${contextIndex}]`
      if (!context.token || !isValidAddress(context.token)) {
        doubts.push({ severity: 'critical', field: `${contextField}.token`, message: 'Invalid accounting token address' })
        return
      }
      if (!isNativeToken(context.token) && !isUsdcAddress(context.token)) {
        doubts.push({
          severity: 'critical',
          field: `${contextField}.token`,
          message: `Accounting token not recognized: ${context.token}`,
        })
        return
      }
      const expectedDecimals = isNativeToken(context.token) ? 18 : 6
      const expectedCurrency = Number(BigInt(context.token) & 0xffffffffn)
      if (context.decimals !== expectedDecimals) {
        doubts.push({
          severity: 'critical',
          field: `${contextField}.decimals`,
          message: `Expected ${expectedDecimals} decimals for this accounting token`,
        })
      }
      if (context.currency !== expectedCurrency) {
        doubts.push({
          severity: 'critical',
          field: `${contextField}.currency`,
          message: `Expected currency ${expectedCurrency} for ${context.token}`,
        })
      }
    })
  })
}

function isBigIntOverflow(value: bigint, maxBits: number = 256): boolean {
  const maxValue = BigInt(2) ** BigInt(maxBits) - BigInt(1)
  return value > maxValue
}

function parseBigIntParam(
  value: bigint | string | number,
  field: string,
  doubts: TransactionDoubt[],
): bigint {
  try {
    return BigInt(value)
  } catch {
    doubts.push({
      severity: 'critical',
      field,
      message: `${field} must be an integer`,
    })
    return 0n
  }
}

function validateUnsigned(
  value: bigint,
  field: string,
  doubts: TransactionDoubt[],
  maxBits: number = 256,
): void {
  if (value < 0n) {
    doubts.push({ severity: 'critical', field, message: `${field} cannot be negative` })
  } else if (isBigIntOverflow(value, maxBits)) {
    doubts.push({ severity: 'critical', field, message: `${field} exceeds uint${maxBits}` })
  }
}

interface ValidatableRulesetConfig {
  mustStartAtOrAfter?: number
  duration?: number
  weight?: bigint | string | number
  weightCutPercent?: number
  approvalHook?: string
  metadata?: {
    reservedPercent?: number
    cashOutTaxRate?: number
    baseCurrency?: number
    dataHook?: string
  }
  splitGroups?: Array<{
    groupId?: bigint | string | number
    splits?: Array<{
      percent?: number
      projectId?: bigint | string | number
      beneficiary?: string
      lockedUntil?: number
      hook?: string
    }>
  }>
  fundAccessLimitGroups?: Array<{
    terminal?: string
    token?: string
    payoutLimits?: Array<{ amount?: bigint | string | number; currency?: number }>
    surplusAllowances?: Array<{ amount?: bigint | string | number; currency?: number }>
  }>
}

function validateIntegerRange(
  value: number | undefined,
  field: string,
  min: number,
  max: number,
  doubts: TransactionDoubt[],
): void {
  if (value === undefined) return
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    doubts.push({
      severity: 'critical',
      field,
      message: `${field} must be an integer between ${min} and ${max}`,
    })
  }
}

function validateRulesetConfig(
  config: ValidatableRulesetConfig,
  index: number,
  doubts: TransactionDoubt[],
): void {
  const prefix = `rulesetConfigurations[${index}]`
  validateIntegerRange(config.mustStartAtOrAfter, `${prefix}.mustStartAtOrAfter`, 0, 2 ** 48 - 1, doubts)
  validateIntegerRange(config.duration, `${prefix}.duration`, 0, 2 ** 32 - 1, doubts)
  validateIntegerRange(config.weightCutPercent, `${prefix}.weightCutPercent`, 0, 1_000_000_000, doubts)
  validateIntegerRange(config.metadata?.reservedPercent, `${prefix}.metadata.reservedPercent`, 0, 10_000, doubts)
  validateIntegerRange(config.metadata?.cashOutTaxRate, `${prefix}.metadata.cashOutTaxRate`, 0, 10_000, doubts)
  validateIntegerRange(config.metadata?.baseCurrency, `${prefix}.metadata.baseCurrency`, 1, 2 ** 32 - 1, doubts)

  if (config.weight !== undefined) {
    const weight = parseBigIntParam(config.weight, `${prefix}.weight`, doubts)
    if (weight < 0n) {
      doubts.push({ severity: 'critical', field: `${prefix}.weight`, message: 'Weight cannot be negative' })
    } else if (isBigIntOverflow(weight, 112)) {
      doubts.push({
        severity: 'critical',
        field: `${prefix}.weight`,
        message: 'Weight exceeds maximum value',
        technicalNote: 'Weight must fit in uint112',
      })
    }
  }
  if (config.approvalHook && !isValidAddress(config.approvalHook)) {
    doubts.push({ severity: 'critical', field: `${prefix}.approvalHook`, message: 'Invalid approval hook address' })
  } else if (config.approvalHook) {
    try {
      requireRecognizedApprovalHook(config.approvalHook)
    } catch (err) {
      doubts.push({
        severity: 'critical',
        field: `${prefix}.approvalHook`,
        message: err instanceof Error ? err.message : 'Rule-change hook not recognized',
      })
    }
  }
  if (config.metadata?.dataHook && !isValidAddress(config.metadata.dataHook)) {
    doubts.push({ severity: 'critical', field: `${prefix}.metadata.dataHook`, message: 'Invalid data hook address' })
  }

  config.splitGroups?.forEach((group, groupIndex) => {
    if (group.groupId !== undefined) {
      const groupId = parseBigIntParam(group.groupId, `${prefix}.splitGroups[${groupIndex}].groupId`, doubts)
      validateUnsigned(groupId, `${prefix}.splitGroups[${groupIndex}].groupId`, doubts)
    }
    let totalPercent = 0
    group.splits?.forEach((split, splitIndex) => {
      const splitPrefix = `${prefix}.splitGroups[${groupIndex}].splits[${splitIndex}]`
      validateIntegerRange(split.percent, `${splitPrefix}.percent`, 0, 1_000_000_000, doubts)
      totalPercent += split.percent || 0
      if (split.projectId !== undefined) {
        const splitProjectId = parseBigIntParam(split.projectId, `${splitPrefix}.projectId`, doubts)
        validateUnsigned(splitProjectId, `${splitPrefix}.projectId`, doubts, 64)
      }
      if (split.beneficiary && !isValidAddress(split.beneficiary)) {
        doubts.push({ severity: 'critical', field: `${splitPrefix}.beneficiary`, message: 'Invalid split beneficiary address' })
      }
      if (split.hook && !isValidAddress(split.hook)) {
        doubts.push({ severity: 'critical', field: `${splitPrefix}.hook`, message: 'Invalid split hook address' })
      }
      // Clone provenance requires JBAddressRegistry reads. The transaction
      // preflight performs that live check and blocks every unrecognized hook;
      // this synchronous shape validator must not issue a premature warning.
      validateIntegerRange(split.lockedUntil, `${splitPrefix}.lockedUntil`, 0, 2 ** 48 - 1, doubts)
    })
    if (totalPercent > 1_000_000_000) {
      doubts.push({
        severity: 'critical',
        field: `${prefix}.splitGroups[${groupIndex}].splits`,
        message: 'Split percentages exceed 100%',
      })
    }
  })

  config.fundAccessLimitGroups?.forEach((group, groupIndex) => {
    const groupPrefix = `${prefix}.fundAccessLimitGroups[${groupIndex}]`
    if (!group.terminal || !isValidAddress(group.terminal)) {
      doubts.push({ severity: 'critical', field: `${groupPrefix}.terminal`, message: 'Invalid fund access terminal address' })
    } else if (recognizedTerminalType(group.terminal as `0x${string}`) !== 'multi') {
      doubts.push({
        severity: 'critical',
        field: `${groupPrefix}.terminal`,
        message: `Fund access terminal not recognized: ${group.terminal}`,
      })
    }
    if (!group.token || !isValidAddress(group.token)) {
      doubts.push({ severity: 'critical', field: `${groupPrefix}.token`, message: 'Invalid fund access token address' })
    }
    const validateLimits = (
      limits: Array<{ amount?: bigint | string | number; currency?: number }> | undefined,
      kind: string,
    ) => limits?.forEach((limit, limitIndex) => {
      const limitPrefix = `${groupPrefix}.${kind}[${limitIndex}]`
      if (limit.amount === undefined) {
        doubts.push({ severity: 'critical', field: `${limitPrefix}.amount`, message: 'Fund access amount is required' })
      } else {
        const amount = parseBigIntParam(limit.amount, `${limitPrefix}.amount`, doubts)
        validateUnsigned(amount, `${limitPrefix}.amount`, doubts, 224)
      }
      validateIntegerRange(limit.currency, `${limitPrefix}.currency`, 1, 2 ** 32 - 1, doubts)
    })
    validateLimits(group.payoutLimits, 'payoutLimits')
    validateLimits(group.surplusAllowances, 'surplusAllowances')
  })
}

function formatEthAmount(wei: bigint): string {
  const eth = Number(wei) / 1e18
  if (eth >= 1) return `${eth.toFixed(4)} ETH`
  if (eth >= 0.001) return `${eth.toFixed(6)} ETH`
  return `${eth.toExponential(4)} ETH`
}

function formatTokenAmount(amount: bigint, decimals: number = 18): string {
  const value = Number(amount) / Math.pow(10, decimals)
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`
  return value.toFixed(2)
}

// Pay transaction verification
export function verifyPayParams(params: {
  projectId: bigint | string | number
  token: string
  amount: bigint | string
  beneficiary: string
  minReturnedTokens: bigint | string
  memo: string
  metadata?: string
}): VerificationResult {
  const doubts: TransactionDoubt[] = []
  const warnings: string[] = []

  // Normalize values
  const projectId = parseBigIntParam(params.projectId, 'projectId', doubts)
  const amount = parseBigIntParam(params.amount, 'amount', doubts)
  const minReturnedTokens = parseBigIntParam(params.minReturnedTokens, 'minReturnedTokens', doubts)
  validateUnsigned(amount, 'amount', doubts)
  validateUnsigned(minReturnedTokens, 'minReturnedTokens', doubts)

  // Validate project ID
  if (projectId <= 0n) {
    doubts.push({
      severity: 'critical',
      field: 'projectId',
      message: 'Invalid project ID',
      technicalNote: 'Project ID must be a positive integer',
    })
  }

  // Validate token address
  if (!isValidAddress(params.token)) {
    doubts.push({
      severity: 'critical',
      field: 'token',
      message: 'Invalid token address format',
      technicalNote: `Token address "${params.token}" is not a valid Ethereum address`,
    })
  } else if (!isRecognizedAccountingToken(params.token)) {
    doubts.push({
      severity: 'critical',
      field: 'token',
      message: `Payment token not recognized: ${params.token}`,
    })
  }

  // Validate beneficiary address
  if (!isValidAddress(params.beneficiary)) {
    doubts.push({
      severity: 'critical',
      field: 'beneficiary',
      message: 'Invalid beneficiary address format',
      technicalNote: `Beneficiary address is not a valid Ethereum address`,
    })
  } else if (isZeroAddress(params.beneficiary)) {
    doubts.push({
      severity: 'critical',
      field: 'beneficiary',
      message: 'Beneficiary is zero address',
      technicalNote: 'Tokens would be sent to the burn address (0x0)',
    })
  }

  // Validate amount
  if (amount === 0n) {
    doubts.push({
      severity: 'critical',
      field: 'amount',
      message: 'Payment amount is zero',
      technicalNote: 'Zero payments may fail or have no effect',
    })
  } else if (amount < MIN_REASONABLE_AMOUNT) {
    warnings.push(`Very small payment amount: ${formatEthAmount(amount)}`)
  } else if (amount > MAX_REASONABLE_ETH) {
    doubts.push({
      severity: 'warning',
      field: 'amount',
      message: `Large payment amount: ${formatEthAmount(amount)}`,
      technicalNote: 'Please double-check this amount is correct',
    })
  }

  // Check for uint256 overflow
  if (isBigIntOverflow(amount)) {
    doubts.push({
      severity: 'critical',
      field: 'amount',
      message: 'Amount exceeds maximum value',
      technicalNote: 'Value exceeds uint256 maximum',
    })
  }

  if (amount > 0n && minReturnedTokens === 0n) {
    doubts.push({
      severity: 'critical',
      field: 'minReturnedTokens',
      message: 'Payment minimum token return must be greater than zero',
      technicalNote: 'A zero minimum provides no protection against an adverse quote change',
    })
  }

  const verifiedParams: Record<string, unknown> = {
    projectId: projectId.toString(),
    token: params.token,
    amount: amount.toString(),
    beneficiary: params.beneficiary,
    minReturnedTokens: minReturnedTokens.toString(),
    memo: params.memo,
    metadata: params.metadata || '0x',
  }

  return {
    isValid: doubts.filter(d => d.severity === 'critical').length === 0,
    doubts,
    warnings,
    verifiedParams,
  }
}

// Cash out transaction verification
export function verifyCashOutParams(params: {
  holder: string
  projectId: bigint | string | number
  cashOutCount: bigint | string
  tokenToReclaim: string
  minTokensReclaimed: bigint | string
  beneficiary: string
  metadata?: string
  buybackRoute?: boolean
}): VerificationResult {
  const doubts: TransactionDoubt[] = []
  const warnings: string[] = []

  // Normalize values
  const projectId = parseBigIntParam(params.projectId, 'projectId', doubts)
  const cashOutCount = parseBigIntParam(params.cashOutCount, 'cashOutCount', doubts)
  const minTokensReclaimed = parseBigIntParam(params.minTokensReclaimed, 'minTokensReclaimed', doubts)
  validateUnsigned(cashOutCount, 'cashOutCount', doubts)
  validateUnsigned(minTokensReclaimed, 'minTokensReclaimed', doubts)

  // Validate holder address
  if (!isValidAddress(params.holder)) {
    doubts.push({
      severity: 'critical',
      field: 'holder',
      message: 'Invalid holder address format',
    })
  } else if (isZeroAddress(params.holder)) {
    doubts.push({ severity: 'critical', field: 'holder', message: 'Holder is zero address' })
  }

  // Validate project ID
  if (projectId <= 0n) {
    doubts.push({
      severity: 'critical',
      field: 'projectId',
      message: 'Invalid project ID',
    })
  }

  // Validate beneficiary
  if (!isValidAddress(params.beneficiary)) {
    doubts.push({
      severity: 'critical',
      field: 'beneficiary',
      message: 'Invalid beneficiary address format',
    })
  } else if (isZeroAddress(params.beneficiary)) {
    doubts.push({
      severity: 'critical',
      field: 'beneficiary',
      message: 'Beneficiary is zero address',
      technicalNote: 'Funds would be sent to the burn address',
    })
  }
  if (
    isValidAddress(params.holder) &&
    isValidAddress(params.beneficiary) &&
    params.holder.toLowerCase() !== params.beneficiary.toLowerCase()
  ) {
    doubts.push({
      severity: 'critical',
      field: 'beneficiary',
      message: 'Cash out beneficiary must be the token holder',
    })
  }

  // Validate cash out count
  if (cashOutCount === 0n) {
    doubts.push({
      severity: 'critical',
      field: 'cashOutCount',
      message: 'Cash out amount is zero',
    })
  } else if (cashOutCount > MAX_REASONABLE_TOKENS) {
    doubts.push({
      severity: 'warning',
      field: 'cashOutCount',
      message: `Large token burn: ${formatTokenAmount(cashOutCount)}`,
      technicalNote: 'This will permanently burn these tokens',
    })
  }

  // Validate token to reclaim
  if (!isValidAddress(params.tokenToReclaim)) {
    doubts.push({
      severity: 'critical',
      field: 'tokenToReclaim',
      message: 'Invalid token address',
    })
  } else if (!isRecognizedAccountingToken(params.tokenToReclaim)) {
    doubts.push({
      severity: 'critical',
      field: 'tokenToReclaim',
      message: `Cash out token not recognized: ${params.tokenToReclaim}`,
    })
  }
  if (cashOutCount > 0n && minTokensReclaimed === 0n && !params.buybackRoute) {
    doubts.push({
      severity: 'critical',
      field: 'minTokensReclaimed',
      message: 'Cash out minimum return must be greater than zero',
    })
  }
  if (params.metadata && params.metadata !== '0x' && !params.buybackRoute) {
    doubts.push({
      severity: 'critical',
      field: 'metadata',
      message: 'Cash out metadata is not supported in this flow',
    })
  }

  const verifiedParams: Record<string, unknown> = {
    holder: params.holder,
    projectId: projectId.toString(),
    cashOutCount: cashOutCount.toString(),
    tokenToReclaim: params.tokenToReclaim,
    minTokensReclaimed: minTokensReclaimed.toString(),
    beneficiary: params.beneficiary,
    metadata: params.metadata || '0x',
  }

  return {
    isValid: doubts.filter(d => d.severity === 'critical').length === 0,
    doubts,
    warnings,
    verifiedParams,
  }
}

// Send payouts verification
export function verifySendPayoutsParams(params: {
  projectId: bigint | string | number
  token: string
  amount: bigint | string
  currency: bigint | string | number
  minTokensPaidOut: bigint | string
}): VerificationResult {
  const doubts: TransactionDoubt[] = []
  const warnings: string[] = []

  // Normalize values
  const projectId = parseBigIntParam(params.projectId, 'projectId', doubts)
  const amount = parseBigIntParam(params.amount, 'amount', doubts)
  const currency = parseBigIntParam(params.currency, 'currency', doubts)
  const minTokensPaidOut = parseBigIntParam(params.minTokensPaidOut, 'minTokensPaidOut', doubts)
  validateUnsigned(amount, 'amount', doubts)
  validateUnsigned(currency, 'currency', doubts, 32)
  validateUnsigned(minTokensPaidOut, 'minTokensPaidOut', doubts)

  // Validate project ID
  if (projectId <= 0n) {
    doubts.push({
      severity: 'critical',
      field: 'projectId',
      message: 'Invalid project ID',
    })
  }

  // Validate token address
  if (!isValidAddress(params.token)) {
    doubts.push({
      severity: 'critical',
      field: 'token',
      message: 'Invalid token address format',
    })
  } else if (!isRecognizedAccountingToken(params.token)) {
    doubts.push({
      severity: 'critical',
      field: 'token',
      message: `Payout token not recognized: ${params.token}`,
    })
  } else if (currency !== accountingCurrencyOf(params.token)) {
    doubts.push({
      severity: 'critical',
      field: 'currency',
      message: 'Payout currency must match the selected accounting token',
    })
  }

  // Validate amount
  if (amount === 0n) {
    doubts.push({
      severity: 'critical',
      field: 'amount',
      message: 'Payout amount is zero',
    })
  } else if (amount > MAX_REASONABLE_ETH) {
    doubts.push({
      severity: 'warning',
      field: 'amount',
      message: `Large payout amount: ${formatEthAmount(amount)}`,
      technicalNote: 'Please verify recipient addresses are correct',
    })
  }
  if (amount > 0n && minTokensPaidOut !== amount) {
    doubts.push({
      severity: 'critical',
      field: 'minTokensPaidOut',
      message: 'Payout minimum must protect the full selected amount',
    })
  }

  const verifiedParams: Record<string, unknown> = {
    projectId: projectId.toString(),
    token: params.token,
    amount: amount.toString(),
    currency: currency.toString(),
    minTokensPaidOut: minTokensPaidOut.toString(),
  }

  return {
    isValid: doubts.filter(d => d.severity === 'critical').length === 0,
    doubts,
    warnings,
    verifiedParams,
  }
}

// Use surplus allowance verification
export function verifyUseAllowanceParams(params: {
  projectId: bigint | string | number
  token: string
  amount: bigint | string
  currency: bigint | string | number
  minTokensPaidOut: bigint | string
  beneficiary: string
  feeBeneficiary: string
  memo: string
}): VerificationResult {
  const doubts: TransactionDoubt[] = []
  const warnings: string[] = []

  // Normalize values
  const projectId = parseBigIntParam(params.projectId, 'projectId', doubts)
  const amount = parseBigIntParam(params.amount, 'amount', doubts)
  const currency = parseBigIntParam(params.currency, 'currency', doubts)
  const minTokensPaidOut = parseBigIntParam(params.minTokensPaidOut, 'minTokensPaidOut', doubts)
  validateUnsigned(amount, 'amount', doubts)
  validateUnsigned(currency, 'currency', doubts, 32)
  validateUnsigned(minTokensPaidOut, 'minTokensPaidOut', doubts)

  // Validate project ID
  if (projectId <= 0n) {
    doubts.push({
      severity: 'critical',
      field: 'projectId',
      message: 'Invalid project ID',
    })
  }

  // Validate token address
  if (!isValidAddress(params.token)) {
    doubts.push({
      severity: 'critical',
      field: 'token',
      message: 'Invalid token address format',
    })
  } else if (!isRecognizedAccountingToken(params.token)) {
    doubts.push({
      severity: 'critical',
      field: 'token',
      message: `Surplus allowance token not recognized: ${params.token}`,
    })
  } else if (currency !== accountingCurrencyOf(params.token)) {
    doubts.push({
      severity: 'critical',
      field: 'currency',
      message: 'Surplus allowance currency must match the selected accounting token',
    })
  }

  // Validate beneficiary
  if (!isValidAddress(params.beneficiary)) {
    doubts.push({
      severity: 'critical',
      field: 'beneficiary',
      message: 'Invalid beneficiary address format',
    })
  } else if (isZeroAddress(params.beneficiary)) {
    doubts.push({
      severity: 'critical',
      field: 'beneficiary',
      message: 'Beneficiary is zero address',
      technicalNote: 'Funds would be sent to the burn address',
    })
  }

  // Validate fee beneficiary
  if (!isValidAddress(params.feeBeneficiary)) {
    doubts.push({
      severity: 'critical',
      field: 'feeBeneficiary',
      message: 'Invalid fee beneficiary address',
    })
  } else if (isZeroAddress(params.feeBeneficiary)) {
    doubts.push({ severity: 'critical', field: 'feeBeneficiary', message: 'Fee beneficiary is zero address' })
  }
  if (
    isValidAddress(params.beneficiary) &&
    isValidAddress(params.feeBeneficiary) &&
    params.beneficiary.toLowerCase() !== params.feeBeneficiary.toLowerCase()
  ) {
    doubts.push({
      severity: 'critical',
      field: 'feeBeneficiary',
      message: 'Allowance fee beneficiary must match the withdrawal beneficiary',
    })
  }

  // Validate amount
  if (amount === 0n) {
    doubts.push({
      severity: 'critical',
      field: 'amount',
      message: 'Withdrawal amount is zero',
    })
  } else if (amount > MAX_REASONABLE_ETH) {
    doubts.push({
      severity: 'warning',
      field: 'amount',
      message: `Large withdrawal: ${formatEthAmount(amount)}`,
      technicalNote: 'Please verify this amount is correct',
    })
  }
  if (amount > 0n) {
    const requiredMinimum = amount - (amount / 40n)
    if (minTokensPaidOut < requiredMinimum || minTokensPaidOut > amount) {
      doubts.push({
        severity: 'critical',
        field: 'minTokensPaidOut',
        message: 'Surplus allowance minimum return is not safe',
      })
    }
  }

  const verifiedParams: Record<string, unknown> = {
    projectId: projectId.toString(),
    token: params.token,
    amount: amount.toString(),
    currency: currency.toString(),
    minTokensPaidOut: minTokensPaidOut.toString(),
    beneficiary: params.beneficiary,
    feeBeneficiary: params.feeBeneficiary,
    memo: params.memo,
  }

  return {
    isValid: doubts.filter(d => d.severity === 'critical').length === 0,
    doubts,
    warnings,
    verifiedParams,
  }
}

// Deploy ERC20 verification
export function verifyDeployERC20Params(params: {
  projectId: bigint | string | number
  name: string
  symbol: string
  salt?: string
}): VerificationResult {
  const doubts: TransactionDoubt[] = []
  const warnings: string[] = []

  // Normalize values
  const projectId = parseBigIntParam(params.projectId, 'projectId', doubts)

  // Validate project ID
  if (projectId <= 0n) {
    doubts.push({
      severity: 'critical',
      field: 'projectId',
      message: 'Invalid project ID',
    })
  }

  // Validate token name
  if (!params.name || params.name.trim().length === 0) {
    doubts.push({
      severity: 'critical',
      field: 'name',
      message: 'Token name is required',
    })
  } else if (params.name.length > 50) {
    warnings.push('Token name is unusually long')
  }

  // Validate token symbol
  if (!params.symbol || params.symbol.trim().length === 0) {
    doubts.push({
      severity: 'critical',
      field: 'symbol',
      message: 'Token symbol is required',
    })
  } else if (params.symbol.length > 10) {
    warnings.push('Token symbol is unusually long')
  }

  const verifiedParams: Record<string, unknown> = {
    projectId: projectId.toString(),
    name: params.name,
    symbol: params.symbol,
    salt: params.salt || '(generated at execution)',
  }

  return {
    isValid: doubts.filter(d => d.severity === 'critical').length === 0,
    doubts,
    warnings,
    verifiedParams,
  }
}

// Queue ruleset verification
export function verifyQueueRulesetParams(params: {
  projectId: bigint | string | number
  rulesetConfigurations: ValidatableRulesetConfig[]
  memo: string
}): VerificationResult {
  const doubts: TransactionDoubt[] = []
  const warnings: string[] = []

  // Normalize values
  const projectId = parseBigIntParam(params.projectId, 'projectId', doubts)

  // Validate project ID
  if (projectId <= 0n) {
    doubts.push({
      severity: 'critical',
      field: 'projectId',
      message: 'Invalid project ID',
    })
  }

  // Validate ruleset configurations
  if (!params.rulesetConfigurations || params.rulesetConfigurations.length === 0) {
    doubts.push({
      severity: 'critical',
      field: 'rulesetConfigurations',
      message: 'At least one ruleset configuration is required',
    })
  }

  params.rulesetConfigurations?.forEach((config, index) => {
    validateRulesetConfig(config, index, doubts)

    // Check for extremely high reserved percent (>50%)
    if (config.metadata?.reservedPercent && config.metadata.reservedPercent > 5000) {
      doubts.push({
        severity: 'warning',
        field: `rulesetConfigurations[${index}].metadata.reservedPercent`,
        message: `High reserved percentage: ${config.metadata.reservedPercent / 100}%`,
        technicalNote: 'More than half of new tokens will go to reserved recipients',
      })
    }

    // 10000 is a disabled sentinel, not a flat 100% fee.
    if (config.metadata?.cashOutTaxRate === 10000) {
      warnings.push(`Ruleset ${index + 1}: Cash outs are disabled (curve rate sentinel 10000)`)
    }

    // Check for past start time
    if (config.mustStartAtOrAfter) {
      const now = Math.floor(Date.now() / 1000)
      if (config.mustStartAtOrAfter > 0 && config.mustStartAtOrAfter < now) {
        warnings.push(`Ruleset ${index + 1}: Start time is in the past`)
      }
    }
  })

  const verifiedParams: Record<string, unknown> = {
    projectId: projectId.toString(),
    rulesetConfigurations: params.rulesetConfigurations,
    memo: params.memo,
  }

  return {
    isValid: doubts.filter(d => d.severity === 'critical').length === 0,
    doubts,
    warnings,
    verifiedParams,
  }
}

// Launch project verification
export function verifyLaunchProjectParams(params: {
  owner: string
  projectUri: string
  chainIds: number[]
  rulesetConfigurations: Array<unknown>
  terminalConfigurations: Array<unknown>
  memo: string
  chainConfigs?: Array<{
    chainId: number
    label?: string
    overrides?: {
      terminalConfigurations?: Array<unknown>
    }
  }>
}): VerificationResult {
  const doubts: TransactionDoubt[] = []
  const warnings: string[] = []

  // Validate owner address
  if (!isValidAddress(params.owner)) {
    doubts.push({
      severity: 'critical',
      field: 'owner',
      message: 'Invalid owner address format',
    })
  } else if (isZeroAddress(params.owner)) {
    doubts.push({
      severity: 'critical',
      field: 'owner',
      message: 'Owner is zero address',
      technicalNote: 'Project would have no owner',
    })
  }

  // Validate project URI
  if (!params.projectUri || params.projectUri.trim().length === 0) {
    doubts.push({
      severity: 'critical',
      field: 'projectUri',
      message: 'Project metadata URI is required',
    })
  } else if (!isIpfsUri(params.projectUri)) {
    doubts.push({
      severity: 'critical',
      field: 'projectUri',
      message: 'Project metadata must use an IPFS URI',
    })
  }

  // Validate chain IDs
  const supportedChains = ALL_CHAIN_IDS
  if (!params.chainIds || params.chainIds.length === 0) {
    doubts.push({
      severity: 'critical',
      field: 'chainIds',
      message: 'At least one destination chain is required',
    })
  }
  params.chainIds?.forEach(chainId => {
    if (!supportedChains.includes(chainId)) {
      doubts.push({
        severity: 'critical',
        field: 'chainIds',
        message: `Unsupported chain ID: ${chainId}`,
      })
    }
  })

  // Check for duplicate chain IDs
  const uniqueChains = new Set(params.chainIds)
  if (uniqueChains.size !== params.chainIds?.length) {
    doubts.push({
      severity: 'critical',
      field: 'chainIds',
      message: 'Duplicate chain IDs detected',
    })
  }

  // Validate ruleset configurations exist
  if (!params.rulesetConfigurations || params.rulesetConfigurations.length === 0) {
    doubts.push({
      severity: 'critical',
      field: 'rulesetConfigurations',
      message: 'At least one ruleset configuration is required',
    })
  } else {
    // Validate addresses within ruleset configurations
    type FundAccessLimitGroup = { terminal?: string; token?: string }
    type SplitGroup = { splits?: Array<{ beneficiary?: string }> }
    type RulesetConfig = ValidatableRulesetConfig & { fundAccessLimitGroups?: FundAccessLimitGroup[]; splitGroups?: SplitGroup[] }

    const rulesetConfigs = params.rulesetConfigurations as RulesetConfig[]
    rulesetConfigs.forEach((rc, rcIdx) => {
      validateRulesetConfig(rc, rcIdx, doubts)
      if (rc.metadata?.dataHook && isValidAddress(rc.metadata.dataHook)) {
        try {
          requireRecognizedNewProjectDataHook(rc.metadata.dataHook)
        } catch (err) {
          doubts.push({
            severity: 'critical',
            field: `rulesetConfigurations[${rcIdx}].metadata.dataHook`,
            message: err instanceof Error ? err.message : 'Data hook not recognized',
          })
        }
      }
      // Validate fund access limit groups
      rc.fundAccessLimitGroups?.forEach((fg, fgIdx) => {
        if (fg.terminal && !isValidAddress(fg.terminal)) {
          doubts.push({
            severity: 'critical',
            field: `rulesetConfigurations[${rcIdx}].fundAccessLimitGroups[${fgIdx}].terminal`,
            message: `Invalid terminal address: "${fg.terminal}"`,
            technicalNote: 'Terminal address must be a valid 40-character hex address (42 with 0x prefix)',
          })
        }
        if (fg.token && !isValidAddress(fg.token)) {
          doubts.push({
            severity: 'critical',
            field: `rulesetConfigurations[${rcIdx}].fundAccessLimitGroups[${fgIdx}].token`,
            message: `Invalid token address: "${fg.token}"`,
            technicalNote: 'Token address must be a valid 40-character hex address (42 with 0x prefix)',
          })
        }
      })

      // Validate split beneficiary addresses
      rc.splitGroups?.forEach((sg, sgIdx) => {
        sg.splits?.forEach((split, splitIdx) => {
          if (split.beneficiary && !isValidAddress(split.beneficiary)) {
            doubts.push({
              severity: 'critical',
              field: `rulesetConfigurations[${rcIdx}].splitGroups[${sgIdx}].splits[${splitIdx}].beneficiary`,
              message: `Invalid beneficiary address: "${split.beneficiary}"`,
              technicalNote: 'Beneficiary address must be a valid 40-character hex address (42 with 0x prefix)',
            })
          }
        })
      })
    })
  }

  // Validate terminal configurations exist
  if (!params.terminalConfigurations || params.terminalConfigurations.length === 0) {
    doubts.push({
      severity: 'critical',
      field: 'terminalConfigurations',
      message: 'At least one terminal configuration is required',
    })
  } else {
    validateLaunchTerminalConfigurations(
      params.terminalConfigurations as Parameters<typeof validateLaunchTerminalConfigurations>[0],
      'terminalConfigurations',
      doubts,
    )
  }

  // Validate chainConfigs (per-chain terminal overrides)
  if (params.chainConfigs && params.chainConfigs.length > 0) {
    params.chainConfigs.forEach((chainConfig, ccIdx) => {
      const chainLabel = chainConfig.label || `Chain ${chainConfig.chainId}`

      // Validate terminal configurations in the override
      const overrideTerminals = chainConfig.overrides?.terminalConfigurations as Array<{ terminal?: string; accountingContextsToAccept?: unknown[] }> | undefined
      if (overrideTerminals) {
        validateLaunchTerminalConfigurations(
          overrideTerminals as Parameters<typeof validateLaunchTerminalConfigurations>[0],
          `chainConfigs[${ccIdx}] (${chainLabel}).terminalConfigurations`,
          doubts,
        )
      }
    })
  }

  const verifiedParams: Record<string, unknown> = {
    owner: params.owner,
    projectUri: params.projectUri,
    chainIds: params.chainIds,
    rulesetConfigurations: params.rulesetConfigurations,
    terminalConfigurations: params.terminalConfigurations,
    memo: params.memo,
  }

  return {
    isValid: doubts.filter(d => d.severity === 'critical').length === 0,
    doubts,
    warnings,
    verifiedParams,
  }
}

// Deploy revnet verification
export function verifyDeployRevnetParams(params: {
  name: string
  ticker?: string
  tagline?: string
  projectUri?: string
  splitOperator: string
  chainIds: number[]
  stageConfigurations: Array<{
    startsAtOrAfter?: number
    splitPercent?: number
    initialIssuance?: bigint | string | number
    issuanceCutFrequency?: number
    issuanceCutPercent?: number
    cashOutTaxRate?: number
  }>
}): VerificationResult {
  const doubts: TransactionDoubt[] = []
  const warnings: string[] = []

  // Validate name
  if (!params.name || params.name.trim().length === 0) {
    doubts.push({
      severity: 'critical',
      field: 'name',
      message: 'Revnet name is required',
    })
  }

  if (!params.ticker || !/^[A-Za-z0-9]{1,11}$/.test(params.ticker)) {
    doubts.push({
      severity: 'critical',
      field: 'ticker',
      message: 'Ticker must be 1-11 letters or numbers',
    })
  }

  if (!params.projectUri || !isIpfsUri(params.projectUri)) {
    doubts.push({
      severity: 'critical',
      field: 'projectUri',
      message: 'Revnet metadata must be pinned to IPFS',
    })
  }

  // Validate split operator
  if (!isValidAddress(params.splitOperator)) {
    doubts.push({
      severity: 'critical',
      field: 'splitOperator',
      message: 'Invalid split operator address',
    })
  } else if (isZeroAddress(params.splitOperator)) {
    doubts.push({
      severity: 'critical',
      field: 'splitOperator',
      message: 'Split operator is zero address',
    })
  }

  // Validate chain IDs
  const supportedChains = ALL_CHAIN_IDS
  if (!params.chainIds || params.chainIds.length === 0) {
    doubts.push({ severity: 'critical', field: 'chainIds', message: 'At least one chain is required' })
  }
  const uniqueChainIds = new Set(params.chainIds)
  if (uniqueChainIds.size !== params.chainIds.length) {
    doubts.push({ severity: 'critical', field: 'chainIds', message: 'Duplicate chain IDs detected' })
  }
  params.chainIds?.forEach(chainId => {
    if (!supportedChains.includes(chainId)) {
      doubts.push({
        severity: 'critical',
        field: 'chainIds',
        message: `Unsupported chain ID: ${chainId}`,
      })
    }
  })

  // Validate stage configurations
  if (!params.stageConfigurations || params.stageConfigurations.length === 0) {
    doubts.push({
      severity: 'critical',
      field: 'stageConfigurations',
      message: 'At least one stage configuration is required',
    })
  }

  let previousStageStart = -1
  params.stageConfigurations?.forEach((stage, index) => {
    validateIntegerRange(stage.startsAtOrAfter, `stageConfigurations[${index}].startsAtOrAfter`, 0, Number.MAX_SAFE_INTEGER, doubts)
    if (stage.startsAtOrAfter !== undefined && index > 0 && stage.startsAtOrAfter <= previousStageStart) {
      doubts.push({
        severity: 'critical',
        field: `stageConfigurations[${index}].startsAtOrAfter`,
        message: `Stage ${index + 1} must start after stage ${index}`,
      })
    }
    if (stage.startsAtOrAfter !== undefined) previousStageStart = stage.startsAtOrAfter

    validateIntegerRange(stage.splitPercent, `stageConfigurations[${index}].splitPercent`, 0, 10_000, doubts)
    const initialIssuance = parseBigIntParam(
      stage.initialIssuance ?? 0,
      `stageConfigurations[${index}].initialIssuance`,
      doubts,
    )
    if (initialIssuance <= 0n || initialIssuance > (1n << 112n) - 1n) {
      doubts.push({
        severity: 'critical',
        field: `stageConfigurations[${index}].initialIssuance`,
        message: `Stage ${index + 1} issuance must fit uint112 and be greater than zero`,
      })
    }
    validateIntegerRange(stage.issuanceCutFrequency, `stageConfigurations[${index}].issuanceCutFrequency`, 86_400, 2 ** 32 - 1, doubts)
    validateIntegerRange(stage.issuanceCutPercent, `stageConfigurations[${index}].issuanceCutPercent`, 0, 1_000_000_000, doubts)
    validateIntegerRange(stage.cashOutTaxRate, `stageConfigurations[${index}].cashOutTaxRate`, 0, 9_999, doubts)

    // High split percent warning (>50%) - V6 splitPercent is out of 10,000
    if (stage.splitPercent && stage.splitPercent > 5000) {
      doubts.push({
        severity: 'warning',
        field: `stageConfigurations[${index}].splitPercent`,
        message: `High operator split: ${(stage.splitPercent / 100).toFixed(1)}%`,
      })
    }

    // High issuance cut warning (>50%) - out of 1,000,000,000
    if (stage.issuanceCutPercent && stage.issuanceCutPercent > 500000000) {
      doubts.push({
        severity: 'warning',
        field: `stageConfigurations[${index}].issuanceCutPercent`,
        message: `High issuance cut: ${(stage.issuanceCutPercent / 10000000).toFixed(1)}%`,
        technicalNote: 'Token issuance will decrease rapidly',
      })
    }

  })

  const verifiedParams: Record<string, unknown> = {
    name: params.name,
    ticker: params.ticker,
    tagline: params.tagline,
    projectUri: params.projectUri,
    splitOperator: params.splitOperator,
    chainIds: params.chainIds,
    stageConfigurations: params.stageConfigurations,
  }

  return {
    isValid: doubts.filter(d => d.severity === 'critical').length === 0,
    doubts,
    warnings,
    verifiedParams,
  }
}

// Send reserved tokens verification
export function verifySendReservedTokensParams(params: {
  projectId: bigint | string | number
  pendingReservedTokens?: bigint | string
  reservedRate?: number
  splits?: Array<{
    beneficiary: string
    percent: number
    projectId?: number
    lockedUntil?: number
  }>
}): VerificationResult {
  const doubts: TransactionDoubt[] = []
  const warnings: string[] = []

  // Normalize values
  const projectId = parseBigIntParam(params.projectId, 'projectId', doubts)

  // Validate project ID
  if (projectId <= 0n) {
    doubts.push({
      severity: 'critical',
      field: 'projectId',
      message: 'Invalid project ID',
    })
  }

  // Check if there are pending reserved tokens
  if (params.pendingReservedTokens !== undefined) {
    const pending = parseBigIntParam(params.pendingReservedTokens, 'pendingReservedTokens', doubts)
    validateUnsigned(pending, 'pendingReservedTokens', doubts)
    if (pending === 0n) {
      doubts.push({
        severity: 'warning',
        field: 'pendingReservedTokens',
        message: 'No reserved tokens to distribute',
        technicalNote: 'Transaction will succeed but no tokens will be minted',
      })
    } else if (pending > MAX_REASONABLE_TOKENS) {
      doubts.push({
        severity: 'warning',
        field: 'pendingReservedTokens',
        message: `Large distribution: ${formatTokenAmount(pending)} tokens`,
        technicalNote: 'Please verify split recipients are correct',
      })
    }
  }

  // Validate splits if provided
  params.splits?.forEach((split, index) => {
    if (!isValidAddress(split.beneficiary)) {
      doubts.push({
        severity: 'critical',
        field: `splits[${index}].beneficiary`,
        message: `Invalid beneficiary address in split ${index + 1}`,
      })
    } else if (isZeroAddress(split.beneficiary) && !split.projectId) {
      doubts.push({
        severity: 'critical',
        field: `splits[${index}].beneficiary`,
        message: `Split ${index + 1} has zero beneficiary without project ID`,
        technicalNote: 'Tokens would be sent to burn address',
      })
    }

    // Check for locked splits
    if (split.lockedUntil) {
      const now = Math.floor(Date.now() / 1000)
      if (split.lockedUntil > now) {
        warnings.push(`Split ${index + 1} is locked until ${new Date(split.lockedUntil * 1000).toLocaleDateString()}`)
      }
    }
  })

  // Check reserved rate
  if (params.reservedRate === 0) {
    doubts.push({
      severity: 'warning',
      field: 'reservedRate',
      message: 'Reserved rate is 0%',
      technicalNote: 'No tokens are being reserved for distribution',
    })
  }

  const verifiedParams: Record<string, unknown> = {
    projectId: projectId.toString(),
    pendingReservedTokens: params.pendingReservedTokens?.toString(),
    reservedRate: params.reservedRate,
    splitCount: params.splits?.length || 0,
  }

  return {
    isValid: doubts.filter(d => d.severity === 'critical').length === 0,
    doubts,
    warnings,
    verifiedParams,
  }
}

// Generic verification result creator for edge cases
export function createVerificationResult(
  isValid: boolean,
  doubts: TransactionDoubt[] = [],
  warnings: string[] = [],
  verifiedParams: Record<string, unknown> = {}
): VerificationResult {
  return {
    isValid,
    doubts,
    warnings,
    verifiedParams,
  }
}
