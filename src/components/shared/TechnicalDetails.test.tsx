/**
 * The parameters tree must render `weight` in the denomination of ITS
 * ruleset's metadata.baseCurrency — never a hardcoded tokens/USD.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TechnicalDetails from './TechnicalDetails'

function renderDetails(parameters: Record<string, unknown>) {
  return render(
    <TechnicalDetails
      contract="JB_CONTROLLER"
      contractAddress="0x1111111111111111111111111111111111111111"
      functionName="launchProjectFor"
      chainId={11155111}
      parameters={parameters}
      isDark
      defaultExpanded
    />,
  )
}

const WEIGHT = '1000000000000000000000000' // 1M tokens/unit

describe('TechnicalDetails weight denomination', () => {
  it('renders tokens/ETH for a base-ETH ruleset (default launch)', () => {
    renderDetails({
      rulesetConfiguration: { weight: WEIGHT, metadata: { baseCurrency: 1 } },
    })
    expect(screen.getByText('1.0M tokens/ETH')).toBeInTheDocument()
    expect(screen.queryByText('1.0M tokens/USD')).toBeNull()
  })

  it('renders tokens/USD only when the ruleset metadata says base USD', () => {
    renderDetails({
      rulesetConfiguration: { weight: WEIGHT, metadata: { baseCurrency: 2 } },
    })
    expect(screen.getByText('1.0M tokens/USD')).toBeInTheDocument()
  })

  it('defaults to tokens/ETH when no baseCurrency exists in the tree', () => {
    renderDetails({ weight: WEIGHT })
    expect(screen.getByText('1.0M tokens/ETH')).toBeInTheDocument()
  })
})
