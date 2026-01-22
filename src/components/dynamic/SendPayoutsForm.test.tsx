import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import SendPayoutsForm from './SendPayoutsForm'
import { useThemeStore } from '../../stores'
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
}))

// Mock bendystraw service
vi.mock('../../services/bendystraw', () => ({
  fetchProject: vi.fn(),
  fetchDistributablePayout: vi.fn(),
  fetchConnectedChains: vi.fn(),
  fetchProjectSplits: vi.fn(),
  fetchProjectWithRuleset: vi.fn(),
}))

// Mock IPFS utils
vi.mock('../../utils/ipfs', () => ({
  resolveIpfsUri: vi.fn((uri) => (uri ? `https://ipfs.io/${uri}` : null)),
}))

// Mock ENS utils
vi.mock('../../utils/ens', () => ({
  resolveEnsName: vi.fn().mockResolvedValue(null),
  truncateAddress: vi.fn((addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`),
}))

// Mock SendPayoutsModal
vi.mock('../payment', () => ({
  SendPayoutsModal: vi.fn(({ isOpen, onClose }) =>
    isOpen ? (
      <div data-testid="send-payouts-modal">
        <button onClick={onClose}>Close</button>
      </div>
    ) : null
  ),
}))

// Get mocked wagmi
import { useAccount } from 'wagmi'
const mockedUseAccount = useAccount as Mock

describe('SendPayoutsForm', () => {
  const mockProject = {
    id: '1',
    name: 'Test Project',
    balance: '1000000000000000000',
    logoUri: 'ipfs://QmLogo',
    baseCurrency: 1,
  }

  const mockDistributablePayout = {
    distributableAmount: '500000000000000000',
    usedAmount: '0',
    configuredAmount: '1000000000000000000',
  }

  const mockSplits = [
    {
      beneficiary: '0x1234567890123456789012345678901234567890',
      percent: 500000000,
      allocator: '0x0000000000000000000000000000000000000000',
      projectId: 0,
      preferAddToBalance: false,
      lockedUntil: 0,
    },
  ]

  const mockRuleset = {
    payoutLimit: {
      amount: '1000000000000000000',
      currency: 1,
    },
  }

  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    localStorage.clear()
    vi.clearAllMocks()

    // Setup default mock returns
    ;(bendystraw.fetchProject as Mock).mockResolvedValue(mockProject)
    ;(bendystraw.fetchDistributablePayout as Mock).mockResolvedValue(mockDistributablePayout)
    ;(bendystraw.fetchConnectedChains as Mock).mockResolvedValue([])
    ;(bendystraw.fetchProjectSplits as Mock).mockResolvedValue(mockSplits)
    ;(bendystraw.fetchProjectWithRuleset as Mock).mockResolvedValue(mockRuleset)

    mockedUseAccount.mockReturnValue({
      address: undefined,
      isConnected: false,
    })
  })

  describe('loading state', () => {
    it('shows loading skeleton initially', () => {
      ;(bendystraw.fetchProject as Mock).mockImplementation(() => new Promise(() => {}))

      render(<SendPayoutsForm projectId="1" />)

      const skeleton = document.querySelector('.animate-pulse')
      expect(skeleton).toBeInTheDocument()
    })
  })

  describe('component display', () => {
    it('renders project name after loading', async () => {
      render(<SendPayoutsForm projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Test Project')).toBeInTheDocument()
      })
    })

    it('calls fetchProject with correct params', async () => {
      render(<SendPayoutsForm projectId="123" chainId="10" />)

      await waitFor(() => {
        expect(bendystraw.fetchProject).toHaveBeenCalledWith('123', 10)
      })
    })
  })

  describe('amount input', () => {
    it('renders amount input field', async () => {
      render(<SendPayoutsForm projectId="1" />)

      await waitFor(() => {
        const input = document.querySelector('input[type="number"]')
        expect(input).toBeInTheDocument()
      })
    })
  })

  describe('send button', () => {
    it('renders send button', async () => {
      render(<SendPayoutsForm projectId="1" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument()
      })
    })

    it('send button is disabled without amount', async () => {
      render(<SendPayoutsForm projectId="1" />)

      await waitFor(() => {
        const button = screen.getByRole('button', { name: /send/i })
        expect(button).toBeDisabled()
      })
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles', async () => {
      useThemeStore.setState({ theme: 'dark' })
      render(<SendPayoutsForm projectId="1" />)

      await waitFor(() => {
        const container = document.querySelector('.bg-juice-dark-lighter')
        expect(container).toBeInTheDocument()
      })
    })

    it('applies light theme styles', async () => {
      useThemeStore.setState({ theme: 'light' })
      render(<SendPayoutsForm projectId="1" />)

      await waitFor(() => {
        const container = document.querySelector('.bg-white')
        expect(container).toBeInTheDocument()
      })
    })
  })
})
