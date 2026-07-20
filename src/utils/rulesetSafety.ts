import { isAddress, zeroAddress } from 'viem'
import { tokenCurrencyId } from '@bananapus/nana-sdk-core/v6'
import {
  JB_CONTRACTS,
  NATIVE_TOKEN,
  USDC_ADDRESSES,
  type SupportedChainId,
} from '../constants'
import type { JBRulesetConfig } from '../services/relayr'
import type { JBSplitGroupData } from '../services/bendystraw'
import { assertSafeStoredSplitGroups } from './splitSafety'

const MAX_UINT224 = (1n << 224n) - 1n

export interface VerifiedAccountingContext {
  terminal: string
  token: string
  tokenDecimals: number
  currency: number
}

export function assertRecognizedAccountingContexts(
  chainId: number,
  contexts: VerifiedAccountingContext[],
): void {
  if (contexts.length === 0) throw new Error('No recognized accounting context is configured')
  const seen = new Set<string>()
  for (const [index, context] of contexts.entries()) {
    if (context.terminal.toLowerCase() !== JB_CONTRACTS.JBMultiTerminal.toLowerCase()) {
      throw new Error(`Accounting terminal not recognized: ${context.terminal}`)
    }
    const token = context.token.toLowerCase()
    const canonicalUsdc = USDC_ADDRESSES[chainId as SupportedChainId]?.toLowerCase()
    const isNative = token === NATIVE_TOKEN.toLowerCase()
    if (!isNative && (!canonicalUsdc || token !== canonicalUsdc)) {
      throw new Error(`Accounting token not recognized: ${context.token}`)
    }
    if (seen.has(token)) throw new Error(`Duplicate accounting context at index ${index}`)
    seen.add(token)
    const expectedDecimals = isNative ? 18 : 6
    const expectedCurrency = tokenCurrencyId(context.token as `0x${string}`)
    if (context.tokenDecimals !== expectedDecimals || context.currency !== expectedCurrency) {
      throw new Error(`Accounting context is not recognized for token: ${context.token}`)
    }
  }
}

function requireInteger(value: number, field: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`)
  }
}

export function assertRulesetConfigurationSafe(
  chainId: number,
  config: JBRulesetConfig,
  contexts: VerifiedAccountingContext[],
): void {
  assertRecognizedAccountingContexts(chainId, contexts)
  requireInteger(config.mustStartAtOrAfter, 'Ruleset start time', 0, 2 ** 48 - 1)
  if (config.mustStartAtOrAfter < Math.floor(Date.now() / 1000)) {
    throw new Error('Ruleset start time has passed; refresh before continuing')
  }
  requireInteger(config.duration, 'Ruleset duration', 0, 2 ** 32 - 1)
  requireInteger(config.weightCutPercent, 'Issuance decay', 0, 1_000_000_000)
  const weight = BigInt(config.weight)
  if (weight < 0n || weight >= 1n << 112n) throw new Error('Issuance weight exceeds uint112')
  requireInteger(config.metadata.reservedPercent, 'Reserved rate', 0, 10_000)
  requireInteger(config.metadata.cashOutTaxRate, 'Cash-out curve rate', 0, 10_000)
  requireInteger(config.metadata.baseCurrency, 'Base currency', 1, 2 ** 32 - 1)
  requireInteger(config.metadata.metadata, 'Ruleset metadata', 0, 0xffff)
  if (!isAddress(config.approvalHook)) throw new Error('Rule-change hook address is invalid')
  if (!isAddress(config.metadata.dataHook)) throw new Error('Data hook address is invalid')
  if (
    (config.metadata.useDataHookForPay || config.metadata.useDataHookForCashOut) &&
    config.metadata.dataHook.toLowerCase() === zeroAddress
  ) {
    throw new Error('A data hook is enabled but missing')
  }

  const contextsByToken = new Map(contexts.map(context => [context.token.toLowerCase(), context]))
  const acceptedCurrencies = new Set(contexts.map(context => context.currency))
  if (!acceptedCurrencies.has(config.metadata.baseCurrency)) {
    throw new Error('Base currency is not tied to a recognized live accounting token')
  }

  assertSafeStoredSplitGroups(config.splitGroups)
  const splitGroupIds = new Set<string>()
  for (const group of config.splitGroups) {
    const groupId = BigInt(group.groupId)
    const key = groupId.toString()
    if (splitGroupIds.has(key)) throw new Error('Duplicate split group')
    splitGroupIds.add(key)
    const isReserved = groupId === 1n
    const isPayout = contexts.some(context => BigInt(context.token) === groupId)
    if (!isReserved && !isPayout) throw new Error(`Split group is not tied to a live accounting token: ${key}`)
    if (group.splits.length === 0) throw new Error(`Split group ${key} is empty`)
    const total = group.splits.reduce((sum, split) => sum + split.percent, 0)
    if (total > 1_000_000_000) throw new Error(`Split group ${key} exceeds 100%`)
  }

  const fundTokens = new Set<string>()
  for (const group of config.fundAccessLimitGroups) {
    if (!isAddress(group.terminal) || !isAddress(group.token)) {
      throw new Error('Fund access configuration contains an invalid address')
    }
    const token = group.token.toLowerCase()
    const context = contextsByToken.get(token)
    if (!context || group.terminal.toLowerCase() !== context.terminal.toLowerCase()) {
      throw new Error('Fund access configuration is not tied to a recognized live accounting context')
    }
    if (fundTokens.has(token)) throw new Error('Duplicate fund access token')
    fundTokens.add(token)
    if (group.payoutLimits.length === 0 && group.surplusAllowances.length === 0) {
      throw new Error('Fund access group is empty')
    }
    for (const limit of [...group.payoutLimits, ...group.surplusAllowances]) {
      const amount = BigInt(limit.amount)
      if (amount <= 0n || amount > MAX_UINT224) throw new Error('Fund access amount is invalid')
      if (limit.currency !== context.currency) {
        throw new Error('Fund access currency conversion is not supported in this flow')
      }
    }
  }
}

function splitFingerprint(split: {
  percent: number
  projectId: number
  beneficiary: string
  preferAddToBalance: boolean
  lockedUntil: number
  hook: string
}): string {
  return [
    split.percent,
    split.projectId,
    split.beneficiary.toLowerCase(),
    split.preferAddToBalance,
    split.lockedUntil,
    split.hook.toLowerCase(),
  ].join(':')
}

export function assertPreservedSplitGroups(
  proposed: JBRulesetConfig['splitGroups'],
  current: JBSplitGroupData[],
): void {
  assertSafeStoredSplitGroups(proposed)
  assertSafeStoredSplitGroups(current)
  const proposedById = new Map(proposed.map(group => [String(group.groupId), group.splits]))
  const currentById = new Map(current.map(group => [String(group.groupId), group.splits]))
  if (proposedById.size !== proposed.length || currentById.size !== current.length) {
    throw new Error('Duplicate split group')
  }
  if (proposedById.size !== currentById.size) {
    throw new Error('Queued ruleset must preserve the latest split groups')
  }
  for (const [groupId, currentSplits] of currentById) {
    const proposedSplits = proposedById.get(groupId)
    if (!proposedSplits || proposedSplits.length !== currentSplits.length) {
      throw new Error('Queued ruleset must preserve the latest split groups')
    }
    for (let index = 0; index < currentSplits.length; index++) {
      if (splitFingerprint(proposedSplits[index]) !== splitFingerprint(currentSplits[index])) {
        throw new Error('Queued ruleset must preserve the latest split recipients')
      }
    }
  }
}
