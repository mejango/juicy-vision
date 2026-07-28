import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTransactionStore } from '../stores/transactionStore'
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
  fetchProjectsByOwner,
  getSafesByOwner,
  fetchSafeInfo,
  resolveProjectNameForDisplay,
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
  fetchProjectsByOwner: vi.fn(),
  getSafesByOwner: vi.fn(),
  fetchSafeInfo: vi.fn(),
  resolveProjectNameForDisplay: vi.fn(),
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

vi.mock('../hooks', () => ({
  useEnsNameResolved: () => ({ ensName: 'jango.eth', loading: false }),
}))

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

vi.mock('../services/bendystraw', () => ({
  fetchAccountActivityEvents,
  fetchAccountOperatedPermissions,
  fetchProjectsByOwner,
}))

vi.mock('../services/bendystraw/client', () => ({
  resolveProjectNameForDisplay,
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
  fetchAccountActivityEvents.mockResolvedValue([
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
  ])
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
  resolveProjectNameForDisplay.mockResolvedValue('Operated Revnet')
}

describe('AccountView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedData()
    accountState.address = undefined
    useTransactionStore.setState({ transactions: [] })
  })

  it('renders identity, balances, activity, owned (incl. via-Safe) and operated projects', async () => {
    render(<AccountView address={OWNER} />)

    expect(await screen.findByRole('heading', { name: 'jango.eth' })).toBeInTheDocument()
    expect(screen.getByText('1.5000 ETH')).toBeInTheDocument()
    expect(screen.getByText('250.00 USDC')).toBeInTheDocument()

    expect(await screen.findByTestId('activity-item')).toHaveTextContent('evt-1')

    expect(await screen.findByText('Direct Project')).toBeInTheDocument()
    expect(screen.getByText('Safe Project')).toBeInTheDocument()
    expect(screen.getByText(/via Safe 0x3333.*\(2\/3\)/)).toBeInTheDocument()

    expect(await screen.findByText('Operated Revnet')).toBeInTheDocument()
    expect(screen.getByText('Revnet operator')).toBeInTheDocument()

    expect(fetchAccountActivityEvents).toHaveBeenCalledWith(OWNER, { limit: 25, offset: 0 })
    expect(fetchAccountOperatedPermissions).toHaveBeenCalledWith(OWNER)
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

  it('navigates via the view-as input for a raw 0x address', async () => {
    render(<AccountView address={OWNER} />)
    fireEvent.change(screen.getByPlaceholderText('View as address or ENS…'), {
      target: { value: OTHER },
    })
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith(`/account/${OTHER}`))
  })
})
