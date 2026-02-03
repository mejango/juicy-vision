// Transaction verification utilities
// Validates transaction parameters against contract ABIs before display

import {
  type PayParams,
  type CashOutParams,
  type SendPayoutsParams,
  type UseAllowanceParams,
  type DeployERC20Params,
  NATIVE_TOKEN,
} from '../constants/abis'
import { ALL_CHAIN_IDS } from '../constants'

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
const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
const MAX_REASONABLE_ETH = BigInt('1000000000000000000000') // 1000 ETH
const MAX_REASONABLE_TOKENS = BigInt('1000000000000000000000000000') // 1 billion tokens
const MIN_REASONABLE_AMOUNT = BigInt('1000000000000') // 0.000001 ETH (1e12 wei)

// ============================================================================
// ADDRESS AUTO-CORRECTION
// ============================================================================
// AI models sometimes "hallucinate" addresses by dropping characters.
// This utility detects malformed addresses that are close to known canonical
// addresses and auto-corrects them before validation.
//
// Example hallucination:
//   Wrong:   0x1ce40d201cdec791de1810d17aaf501be167422  (missing '05')
//   Correct: 0x1ce40d201cdec791de05810d17aaf501be167422
// ============================================================================

// Known canonical addresses that AI might hallucinate
// These are JB V5.1 terminal addresses (same on all chains via CREATE2)
const KNOWN_ADDRESSES: Record<string, string> = {
  // JB V5.1 Terminals (deterministic addresses)
  '0x52869db3d61dde1e391967f2ce5039ad0ecd371c': 'JBMultiTerminal5_1',
  '0x1ce40d201cdec791de05810d17aaf501be167422': 'JBSwapTerminalUSDCRegistry',
  // JB Shared Contracts
  '0x4d0edd347fb1fa21589c1e109b3474924be87636': 'JBTokens',
  '0x885f707efa18d2cb12f05a3a8eba6b4b26c8c1d4': 'JBProjects',
  '0x0061e516886a0540f63157f112c0588ee0651dcf': 'JBDirectory',
  '0x7160a322fea44945a6ef9adfd65c322258df3c5e': 'JBSplits',
  '0x3a46b21720c8b70184b0434a2293b2fdcc497ce7': 'JBFundAccessLimits',
  // JB V5 Terminals (for Revnets)
  '0x27da30646502e2f642be5281322ae8c394f7668a': 'JBController_V5',
  '0x2db6d704058e552defe415753465df8df0361846': 'JBMultiTerminal_V5',
  // V5.1 Specific
  '0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1': 'JBController5_1',
  '0xd4257005ca8d27bbe11f356453b0e4692414b056': 'JBRulesets5_1',
  '0x587bf86677ec0d1b766d9ba0d7ac2a51c6c2fc71': 'JBOmnichainDeployer5_1',
}

// Compute Levenshtein edit distance between two strings
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

// Find the closest known address to a potentially hallucinated address
function findClosestKnownAddress(address: string): { address: string; name: string; distance: number } | null {
  if (!address || !address.startsWith('0x')) return null

  const normalizedInput = address.toLowerCase()
  let bestMatch: { address: string; name: string; distance: number } | null = null

  for (const [knownAddr, name] of Object.entries(KNOWN_ADDRESSES)) {
    const distance = levenshteinDistance(normalizedInput, knownAddr.toLowerCase())

    // Only consider matches with small edit distance (1-3 character differences)
    // This catches AI dropping characters but avoids false matches
    if (distance > 0 && distance <= 3) {
      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = { address: knownAddr, name, distance }
      }
    }
  }

  return bestMatch
}

/**
 * Auto-correct a potentially hallucinated address to its canonical form.
 * Returns the corrected address if a close match is found, otherwise returns the original.
 *
 * @param address - The address to check and potentially correct
 * @returns Object with corrected address and whether a correction was made
 */
export function autoCorrectAddress(address: string): {
  address: string
  wasCorrected: boolean
  originalAddress?: string
  matchedContract?: string
} {
  if (!address) return { address, wasCorrected: false }

  // If already valid and exact match to known address, no correction needed
  const normalized = address.toLowerCase()
  if (KNOWN_ADDRESSES[normalized]) {
    return { address, wasCorrected: false }
  }

  // If valid address format, no correction needed
  if (isValidAddress(address)) {
    return { address, wasCorrected: false }
  }

  // Address is malformed - try to find a close match
  const match = findClosestKnownAddress(address)
  if (match) {
    console.log(`[autoCorrectAddress] Corrected hallucinated address:`)
    console.log(`  Original: ${address} (${address.length} chars)`)
    console.log(`  Corrected: ${match.address} (${match.address.length} chars)`)
    console.log(`  Contract: ${match.name}, Edit distance: ${match.distance}`)
    return {
      address: match.address,
      wasCorrected: true,
      originalAddress: address,
      matchedContract: match.name,
    }
  }

  // No close match found, return original
  return { address, wasCorrected: false }
}

