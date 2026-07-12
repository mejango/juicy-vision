import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ProjectCard from './ProjectCard'
import { useThemeStore, useTransactionStore } from '../../stores'
import * as bendystraw from '../../services/bendystraw'

// Mock wagmi
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    address: undefined,
    isConnected: false,
  })),
}))

// Mock viem
vi.mock('viem', () => ({
  formatEther: vi.fn((val) => (Number(val) / 1e18).toString()),
  formatUnits: vi.fn((val, decimals) => (Number(val) / Math.pow(10, decimals)).toString()),
  parseEther: vi.fn((val) => BigInt(Math.floor(Number(val) * 1e18))),
  parseUnits: vi.fn((val, decimals) => BigInt(Math.floor(Number(val) * Math.pow(10, decimals)))),
  createPublicClient: vi.fn(() => ({
    getBalance: vi.fn().mockResolvedValue(BigInt(0)),
    readContract: vi.fn().mockResolvedValue(BigInt(0)),
  })),
  http: vi.fn(),
  erc20Abi: [],
}))

// Mock bendystraw service
vi.mock('../../services/bendystraw', () => ({
  fetchProject: vi.fn(),
  fetchConnectedChains: vi.fn(),
  fetchIssuanceRate: vi.fn(),
  fetchSuckerGroupBalance: vi.fn(),
  fetchOwnersCount: vi.fn(),
  fetchProjectWithRuleset: vi.fn(),
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
  formatEthBalance: vi.fn((val) => '0'),
  formatUsdcBalance: vi.fn((val) => '0'),
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

  const mockIssuanceRate = {
    tokensPerEth: 1000,
    basedOnPayments: 10,
  }

  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    useTransactionStore.setState({ transactions: [] })
    localStorage.clear()
    vi.clearAllMocks()

    // Setup default mocks
    ;(bendystraw.fetchProject as Mock).mockResolvedValue(mockProject)
    ;(bendystraw.fetchConnectedChains as Mock).mockResolvedValue([])
    ;(bendystraw.fetchIssuanceRate as Mock).mockResolvedValue(mockIssuanceRate)
    ;(bendystraw.fetchSuckerGroupBalance as Mock).mockResolvedValue(mockSuckerBalance)
    ;(bendystraw.fetchOwnersCount as Mock).mockResolvedValue(100)
    ;(bendystraw.fetchProjectWithRuleset as Mock).mockResolvedValue(null)
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
      fireEvent.click(screen.getByRole('button', { name: 'Credits' }))
      expect(screen.queryByRole('button', { name: 'USDC' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'ETH' }))
      fireEvent.click(payButton)

      expect(openWallet).toHaveBeenCalledOnce()
      window.removeEventListener('juice:open-wallet-panel', openWallet)
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
})
