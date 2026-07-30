import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTransactionStore } from '../stores/transactionStore'
import { useViewAsStore } from '../stores/viewAsStore'
import AccountView from './AccountView'

const OWNER = '0x1111111111111111111111111111111111111111'
const OTHER = '0x2222222222222222222222222222222222222222'
const SAFE = '0x3333333333333333333333333333333333333333'
const CONFIRMED_HASH = '0xAbCdef0000000000000000000000000000000000000000000000000000000001'

const {
  navigateMock,
  accountState,
  relayrStatusMock,
  fetchAccountActivityEvents,
  fetchAccountOperatedPermissions,
  fetchAccountTokenHoldings,
  fetchAccountNftHoldings,
  fetchProjectsByOwner,
  getSafesByOwner,
  fetchSafeInfo,
  resolveProjectNameForDisplay,
  fetchProjectTokenSymbol,
  resolveShopItemMedia,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  accountState: { address: undefined as string | undefined },
  relayrStatusMock: vi.fn((_options: unknown) => ({
    data: null,
    isPolling: false,
    error: null,
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    refetch: vi.fn(),
  })),
  fetchAccountActivityEvents: vi.fn(),
  fetchAccountOperatedPermissions: vi.fn(),
  fetchAccountTokenHoldings: vi.fn(),
  fetchAccountNftHoldings: vi.fn(),
  fetchProjectsByOwner: vi.fn(),
  getSafesByOwner: vi.fn(),
  fetchSafeInfo: vi.fn(),
  resolveProjectNameForDisplay: vi.fn(),
  fetchProjectTokenSymbol: vi.fn(),
  resolveShopItemMedia: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback || _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: accountState.address, isConnected: !!accountState.address }),
}))

vi.mock('../stores', () => ({
  useThemeStore: () => ({ theme: 'dark' }),
}))

vi.mock('../hooks', async () => {
  const { useViewAsStore: viewAsStore } = await import('../stores/viewAsStore')
  return {
    useEnsNameResolved: () => ({ ensName: 'jango.eth', loading: false }),
    // Mirrors the real hook against the real view-as store while keeping the
    // heavy hooks barrel (wagmi executor, managed wallet, …) out of the test.
    useViewedAccount: () => {
      const viewAs = viewAsStore(s => s.viewAs)
      return {
        address: viewAs ?? accountState.address,
        connectedAddress: accountState.address,
        isViewAs: viewAs !== null,
      }
    },
  }
})

vi.mock('../hooks/relayr', () => ({
  useRelayrStatus: (options: unknown) => relayrStatusMock(options),
}))

vi.mock('../components/wallet/useAllChainBalances', () => ({
  useAllChainBalances: () => ({
    balances: [{ chainId: 1, chainName: 'ETH', eth: '1.5', usdc: '250' }],
    loading: false,
  }),
}))

vi.mock('../components/chat/ActivityItem', () => ({
  default: ({
    event,
    onProjectClick,
  }: {
    event: { id: string }
    onProjectClick?: (query: string) => void
  }) => (
    <div data-testid="activity-item" onClick={() => onProjectClick?.('query')}>
      {event.id}
    </div>
  ),
}))

vi.mock('../components/ui/IpfsMedia', () => ({
  IpfsImage: () => <span data-testid="ipfs-image" />,
}))

vi.mock('../services/bendystraw', async () => {
  // The grouping helpers are pure — use the real ones so the view is tested
  // against the real per-project/per-tier shaping.
  const holdings = await import('../services/bendystraw/accountHoldings')
  return {
    fetchAccountActivityEvents,
    fetchAccountOperatedPermissions,
    fetchAccountTokenHoldings,
    fetchAccountNftHoldings,
    fetchProjectsByOwner,
    groupTokenHoldings: holdings.groupTokenHoldings,
    groupNftHoldings: holdings.groupNftHoldings,
  }
})

vi.mock('../services/bendystraw/client', () => ({
  resolveProjectNameForDisplay,
  fetchProjectTokenSymbol,
}))