/**
 * Auto-correct all addresses in terminal configurations.
 * Mutates the input object in place and returns correction info.
 */
export function autoCorrectTerminalConfigurations(
  terminalConfigurations: Array<{ terminal?: string; accountingContextsToAccept?: Array<{ token?: string }> }>
): Array<{ field: string; original: string; corrected: string; contract: string }> {
  const corrections: Array<{ field: string; original: string; corrected: string; contract: string }> = []

  terminalConfigurations.forEach((tc, idx) => {
    // Check terminal address
    if (tc.terminal) {
      const result = autoCorrectAddress(tc.terminal)
      if (result.wasCorrected) {
        corrections.push({
          field: `terminalConfigurations[${idx}].terminal`,
          original: result.originalAddress!,
          corrected: result.address,
          contract: result.matchedContract!,
        })
        tc.terminal = result.address
      }
    }

    // Check token addresses in accounting contexts
    tc.accountingContextsToAccept?.forEach((ctx, ctxIdx) => {
      if (ctx.token) {
        const result = autoCorrectAddress(ctx.token)
        if (result.wasCorrected) {
          corrections.push({
            field: `terminalConfigurations[${idx}].accountingContextsToAccept[${ctxIdx}].token`,
            original: result.originalAddress!,
            corrected: result.address,
            contract: result.matchedContract!,
          })
          ctx.token = result.address
        }
      }
    })
  })

  return corrections
}

/**
 * Auto-correct addresses in chain configs (per-chain terminal overrides).
 */
export function autoCorrectChainConfigs(
  chainConfigs: Array<{
    chainId: number | string
    overrides?: {
      terminalConfigurations?: Array<{ terminal?: string; accountingContextsToAccept?: Array<{ token?: string }> }>
    }
  }>
): Array<{ field: string; original: string; corrected: string; contract: string }> {
  const corrections: Array<{ field: string; original: string; corrected: string; contract: string }> = []

  chainConfigs.forEach((cfg, cfgIdx) => {
    if (cfg.overrides?.terminalConfigurations) {
      cfg.overrides.terminalConfigurations.forEach((tc, idx) => {
        // Check terminal address
        if (tc.terminal) {
          const result = autoCorrectAddress(tc.terminal)
          if (result.wasCorrected) {
            corrections.push({
              field: `chainConfigs[${cfgIdx}].terminalConfigurations[${idx}].terminal`,
              original: result.originalAddress!,
              corrected: result.address,
              contract: result.matchedContract!,
            })
            tc.terminal = result.address
          }
        }

        // Check token addresses
        tc.accountingContextsToAccept?.forEach((ctx, ctxIdx) => {
          if (ctx.token) {
            const result = autoCorrectAddress(ctx.token)
            if (result.wasCorrected) {
              corrections.push({
                field: `chainConfigs[${cfgIdx}].terminalConfigurations[${idx}].accountingContextsToAccept[${ctxIdx}].token`,
                original: result.originalAddress!,
                corrected: result.address,
                contract: result.matchedContract!,
              })
              ctx.token = result.address
            }
          }
        })
      })
    }
  })

  return corrections
}

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

