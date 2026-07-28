/**
 * The summary's volume line must use the indexer's time-of-payment USD total
 * when it is available — multiplying total native volume by TODAY'S ETH spot
 * price misstates what the project actually processed.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProjectSummary from './ProjectSummary'

const ONE_ETH = '1000000000000000000' // 1e18

function renderSummary(props: Partial<React.ComponentProps<typeof ProjectSummary>> = {}) {
  return render(
    <ProjectSummary
      projectName="Test Project"
      balance="0"
      volume={ONE_ETH}
      paymentsCount={12}
      ethPrice={4000}
      {...props}
    />,
  )
}

describe('ProjectSummary volume pricing', () => {
  it('prices volume from time-of-payment volumeUsd, not volume × spot', () => {
    // 1 ETH volume, spot $4,000 — but the payments happened at ~$2,500.
    renderSummary({ volumeUsd: '2500000000000000000000' /* $2,500 × 1e18 */ })
    const text = screen.getByText(/total volume/).textContent ?? ''
    expect(text).toContain('$2.50K')
    expect(text).not.toContain('$4.00K')
  })

  it('falls back to spot conversion when volumeUsd is unavailable', () => {
    renderSummary()
    const text = screen.getByText(/total volume/).textContent ?? ''
    expect(text).toContain('$4.00K')
  })

  it('ignores an unparseable volumeUsd instead of rendering garbage', () => {
    renderSummary({ volumeUsd: 'not-a-number' })
    const text = screen.getByText(/total volume/).textContent ?? ''
    expect(text).toContain('$4.00K')
  })
})