vi.mock('../services/shopCustomers', () => ({
  resolveShopItemMedia,
  itemLabelFrom: (
    names: Record<number, string> | null | undefined,
    tierId: number | string
  ) => (names && names[Number(tierId)]) || `Item #${tierId}`,
}))

vi.mock('../services/safeInfo', () => ({
  fetchSafeInfo,
}))

vi.mock('../services/safe/safeTxService', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/safe/safeTxService')>()),
  getSafesByOwner,
}))

vi.mock('../utils/ens', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/ens')>()),
  resolveEnsToAddress: vi.fn(),
}))

function seedData() {
  fetchAccountActivityEvents.mockResolvedValue({
    events: [
      {
        id: 'evt-1',
        chainId: 1,
        timestamp: 1700000000,
        type: 'pay',
        amount: '1000000000000000000',
        from: OWNER,
        txHash: CONFIRMED_HASH,
        project: { projectId: 3, name: 'NANA', decimals: 18, currency: 1 },
      },
    ],
    fromCount: 1,
  })
  fetchProjectsByOwner.mockImplementation(async (address: string) => {
    if (address.toLowerCase() === OWNER.toLowerCase()) {
      return [
        {
          id: '1-4',
          projectId: 4,
          chainId: 1,
          version: 6,
          owner: OWNER,
          name: 'Direct Project',
          volume: '0',
          balance: '0',
          paymentsCount: 0,
          createdAt: 1,
        },
      ]
    }
    if (address.toLowerCase() === SAFE.toLowerCase()) {
      return [
        {
          id: '1-9',
          projectId: 9,
          chainId: 1,
          version: 6,
          owner: SAFE,
          name: 'Safe Project',
          volume: '0',
          balance: '0',
          paymentsCount: 0,
          createdAt: 2,
        },
      ]
    }
    return []
  })
  getSafesByOwner.mockImplementation(async (_address: string, chainId: number) =>
    chainId === 1 ? [SAFE] : []
  )
  fetchSafeInfo.mockResolvedValue({
    isSafe: true,
    threshold: 2,
    owners: [OWNER, OTHER, SAFE],
    deployed: true,
  })
  fetchAccountOperatedPermissions.mockResolvedValue([
    {
      chainId: 1,
      projectId: 5,
      account: OTHER,
      operator: OWNER,
      permissions: [2, 3],
      isRevnetOperator: true,
    },
  ])
  resolveProjectNameForDisplay.mockImplementation(async (projectId: number) => {
    if (projectId === 3) return 'NANA Project'
    if (projectId === 4) return 'Shop Project'
    if (projectId === 5) return 'Operated Revnet'
    return null
  })
  // Holdings: project 3's token held on two chains linked by a sucker group
  // (already deduped by the fetcher), plus two tier-1 items of project 4's
  // shop. The fetchers return pages carrying the server totalCount.
  fetchAccountTokenHoldings.mockResolvedValue({
    rows: [
      { chainId: 1, projectId: 3, version: 6, balance: '2000000000000000000', suckerGroupId: 'g3' },
      { chainId: 8453, projectId: 3, version: 6, balance: '1000000000000000000', suckerGroupId: 'g3' },
    ],
    totalCount: 2,
    truncated: false,
  })
  fetchAccountNftHoldings.mockResolvedValue({
    rows: [
      { chainId: 1, projectId: 4, hook: '0xhook4', tokenId: '1000000001', tierId: 1 },
      { chainId: 1, projectId: 4, hook: '0xhook4', tokenId: '1000000002', tierId: 1 },
    ],
    totalCount: 2,
    truncated: false,
  })
  fetchProjectTokenSymbol.mockResolvedValue('NANA')
  resolveShopItemMedia.mockResolvedValue({
    names: { 1: 'Cap' },
    media: { 1: { name: 'Cap', imageUri: 'ipfs://cap' } },
  })
}

