const MAX_WEIGHT_CUT_PERCENT = 1_000_000_000
const MAX_WEIGHT_CUT_ITERATIONS = 20_000
const MAX_RESERVED_PERCENT = 10_000

export function deriveCycledWeight(
  baseWeight: string | bigint,
  weightCutPercent: number,
  cycles: number,
): bigint {
  const weightText = String(baseWeight)
  if (!/^\d+$/.test(weightText)
    || !Number.isSafeInteger(weightCutPercent)
    || weightCutPercent < 0
    || weightCutPercent > MAX_WEIGHT_CUT_PERCENT
    || !Number.isSafeInteger(cycles)
    || cycles < 0
    || cycles > MAX_WEIGHT_CUT_ITERATIONS) {
    throw new Error('Ruleset weight configuration is invalid')
  }

  let weight = BigInt(weightText)
  const cutFactor = BigInt(MAX_WEIGHT_CUT_PERCENT - weightCutPercent)
  for (let i = 0; i < cycles && weight > 0n; i++) {
    weight = (weight * cutFactor) / BigInt(MAX_WEIGHT_CUT_PERCENT)
  }
  return weight
}

export function issuancePriceFromWeight(weight: bigint): number | undefined {
  if (weight <= 0n) return undefined
  const tokensPerUnit = Number(weight) / 1e18
  return Number.isFinite(tokensPerUnit) && tokensPerUnit > 0 ? 1 / tokensPerUnit : undefined
}

export function calculatePayerTokenCount(
  paymentAmount: bigint,
  paymentDecimals: number,
  weight: bigint,
  reservedPercent: number,
): bigint {
  if (paymentAmount < 0n || weight < 0n
    || !Number.isSafeInteger(paymentDecimals) || paymentDecimals < 0 || paymentDecimals > 255
    || !Number.isSafeInteger(reservedPercent) || reservedPercent < 0 || reservedPercent > MAX_RESERVED_PERCENT) {
    throw new Error('Payment issuance configuration is invalid')
  }
  const totalTokenCount = paymentAmount * weight / (10n ** BigInt(paymentDecimals))
  return totalTokenCount * BigInt(MAX_RESERVED_PERCENT - reservedPercent) /
    BigInt(MAX_RESERVED_PERCENT)
}
