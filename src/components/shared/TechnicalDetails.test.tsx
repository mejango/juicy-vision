/**
 * The parameters tree must render `weight` in the denomination of ITS
 * ruleset's metadata.baseCurrency — never a hardcoded tokens/USD.
 */
import type { ComponentProps } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { chainMarks } from '../../test/test-utils'
import TechnicalDetails from './TechnicalDetails'

function renderDetails(
  parameters: Record<string, unknown>,
  extra: Partial<ComponentProps<typeof TechnicalDetails>> = {},
) {
  return render(
    <TechnicalDetails
      contract="JB_CONTROLLER"
      contractAddress="0x1111111111111111111111111111111111111111"
      functionName="launchProjectFor"
      chainId={11155111}
      parameters={parameters}
      isDark
      defaultExpanded
      {...extra}
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

describe('TechnicalDetails chain marks', () => {
  it('shows the chain logo beside the single-chain badge', () => {
    renderDetails({ weight: WEIGHT })
    expect(chainMarks()).toHaveLength(1)
  })

  it('shows a chain logo beside every badge in the multi-chain list', () => {
    renderDetails({ weight: WEIGHT }, {
      allChains: [
        { chainId: 11155111, chainName: 'Sepolia' },
        { chainId: 11155420, chainName: 'OP Sepolia' },
        { chainId: 84532, chainName: 'Base Sepolia' },
      ],
    })
    expect(chainMarks()).toHaveLength(3)
  })
})
