// Anchor the price chart's Y domain to the issuance series so late-arriving
// overlay series (pool, cash-out) can't rescale the axis and flatten the
// issuance step schedule. Overlay values above the domain clip at the chart
// edge via `allowDataOverflow`.
export function issuancePriceDomain(
  prices: Array<number | null | undefined>,
): [number, number] | ['auto', 'auto'] {
  let max = 0
  for (const price of prices) {
    if (typeof price === 'number' && Number.isFinite(price) && price > max) {
      max = price
    }
  }
  return max > 0 ? [0, max * 1.05] : ['auto', 'auto']
}
