import { parseEther } from 'viem'
import type { REVStageConfig } from '../services/relayr'

interface RevnetStageInput {
  startsAtOrAfter: string
  splitPercent: string
  initialIssuance: string
  decayFrequency: string
  decayPercent: string
  cashOutTaxRate: string
}

const UINT112_MAX = (1n << 112n) - 1n
const UINT32_MAX = 2 ** 32 - 1
const UINT48_MAX = 2 ** 48 - 1
const SECONDS_PER_DAY = 86_400
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/

function decimalValue(value: string): number | null {
  const normalized = value.trim()
  if (!DECIMAL_PATTERN.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function revnetStageError(stage: RevnetStageInput, index: number): string | null {
  const label = `Stage ${index + 1}`
  const delayDays = decimalValue(stage.startsAtOrAfter)
  if (delayDays === null || delayDays < 0) return `${label} has an invalid start delay`
  if (index > 0 && Math.floor(delayDays * SECONDS_PER_DAY) <= 0) {
    return `${label} must start after the previous stage`
  }

  const splitPercent = decimalValue(stage.splitPercent)
  if (splitPercent === null || splitPercent < 0 || splitPercent > 100) {
    return `${label} has an invalid operator split`
  }

  try {
    const issuance = parseEther(stage.initialIssuance.trim())
    if (issuance < 0n || issuance > UINT112_MAX) return `${label} has an invalid issuance rate`
  } catch {
    return `${label} has an invalid issuance rate`
  }

  const decayDays = decimalValue(stage.decayFrequency)
  const decaySeconds = decayDays === null ? -1 : Math.floor(decayDays * SECONDS_PER_DAY)
  if (decaySeconds < SECONDS_PER_DAY || decaySeconds > UINT32_MAX) {
    return `${label} decay frequency must be between 1 and ${Math.floor(UINT32_MAX / SECONDS_PER_DAY)} days`
  }

  const decayPercent = decimalValue(stage.decayPercent)
  if (decayPercent === null || decayPercent < 0 || decayPercent > 100) {
    return `${label} has an invalid issuance decay`
  }

  const cashOutTaxRate = decimalValue(stage.cashOutTaxRate)
  if (cashOutTaxRate === null || cashOutTaxRate < 0 || cashOutTaxRate >= 100) {
    return `${label} cash-out tax must be below 100%`
  }

  return null
}

export function buildRevnetStageConfigurations(
  stages: readonly RevnetStageInput[],
  synchronizedStartTime: number,
): REVStageConfig[] {
  let previousStart = synchronizedStartTime

  return stages.map((stage, index) => {
    const error = revnetStageError(stage, index)
    if (error) throw new Error(error)

    const delaySeconds = Math.floor(Number(stage.startsAtOrAfter) * SECONDS_PER_DAY)
    const startsAtOrAfter = previousStart + delaySeconds
    if (!Number.isSafeInteger(startsAtOrAfter) || startsAtOrAfter > UINT48_MAX) {
      throw new Error(`Stage ${index + 1} starts too far in the future`)
    }
    previousStart = startsAtOrAfter

    return {
      startsAtOrAfter,
      splitPercent: Math.floor(Number(stage.splitPercent) * 100),
      initialIssuance: parseEther(stage.initialIssuance.trim()).toString(),
      issuanceCutFrequency: Math.floor(Number(stage.decayFrequency) * SECONDS_PER_DAY),
      issuanceCutPercent: Math.floor(Number(stage.decayPercent) * 10_000_000),
      cashOutTaxRate: Math.floor(Number(stage.cashOutTaxRate) * 100),
      extraMetadata: 0,
    }
  })
}
