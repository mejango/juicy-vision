import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ProjectCard from './ProjectCard'
import { useThemeStore, useTransactionStore } from '../../stores'
import * as bendystraw from '../../services/bendystraw'

const { mockReadContract } = vi.hoisted(() => ({
  mockReadContract: vi.fn(),
}))

// Mock wagmi
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    address: undefined,
    isConnected: false,
  })),
}))

// Mock viem
// Keep real viem (encode/keccak/event-selector helpers used at module load by
// ammMarket, now in ProjectCard's graph); only the RPC/format helpers are faked.
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    formatEther: vi.fn((val) => (Number(val) / 1e18).toString()),
    formatUnits: vi.fn((val, decimals) => (Number(val) / Math.pow(10, decimals)).toString()),
    parseEther: vi.fn((val) => BigInt(Math.floor(Number(val) * 1e18))),
    parseUnits: vi.fn((val, decimals) => BigInt(Math.floor(Number(val) * Math.pow(10, decimals)))),
    createPublicClient: vi.fn(() => ({
      getBalance: vi.fn().mockResolvedValue(BigInt(0)),
      readContract: mockReadContract,
    })),
    http: vi.fn(),
    erc20Abi: [],
  }
})

// Mock bendystraw service
vi.mock('../../services/bendystraw', () => ({
  fetchProject: vi.fn(),
  fetchConnectedChains: vi.fn(),
  fetchSuckerGroupBalance: vi.fn(),
  fetchOwnersCount: vi.fn(),
  fetchProjectTokenSymbol: vi.fn(),
  fetchProjectAccountingContexts: vi.fn(),
  fetchEthPrice: vi.fn(),
}))