function isBigIntOverflow(value: bigint, maxBits: number = 256): boolean {
  const maxValue = BigInt(2) ** BigInt(maxBits) - BigInt(1)
  return value > maxValue
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
  const projectId = BigInt(params.projectId)
  const amount = BigInt(params.amount)
  const minReturnedTokens = BigInt(params.minReturnedTokens)

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
      severity: 'warning',
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
}): VerificationResult {
  const doubts: TransactionDoubt[] = []
  const warnings: string[] = []

  // Normalize values
  const projectId = BigInt(params.projectId)
  const cashOutCount = BigInt(params.cashOutCount)
  const minTokensReclaimed = BigInt(params.minTokensReclaimed)

  // Validate holder address
  if (!isValidAddress(params.holder)) {
    doubts.push({
      severity: 'critical',
      field: 'holder',
      message: 'Invalid holder address format',
    })
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

  // Validate cash out count
  if (cashOutCount === 0n) {
    doubts.push({
      severity: 'warning',
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
  const projectId = BigInt(params.projectId)
  const amount = BigInt(params.amount)
  const currency = BigInt(params.currency)
  const minTokensPaidOut = BigInt(params.minTokensPaidOut)

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
  }

  // Validate amount
  if (amount === 0n) {
    doubts.push({
      severity: 'warning',
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

  // Validate currency (1 = ETH, 2 = USD)
  if (currency !== 1n && currency !== 2n) {
    warnings.push(`Unusual currency code: ${currency}`)
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
  const projectId = BigInt(params.projectId)
  const amount = BigInt(params.amount)
  const currency = BigInt(params.currency)

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
  }

  // Validate amount
  if (amount === 0n) {
    doubts.push({
      severity: 'warning',
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

  const verifiedParams: Record<string, unknown> = {
    projectId: projectId.toString(),
    token: params.token,
    amount: amount.toString(),
    currency: currency.toString(),
    minTokensPaidOut: BigInt(params.minTokensPaidOut).toString(),
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
  const projectId = BigInt(params.projectId)

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
  rulesetConfigurations: Array<{
    mustStartAtOrAfter?: number
    duration?: number
    weight?: bigint | string | number
    weightCutPercent?: number
    metadata?: {
      reservedPercent?: number
      cashOutTaxRate?: number
      baseCurrency?: number
    }
  }>
  memo: string
}): VerificationResult {
  const doubts: TransactionDoubt[] = []
  const warnings: string[] = []

  // Normalize values
  const projectId = BigInt(params.projectId)

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
    // Check for extremely high reserved percent (>50%)
    if (config.metadata?.reservedPercent && config.metadata.reservedPercent > 5000) {
      doubts.push({
        severity: 'warning',
        field: `rulesetConfigurations[${index}].metadata.reservedPercent`,
        message: `High reserved percentage: ${config.metadata.reservedPercent / 100}%`,
        technicalNote: 'More than half of new tokens will go to reserved recipients',
      })
    }

    // Check for cash out disabled (100% tax)
    if (config.metadata?.cashOutTaxRate === 10000) {
      warnings.push(`Ruleset ${index + 1}: Cash outs are disabled (100% tax)`)
    }

    // Check weight overflow (max is 2^88)
    if (config.weight) {
      const weight = BigInt(config.weight)
      if (isBigIntOverflow(weight, 112)) {
        doubts.push({
          severity: 'critical',
          field: `rulesetConfigurations[${index}].weight`,
          message: 'Weight exceeds maximum value',
          technicalNote: 'Weight must fit in uint112',
        })
      }
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
    warnings.push('No project metadata URI provided')
  } else if (!params.projectUri.startsWith('ipfs://')) {
    warnings.push('Project URI is not an IPFS link')
  }

  // Validate chain IDs
  const supportedChains = ALL_CHAIN_IDS
  params.chainIds?.forEach(chainId => {
    if (!supportedChains.includes(chainId)) {
      doubts.push({
        severity: 'warning',
        field: 'chainIds',
        message: `Unsupported chain ID: ${chainId}`,
      })
    }
  })

  // Check for duplicate chain IDs
  const uniqueChains = new Set(params.chainIds)
  if (uniqueChains.size !== params.chainIds?.length) {
    doubts.push({
      severity: 'warning',
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
    type RulesetConfig = { fundAccessLimitGroups?: FundAccessLimitGroup[]; splitGroups?: SplitGroup[] }

    const rulesetConfigs = params.rulesetConfigurations as RulesetConfig[]
    rulesetConfigs.forEach((rc, rcIdx) => {
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
    // Validate each terminal configuration
    const terminalConfigs = params.terminalConfigurations as Array<{ terminal?: string; accountingContextsToAccept?: unknown[] }>
    terminalConfigs.forEach((tc, idx) => {
      // Validate terminal address format
      if (tc.terminal && !isValidAddress(tc.terminal)) {
        doubts.push({
          severity: 'critical',
          field: `terminalConfigurations[${idx}].terminal`,
          message: `Invalid terminal address: "${tc.terminal}"`,
          technicalNote: 'Terminal address must be a valid 40-character hex address (42 with 0x prefix)',
        })
      }

      // Validate token addresses in accounting contexts
      if (tc.accountingContextsToAccept) {
        const contexts = tc.accountingContextsToAccept as Array<{ token?: string }>
        contexts.forEach((ctx, ctxIdx) => {
          if (ctx.token && !isValidAddress(ctx.token)) {
            doubts.push({
              severity: 'critical',
              field: `terminalConfigurations[${idx}].accountingContextsToAccept[${ctxIdx}].token`,
              message: `Invalid token address: "${ctx.token}"`,
              technicalNote: 'Token address must be a valid 40-character hex address (42 with 0x prefix)',
            })
          }
        })
      }
    })

    // Check for terminals with empty accounting contexts
    const emptyContextTerminals = terminalConfigs.filter(
      tc => !tc.accountingContextsToAccept || tc.accountingContextsToAccept.length === 0
    )
    if (emptyContextTerminals.length > 0) {
      warnings.push(
        `${emptyContextTerminals.length} terminal(s) have empty accountingContextsToAccept - ` +
        `this may cause simulation failures if the terminal requires accounting contexts`
      )
    }
  }

  // Validate chainConfigs (per-chain terminal overrides)
  if (params.chainConfigs && params.chainConfigs.length > 0) {
    params.chainConfigs.forEach((chainConfig, ccIdx) => {
      const chainLabel = chainConfig.label || `Chain ${chainConfig.chainId}`

      // Validate terminal configurations in the override
      const overrideTerminals = chainConfig.overrides?.terminalConfigurations as Array<{ terminal?: string; accountingContextsToAccept?: unknown[] }> | undefined
      if (overrideTerminals) {
        overrideTerminals.forEach((tc, tcIdx) => {
          // Validate terminal address format
          if (tc.terminal && !isValidAddress(tc.terminal)) {
            doubts.push({
              severity: 'critical',
              field: `chainConfigs[${ccIdx}] (${chainLabel}).terminalConfigurations[${tcIdx}].terminal`,
              message: `Invalid terminal address on ${chainLabel}: "${tc.terminal}"`,
              technicalNote: 'Terminal address must be a valid 40-character hex address (42 with 0x prefix). This appears to be a hallucinated or corrupted address.',
            })
          }

          // Validate token addresses in accounting contexts
          if (tc.accountingContextsToAccept) {
            const contexts = tc.accountingContextsToAccept as Array<{ token?: string }>
            contexts.forEach((ctx, ctxIdx) => {
              if (ctx.token && !isValidAddress(ctx.token)) {
                doubts.push({
                  severity: 'critical',
                  field: `chainConfigs[${ccIdx}] (${chainLabel}).terminalConfigurations[${tcIdx}].accountingContextsToAccept[${ctxIdx}].token`,
                  message: `Invalid token address on ${chainLabel}: "${ctx.token}"`,
                  technicalNote: 'Token address must be a valid 40-character hex address (42 with 0x prefix)',
                })
              }
            })
          }
        })
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
  tagline?: string
  splitOperator: string
  chainIds: number[]
  stageConfigurations: Array<{
    startsAtOrAfter?: number
    splitPercent?: number
    initialIssuance?: bigint | string | number
    issuanceDecayFrequency?: number
    issuanceDecayPercent?: number
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
  params.chainIds?.forEach(chainId => {
    if (!supportedChains.includes(chainId)) {
      doubts.push({
        severity: 'warning',
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

  params.stageConfigurations?.forEach((stage, index) => {
    // High split percent warning (>50%)
    if (stage.splitPercent && stage.splitPercent > 500000000) {
      doubts.push({
        severity: 'warning',
        field: `stageConfigurations[${index}].splitPercent`,
        message: `High operator split: ${(stage.splitPercent / 10000000).toFixed(1)}%`,
      })
    }

    // High decay percent warning (>50%)
    if (stage.issuanceDecayPercent && stage.issuanceDecayPercent > 500000000) {
      doubts.push({
        severity: 'warning',
        field: `stageConfigurations[${index}].issuanceDecayPercent`,
        message: `High issuance decay: ${(stage.issuanceDecayPercent / 10000000).toFixed(1)}%`,
        technicalNote: 'Token issuance will decrease rapidly',
      })
    }

    // Cash out disabled warning
    if (stage.cashOutTaxRate === 10000) {
      warnings.push(`Stage ${index + 1}: Cash outs are disabled (100% tax)`)
    }
  })

  const verifiedParams: Record<string, unknown> = {
    name: params.name,
    tagline: params.tagline,
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
  const projectId = BigInt(params.projectId)

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
    const pending = BigInt(params.pendingReservedTokens)
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
