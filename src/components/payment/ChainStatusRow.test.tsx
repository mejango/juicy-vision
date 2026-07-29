import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { chainMarksFor } from '../../test/test-utils'
import ChainStatusRow from './ChainStatusRow'

describe('ChainStatusRow', () => {
  it('shows the chain logo beside the chain name', () => {
    render(<ChainStatusRow chainId={10} status="pending" isDark accent="purple" />)
    expect(chainMarksFor(10)).toHaveLength(1)
    expect(screen.getByText('Optimism')).toBeInTheDocument()
  })

  it('still names an unknown chain when there is no logo for it', () => {
    render(<ChainStatusRow chainId={999999} status="pending" isDark accent="green" />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Chain 999999')).toBeInTheDocument()
  })
})