vi.mock('../../utils/paymentTerminal', () => ({
  getPaymentTokenAddress: vi.fn((token: string) => token === 'ETH'
    ? '0x000000000000000000000000000000000000EEEe'
    : '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
  getPaymentTerminal: vi.fn(async (_client, _chainId, _projectId, token: string) => {
    if (token.toLowerCase() !== '0x000000000000000000000000000000000000eeee') {
      throw new Error('This project does not accept the selected payment token')
    }
    return { address: '0x130f5Dd2bD8805443Cf41755253D778a75a67f53', type: 'multi' }
  }),
}))

vi.mock('../../utils/projectTrust', () => ({
  assertCurrentProjectPayConfigurationTrusted: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../services/nft', () => ({
  getProjectDataHook: vi.fn().mockResolvedValue(null),
  fetchResolvedNFTTiers: vi.fn().mockResolvedValue([]),
  fetchHookFlags: vi.fn().mockResolvedValue(null),
  getEffectiveTierPrice: vi.fn(),
  resolveTierUri: vi.fn(),
}))

// Mock utils
vi.mock('../../utils/ipfs', () => ({
  resolveIpfsUri: vi.fn((uri) => (uri ? `https://ipfs.io/${uri}` : null)),
  ipfsGatewayUrls: vi.fn((uri) => (uri ? [`https://ipfs.io/${uri}`] : [])),
  fetchIpfsMetadata: vi.fn().mockResolvedValue(null),
}))

// Mock hooks
vi.mock('../../hooks/useWalletBalances', () => ({
  useWalletBalances: vi.fn(() => ({
    totalEth: 0n,
    totalUsdc: 0n,
    perChain: [],
    loading: false,
    available: false,
  })),
  formatEthBalance: vi.fn(() => '0'),
  formatUsdcBalance: vi.fn(() => '0'),
}))

vi.mock('../../hooks', () => ({
  useManagedWallet: vi.fn(() => ({
    address: '0x1234567890123456789012345678901234567890',
    isLoading: false,
  })),
}))

// Get mocked wagmi
import { useAccount } from 'wagmi'
const mockedUseAccount = useAccount as Mock

describe('ProjectCard', () => {
  const mockProject = {
    id: '1',
    projectId: 1,
    chainId: 1,
    name: 'Test Project',
    handle: 'test-project',
    balance: '1000000000000000000',
    volume: '5000000000000000000',
    paymentsCount: 1,
    createdAt: 1,
    logoUri: 'ipfs://QmLogo',
    baseCurrency: 1,
    totalPaid: '5000000000000000000',
  }

  const mockSuckerBalance = {
    totalBalance: '1000000000000000000',
    totalVolume: '5000000000000000000',
    totalVolumeUsd: '0',
    totalPaymentsCount: 1,
    currency: 1,
    decimals: 18,
    projectBalances: [],
    balanceAvailable: true,
    volumeAvailable: true,
    paymentsAvailable: true,
    dataScope: 'project',
  }

  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    useTransactionStore.setState({ transactions: [] })
    localStorage.clear()
    vi.clearAllMocks()

    // Setup default mocks
    ;(bendystraw.fetchProject as Mock).mockResolvedValue(mockProject)
    ;(bendystraw.fetchConnectedChains as Mock).mockResolvedValue([])
    ;(bendystraw.fetchSuckerGroupBalance as Mock).mockResolvedValue(mockSuckerBalance)
    ;(bendystraw.fetchOwnersCount as Mock).mockResolvedValue(100)
    ;(bendystraw.fetchProjectTokenSymbol as Mock).mockResolvedValue(null)
    ;(bendystraw.fetchProjectAccountingContexts as Mock).mockResolvedValue([{
      terminal: '0x130f5Dd2bD8805443Cf41755253D778a75a67f53',
      token: '0x000000000000000000000000000000000000EEEe',
      decimals: 18,
      currency: 61166,
      symbol: 'ETH',
      balance: 1n,
    }])
    ;(bendystraw.fetchEthPrice as Mock).mockResolvedValue(2500)
    mockReadContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'previewPayFor') {
        return [
          { id: 1n },
          568_002_355_840_000_000_000n,
          348_130_476_160_000_000_000n,
          [],
        ]
      }
      // Direct-pay currencies come from the project's actual accounting contexts (native ETH here).
      if (functionName === 'accountingContextsOf') {
        return [{ token: '0x000000000000000000000000000000000000EEEe', decimals: 18, currency: 61166 }]
      }
      return 0n
    })

    mockedUseAccount.mockReturnValue({
      address: undefined,
      isConnected: false,
    })
  })

  describe('loading state', () => {
    it('shows loading skeleton initially', () => {
      // Make fetchProject never resolve to keep loading state
      ;(bendystraw.fetchProject as Mock).mockImplementation(() => new Promise(() => {}))

      render(<ProjectCard projectId="1" />)

      const skeleton = document.querySelector('.animate-pulse')
      expect(skeleton).toBeInTheDocument()
    })
  })

  describe('component display', () => {
    it('renders project name after loading', async () => {
      render(<ProjectCard projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Test Project')).toBeInTheDocument()
      })
    })

    it('calls fetchProject with correct project ID', async () => {
      render(<ProjectCard projectId="123" />)

      await waitFor(() => {
        expect(bendystraw.fetchProject).toHaveBeenCalled()
        const calls = (bendystraw.fetchProject as Mock).mock.calls
        expect(calls.some((call: unknown[]) => call[0] === '123')).toBe(true)
      })
    })
  })

  describe('error handling', () => {
    it('shows error message on fetch failure', async () => {
      ;(bendystraw.fetchProject as Mock).mockRejectedValue(new Error('Network error'))

      render(<ProjectCard projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText(/error/i)).toBeInTheDocument()
      })
    })
  })

  describe('pay button', () => {
    it('renders a pay button after loading', async () => {
      render(<ProjectCard projectId="1" />)

      await waitFor(() => {
        // Find any button with "Pay" text
        const buttons = screen.getAllByRole('button')
        const payButton = buttons.find(btn => btn.textContent?.toLowerCase().includes('pay'))
        expect(payButton).toBeDefined()
      })
    })

    it('opens wallet connection before treating a disconnected wallet as empty', async () => {
      const openWallet = vi.fn()
      window.addEventListener('juice:open-wallet-panel', openWallet)
      render(<ProjectCard projectId="1" chainId="11155111" />)

      const payButton = await screen.findByRole('button', { name: 'Pay' })
      await waitFor(() => expect(payButton).toBeEnabled())
      fireEvent.click(payButton)

      expect(openWallet).toHaveBeenCalledOnce()
      window.removeEventListener('juice:open-wallet-panel', openWallet)
    })

    it('shows the live beneficiary, split, and route preview for a normal payment', async () => {
      ;(bendystraw.fetchProjectTokenSymbol as Mock).mockResolvedValue('REV')
      render(<ProjectCard projectId="1" chainId="11155111" />)

      expect(await screen.findByText('You get at least')).toBeInTheDocument()
      // The displayed minimum carries the 1% slippage floor the pay submits.
      expect(screen.getByRole('button', { name: '562.32 REV' })).toBeInTheDocument()
      expect(screen.getByText('Splits get 348.13 REV')).toBeInTheDocument()
      expect(screen.getByText('Issuance')).toBeInTheDocument()
      expect(mockReadContract).toHaveBeenCalledWith(expect.objectContaining({
        functionName: 'previewPayFor',
      }))
    })

    it('uses a compact Pay/Add to balance action selector instead of a checkbox', async () => {
      render(<ProjectCard projectId="1" chainId="11155111" />)

      const action = await screen.findByRole('button', { name: 'Payment action: Pay' })
      expect(screen.getByRole('button', { name: 'Payment chain: Sepolia' })).toBeInTheDocument()
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

      fireEvent.click(action)
      fireEvent.click(screen.getByRole('menuitem', { name: 'Add to balance' }))

      expect(screen.getByRole('button', { name: 'Payment action: Add to balance' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
      expect(screen.getByText(/does not issue project tokens/i)).toBeInTheDocument()
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles', async () => {
      useThemeStore.setState({ theme: 'dark' })
      render(<ProjectCard projectId="1" />)

      await waitFor(() => {
        const container = document.querySelector('.bg-juice-dark-lighter')
        expect(container).toBeInTheDocument()
      })
    })

    it('applies light theme styles', async () => {
      useThemeStore.setState({ theme: 'light' })
      render(<ProjectCard projectId="1" />)

      await waitFor(() => {
        const container = document.querySelector('.bg-white')
        expect(container).toBeInTheDocument()
      })
    })
  })

  describe('treasury balance refresh', () => {
    it('refetches the group balance when a balance-changing tx invalidates project data', async () => {
      render(<ProjectCard projectId="1" />)
      await waitFor(() => {
        expect(bendystraw.fetchSuckerGroupBalance).toHaveBeenCalled()
      })
      ;(bendystraw.fetchSuckerGroupBalance as Mock).mockClear()

      // A cash out / payout / pay confirmation fires this; the header must refetch, not wait for a reload.
      window.dispatchEvent(new CustomEvent('juice:project-data-invalidated', {
        detail: { chainId: 1, projectId: 1 },
      }))

      await waitFor(() => {
        expect(bendystraw.fetchSuckerGroupBalance).toHaveBeenCalledTimes(1)
      })
    })
  })
})
