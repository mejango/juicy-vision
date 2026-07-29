import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as bendystraw from '../../services/bendystraw'
import { requireRecognizedRuntimeSplitHook } from '../../utils/projectTrust'
import { ProjectSplitRoute } from './ProjectSplitRoute'
import { chainMarks } from '../../test/test-utils'

vi.mock('../../services/bendystraw', () => ({
  fetchProject: vi.fn(),
  fetchConnectedChains: vi.fn(),
}))
vi.mock('../../utils/transactionSafety', () => ({
  getSafetyPublicClient: vi.fn(() => ({})),
}))
vi.mock('../../utils/projectTrust', () => ({
  requireRecognizedRuntimeSplitHook: vi.fn(),
}))

describe('ProjectSplitRoute', () => {
  beforeEach(() => {
    vi.mocked(bendystraw.fetchProject).mockResolvedValue({
      projectId: 8,
      chainId: 84532,
      name: 'Test PPN',
    } as never)
    vi.mocked(bendystraw.fetchConnectedChains).mockResolvedValue([
      { chainId: 84532, projectId: 8 },
      { chainId: 11155111, projectId: 42 },
    ])
    vi.mocked(requireRecognizedRuntimeSplitHook).mockResolvedValue(undefined)
  })

  it('shows the indexed destination name, exact route, zero beneficiary, and sucker mapping', async () => {
    render(
      <ProjectSplitRoute
        projectId={8}
        chainId={84532}
        beneficiary="0x0000000000000000000000000000000000000000"
        kind="payout"
        isDark={false}
      />,
    )

    await waitFor(() => expect(screen.getByText('Test PPN · #8')).toBeInTheDocument())
    expect(screen.getByText('pay project')).toBeInTheDocument()
    expect(screen.getByText('Tokens: distribution caller')).toBeInTheDocument()
    // The chain's brand mark is decorative, so the link announces only the
    // visible name — not the chain twice.
    const mapped = screen.getByRole('link', { name: 'Sepolia · #42' })
    expect(mapped).toHaveAttribute('href', '/sep:42')
    expect(chainMarks().length).toBeGreaterThan(0)
  })

  it('labels add-to-balance routes as minting no destination tokens', async () => {
    render(
      <ProjectSplitRoute
        projectId={8}
        chainId={84532}
        beneficiary="0x0000000000000000000000000000000000000000"
        kind="payout"
        preferAddToBalance
        isDark
      />,
    )

    expect(screen.getByText('add to balance · no tokens minted')).toBeInTheDocument()
    expect(screen.getByText('No destination tokens minted')).toBeInTheDocument()
    await waitFor(() => expect(bendystraw.fetchConnectedChains).toHaveBeenCalled())
  })

  it('labels a split hook only after live provenance succeeds', async () => {
    render(
      <ProjectSplitRoute
        projectId={8}
        chainId={84532}
        beneficiary="0x1111111111111111111111111111111111111111"
        kind="payout"
        hook="0x2222222222222222222222222222222222222222"
        isDark={false}
      />,
    )

    await waitFor(() => expect(screen.getByText(/Recognized split hook · 0x2222/)).toBeInTheDocument())
    expect(requireRecognizedRuntimeSplitHook).toHaveBeenCalled()
  })

  it('warns after registry provenance fails', async () => {
    vi.mocked(requireRecognizedRuntimeSplitHook).mockRejectedValueOnce(new Error('unknown deployer'))
    render(
      <ProjectSplitRoute
        projectId={8}
        chainId={84532}
        beneficiary="0x1111111111111111111111111111111111111111"
        kind="reserved"
        hook="0x3333333333333333333333333333333333333333"
        isDark
      />,
    )

    await waitFor(() => expect(screen.getByText(/Unrecognized split hook · 0x3333/)).toBeInTheDocument())
    expect(screen.getByText('split hook not recognized')).toBeInTheDocument()
  })
})
