import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
  fetchEthPrice: vi.fn(),
}))

// Mock utils
vi.mock('../../utils/ipfs', () => ({
  resolveIpfsUri: vi.fn((uri) => (uri ? `https://ipfs.io/${uri}` : null)),
  fetchIpfsMetadata: vi.fn().mockResolvedValue(null),
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
    logoUri: 'ipfs://QmLogo',
    baseCurrency: 1,
    totalPaid: '5000000000000000000',
  }

  const mockSuckerBalance = {
    total: '1000000000000000000',
    chains: [],
    symbol: 'ETH',
    decimals: 18,
  }

  const mockIssuanceRate = {
    tokensPerEth: 1000,
    basedOnPayments: 10,
  }

  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    useTransactionStore.setState({ transactions: {} })
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