describe('AccountView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedData()
    accountState.address = undefined
    useTransactionStore.setState({ transactions: [] })
    useViewAsStore.setState({ viewAs: null })
    // Tab choice is persisted in the location hash — reset between tests.
    window.history.replaceState(null, '', '/')
  })

  it('renders identity, balances and the Activity tab by default; owned and operated projects live behind Projects and Roles', async () => {
    render(<AccountView address={OWNER} />)

    expect(await screen.findByRole('heading', { name: 'jango.eth' })).toBeInTheDocument()
    expect(screen.getByText('1.5000 ETH')).toBeInTheDocument()
    expect(screen.getByText('250.00 USDC')).toBeInTheDocument()

    expect(await screen.findByTestId('activity-item')).toHaveTextContent('evt-1')

    // The other panels are not mounted while Activity is active.
    expect(screen.queryByText('Direct Project')).not.toBeInTheDocument()
    expect(screen.queryByText('Operated Revnet')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Projects' }))
    expect(await screen.findByText('Direct Project')).toBeInTheDocument()
    expect(screen.getByText('Safe Project')).toBeInTheDocument()
    expect(screen.getByText(/via Safe 0x3333.*\(2\/3\)/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Roles' }))
    expect(await screen.findByText('Operated Revnet')).toBeInTheDocument()
    expect(screen.getByText('Revnet operator')).toBeInTheDocument()

    expect(fetchAccountActivityEvents).toHaveBeenCalledWith(OWNER, { limit: 25, offset: 0 })
    expect(fetchAccountOperatedPermissions).toHaveBeenCalledWith(OWNER)
  })

  it('shows grouped token and store-item holdings on the Holdings tab and writes the tab to the hash', async () => {
    render(<AccountView address={OWNER} />)
    await screen.findByTestId('activity-item')

    fireEvent.click(screen.getByRole('button', { name: 'Holdings' }))
    expect(window.location.hash).toBe('#holdings')

    // One row for project 3 across both chains, with per-chain balances.
    const tokenRows = await screen.findAllByTestId('token-holding')
    expect(tokenRows).toHaveLength(1)
    expect(tokenRows[0]).toHaveTextContent('NANA Project')
    expect(tokenRows[0]).toHaveTextContent('2 NANA')
    expect(tokenRows[0]).toHaveTextContent('1 NANA')
    expect(fetchAccountTokenHoldings).toHaveBeenCalledWith(OWNER)

    // The two owned tier-1 items tally into one labeled line.
    const itemRows = await screen.findAllByTestId('item-holding')
    expect(itemRows).toHaveLength(1)
    expect(itemRows[0]).toHaveTextContent('Shop Project')
    expect(itemRows[0]).toHaveTextContent('Cap (2)')
    expect(fetchAccountNftHoldings).toHaveBeenCalledWith(OWNER)

    // The row navigates to the project (home chain).
    fireEvent.click(tokenRows[0])
    expect(navigateMock).toHaveBeenCalledWith('/eth:3')
  })

  it('opens the tab named by the URL hash on load', async () => {
    window.history.replaceState(null, '', '#holdings')
    render(<AccountView address={OWNER} />)
    expect(await screen.findByText('Store items')).toBeInTheDocument()
    expect(screen.queryByTestId('activity-item')).not.toBeInTheDocument()
  })

  it('shows the empty state when the account holds nothing', async () => {
    fetchAccountTokenHoldings.mockResolvedValue({ rows: [], totalCount: 0, truncated: false })
    fetchAccountNftHoldings.mockResolvedValue({ rows: [], totalCount: 0, truncated: false })
    render(<AccountView address={OWNER} />)
    fireEvent.click(screen.getByRole('button', { name: 'Holdings' }))
    expect(await screen.findByText('No project tokens held')).toBeInTheDocument()
    expect(await screen.findByText('No store items held')).toBeInTheDocument()
  })

  it('navigates to the project page when an activity row is clicked', async () => {
    render(<AccountView address={OWNER} />)
    fireEvent.click(await screen.findByTestId('activity-item'))
    expect(navigateMock).toHaveBeenCalledWith('/eth:3')
  })

  it('shows in-flight transactions only for the viewer own account, deduped by confirmed hash, with a Relayr retry', async () => {
    accountState.address = OWNER
    useTransactionStore.setState({
      transactions: [
        {
          id: 'tx-relayr',
          type: 'launchProject',
          chainId: 1,
          account: OWNER,
          status: 'relayr-pending',
          bundleUuid: 'bundle-1',
          chainStates: [{ chainId: 1, status: 'submitted' }],
          createdAt: 1,
          updatedAt: 1,
        },
        {
          // Already confirmed on-chain per the indexed feed - must be hidden.
          id: 'tx-dupe',
          type: 'pay',
          chainId: 1,
          account: OWNER,
          status: 'submitted',
          hash: CONFIRMED_HASH.toLowerCase(),
          createdAt: 2,
          updatedAt: 2,
        },
        {
          // Someone else's transaction - must be hidden.
          id: 'tx-other',
          type: 'pay',
          chainId: 1,
          account: OTHER,
          status: 'pending',
          createdAt: 3,
          updatedAt: 3,
        },
      ],
    })

    render(<AccountView address={OWNER} />)

    await screen.findByTestId('activity-item')
    await waitFor(() => expect(screen.getAllByTestId('in-flight-tx')).toHaveLength(1))
    expect(screen.getByText('launchProject')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(relayrStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ bundleId: 'bundle-1', enabled: true })
    )
  })

  it('hides the in-flight layer when viewing someone else account', async () => {
    accountState.address = OTHER
    useTransactionStore.setState({
      transactions: [
        {
          id: 'tx-relayr',
          type: 'launchProject',
          chainId: 1,
          account: OWNER,
          status: 'relayr-pending',
          bundleUuid: 'bundle-1',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    render(<AccountView address={OWNER} />)
    await screen.findByTestId('activity-item')
    expect(screen.queryByTestId('in-flight-tx')).not.toBeInTheDocument()
  })

  it('activates site-wide view-as from the button and reflects the active state', async () => {
    render(<AccountView address={OWNER} />)
    fireEvent.click(screen.getByRole('button', { name: 'View site as this account' }))
    expect(useViewAsStore.getState().viewAs).toBe(OWNER)
    expect(
      await screen.findByRole('button', { name: 'Viewing site as this account' })
    ).toBeDisabled()
  })

  it('keeps the in-flight layer keyed to the CONNECTED account while impersonating', async () => {
    accountState.address = OTHER
    useViewAsStore.setState({ viewAs: OWNER })
    useTransactionStore.setState({
      transactions: [
        {
          id: 'tx-owner',
          type: 'pay',
          chainId: 1,
          account: OWNER,
          status: 'pending',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    render(<AccountView address={OWNER} />)
    await screen.findByTestId('activity-item')
    // The "your account" badge follows the VIEWED address…
    expect(screen.getByText('This is your connected account')).toBeInTheDocument()
    // …but the local in-flight store stays keyed to the real connection.
    expect(screen.queryByTestId('in-flight-tx')).not.toBeInTheDocument()
  })

  it('pages Load more through the globally sorted sender and beneficiary feed', async () => {
    // The service globally sorts every sender/beneficiary root before returning
    // a 25-row window, so the component advances by the visible row count.
    const fromEvents = Array.from({ length: 25 }, (_, i) => ({
      id: `from-${i}`,
      chainId: 1,
      timestamp: 1700001000 - i,
      type: 'pay',
      amount: '1',
      from: OWNER,
      project: { projectId: 3, name: 'NANA', decimals: 18, currency: 1 },
    }))
    const beneficiaryEvents = Array.from({ length: 5 }, (_, i) => ({
      id: `ben-${i}`,
      chainId: 1,
      timestamp: 1700002000 - i,
      type: 'pay',
      amount: '1',
      from: OTHER,
      project: { projectId: 3, name: 'NANA', decimals: 18, currency: 1 },
    }))
    fetchAccountActivityEvents.mockResolvedValueOnce({
      events: [...beneficiaryEvents, ...fromEvents].slice(0, 25),
      totalCount: 31,
    })
    fetchAccountActivityEvents.mockResolvedValueOnce({
      events: [
        {
          id: 'from-25',
          chainId: 1,
          timestamp: 1700000000,
          type: 'pay',
          amount: '1',
          from: OWNER,
          project: { projectId: 3, name: 'NANA', decimals: 18, currency: 1 },
        },
      ],
      totalCount: 31,
    })

    render(<AccountView address={OWNER} />)
    expect(await screen.findAllByTestId('activity-item')).toHaveLength(25)

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() =>
      expect(fetchAccountActivityEvents).toHaveBeenLastCalledWith(OWNER, {
        limit: 25,
        offset: 25,
      })
    )
    expect(await screen.findAllByTestId('activity-item')).toHaveLength(26)
  })

  it('shows the credit/ERC-20 split alongside a holding total', async () => {
    fetchAccountTokenHoldings.mockResolvedValue({
      rows: [
        {
          chainId: 1,
          projectId: 3,
          version: 6,
          balance: '2000000000000000000',
          creditBalance: '500000000000000000',
          erc20Balance: '1500000000000000000',
          suckerGroupId: 'g3',
        },
      ],
      totalCount: 1,
      truncated: false,
    })
    render(<AccountView address={OWNER} />)
    fireEvent.click(screen.getByRole('button', { name: 'Holdings' }))

    const tokenRows = await screen.findAllByTestId('token-holding')
    expect(tokenRows[0]).toHaveTextContent('2 NANA')
    expect(tokenRows[0]).toHaveTextContent('1.5 claimed')
    expect(tokenRows[0]).toHaveTextContent('0.5 credits')
  })

  it('surfaces truncation when the server holds more rows than the window returned', async () => {
    fetchAccountTokenHoldings.mockResolvedValue({
      rows: [
        { chainId: 1, projectId: 3, version: 6, balance: '2000000000000000000', suckerGroupId: 'g3' },
      ],
      totalCount: 1234,
      truncated: true,
    })
    render(<AccountView address={OWNER} />)
    fireEvent.click(screen.getByRole('button', { name: 'Holdings' }))

    const notice = await screen.findByTestId('token-holdings-truncated')
    expect(notice).toHaveTextContent('Showing first 1 of 1234')
  })

  it('keeps sucker-group rows together even when per-chain projectIds diverge', async () => {
    fetchAccountTokenHoldings.mockResolvedValue({
      rows: [
        { chainId: 1, projectId: 3, version: 6, balance: '2000000000000000000', suckerGroupId: 'g3' },
        { chainId: 8453, projectId: 12, version: 6, balance: '1000000000000000000', suckerGroupId: 'g3' },
      ],
      totalCount: 2,
      truncated: false,
    })
    render(<AccountView address={OWNER} />)
    fireEvent.click(screen.getByRole('button', { name: 'Holdings' }))

    const tokenRows = await screen.findAllByTestId('token-holding')
    expect(tokenRows).toHaveLength(1)
    // Name and navigation come from the group's own leading row.
    expect(tokenRows[0]).toHaveTextContent('NANA Project')
    fireEvent.click(tokenRows[0])
    expect(navigateMock).toHaveBeenCalledWith('/eth:3')
  })

  it('does not merge same-id projects from different chains without a sucker group', async () => {
    fetchAccountTokenHoldings.mockResolvedValue({
      rows: [
        { chainId: 1, projectId: 3, version: 6, balance: '2000000000000000000' },
        { chainId: 8453, projectId: 3, version: 6, balance: '1000000000000000000' },
      ],
      totalCount: 2,
      truncated: false,
    })
    render(<AccountView address={OWNER} />)
    fireEvent.click(screen.getByRole('button', { name: 'Holdings' }))

    const tokenRows = await screen.findAllByTestId('token-holding')
    expect(tokenRows).toHaveLength(2)
  })
})
