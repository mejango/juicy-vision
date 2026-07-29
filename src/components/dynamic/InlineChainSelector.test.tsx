import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import InlineChainSelector from './InlineChainSelector'
import { chainMarks, chainMarksFor } from '../../test/test-utils'

const options = [
  { key: 1, chainId: 1, selected: true },
  { key: 8453, chainId: 8453, selected: false },
]

describe('InlineChainSelector', () => {
  it('shows a chain logo beside every pill in the compact variant', () => {
    render(<InlineChainSelector options={options} onSelect={vi.fn()} isDark />)
    expect(chainMarksFor(1)).not.toHaveLength(0)
    expect(chainMarksFor(8453)).not.toHaveLength(0)
  })

  it('shows a chain logo beside every pill in the row variant', () => {
    render(<InlineChainSelector options={options} onSelect={vi.fn()} isDark variant="row" />)
    expect(chainMarksFor(1)).not.toHaveLength(0)
    expect(chainMarksFor(8453)).not.toHaveLength(0)
  })

  it('keeps the chain name visible alongside the logo', () => {
    render(<InlineChainSelector options={options} onSelect={vi.fn()} isDark />)
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveTextContent('ETH')
    expect(buttons[1]).toHaveTextContent('BASE')
  })

  it('falls back to the plain label when the chain is unknown', () => {
    render(
      <InlineChainSelector
        options={[
          { key: 'a', chainId: 999999, selected: true },
          { key: 'b', chainId: 1, selected: false },
        ]}
        onSelect={vi.fn()}
        isDark
      />,
    )
    expect(chainMarks()).toHaveLength(1)
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('999999')
  })
})
