import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import TokensTab from './TokensTab'

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined, isConnected: false }),
}))

vi.mock('../../services/bendystraw', () => ({
  fetchProject: vi.fn(async () => ({ projectId: 10, name: 'Test Project', owner: '0x1', metadataUri: null })),
  fetchProjectWithRuleset: vi.fn(async () => ({ projectId: 10, rulesets: [] })),
  fetchProjectTokenSymbol: vi.fn(async () => null),
  fetchProjectTokenAddress: vi.fn(async () => null),
  fetchProjectTokenSupply: vi.fn(async () => '0'),
  fetchProjectSplits: vi.fn(async () => []),
  fetchPendingReservedTokens: vi.fn(async () => '5000000000000000000'),
  fetchUserTokenBalance: vi.fn(async () => null),
  isRevnetProject: vi.fn(() => false),
}))

vi.mock('../../utils/projectChains', () => ({
  resolveProjectChains: vi.fn(async () => ({
    chains: [{ chainId: 84532, projectId: 10 }],
    mappingAvailable: true,
  })),
}))

vi.mock('../../utils/ens', () => ({
  resolveEnsName: vi.fn(async () => null),
  truncateAddress: (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`,
}))

vi.mock('./charts/HoldersChart', () => ({ default: () => null }))
vi.mock('./PriceChart', () => ({ default: () => null }))
vi.mock('./SendReservedTokensForm', () => ({ default: () => null }))

describe('TokensTab without a deployed ERC-20', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows project credits instead of a placeholder symbol and explains cash-out stays available', async () => {
    render(<TokensTab projectId="10" chainId="84532" />)

    await waitFor(() => {
      expect(screen.getByText('Project credits')).toBeInTheDocument()
    })
    expect(screen.queryByText('TOKEN')).not.toBeInTheDocument()
    expect(screen.getByText(/No ERC-20 yet/)).toBeInTheDocument()
    expect(screen.getByText(/can still be cashed out/)).toBeInTheDocument()
  })

  it('shows the Deploy ERC-20 action only for the owner', async () => {
    const onDeployErc20 = vi.fn()
    const { unmount } = render(
      <TokensTab projectId="10" chainId="84532" isOwner onDeployErc20={onDeployErc20} />,
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Deploy ERC-20' })).toBeInTheDocument()
    })
    screen.getByRole('button', { name: 'Deploy ERC-20' }).click()
    expect(onDeployErc20).toHaveBeenCalled()
    unmount()

    render(<TokensTab projectId="10" chainId="84532" isOwner={false} onDeployErc20={onDeployErc20} />)
    await waitFor(() => {
      expect(screen.getByText(/No ERC-20 yet/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Deploy ERC-20' })).not.toBeInTheDocument()
  })

  it('labels pending reserved amounts as credits when no ERC-20 exists', async () => {
    render(<TokensTab projectId="10" chainId="84532" />)
    await waitFor(() => {
      expect(screen.getByText(/ready to distribute/)).toBeInTheDocument()
    })
    expect(screen.getByText(/5 credits/)).toBeInTheDocument()
  })
})
