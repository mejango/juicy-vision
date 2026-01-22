import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import CashOutForm from './CashOutForm'
import { useThemeStore } from '../../stores'
import * as bendystraw from '../../services/bendystraw'

// Mock wagmi
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    address: undefined,
    isConnected: false,
  })),
}))

// Mock bendystraw service
vi.mock('../../services/bendystraw', () => ({
  fetchProject: vi.fn(),
  fetchConnectedChains: vi.fn(),
  fetchIssuanceRate: vi.fn(),
}))

// Mock IPFS utils
vi.mock('../../utils/ipfs', () => ({
  resolveIpfsUri: vi.fn((uri) => (uri ? `https://ipfs.io/${uri}` : null)),
}))

// Mock CashOutModal
vi.mock('../payment', () => ({
  CashOutModal: vi.fn(({ isOpen, onClose, projectId, tokenAmount }) =>
    isOpen ? (
      <div data-testid="cash-out-modal">
        <div>Project: {projectId}</div>
        <div>Amount: {tokenAmount}</div>
        <button onClick={onClose}>Close</button>
      </div>
    ) : null
  ),
}))

// Get mocked wagmi
import { useAccount } from 'wagmi'
const mockedUseAccount = useAccount as Mock

describe('CashOutForm', () => {
  const mockProject = {
    id: '1',
    name: 'Test Project',
    balance: '1000000000000000000',
    logoUri: 'ipfs://QmLogo',
    baseCurrency: 1,
  }

  const mockIssuanceRate = {
    tokensPerEth: 1000,
    basedOnPayments: 10,
  }

  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    localStorage.clear()
    vi.clearAllMocks()

    // Setup default mock returns
    ;(bendystraw.fetchProject as Mock).mockResolvedValue(mockProject)
    ;(bendystraw.fetchConnectedChains as Mock).mockResolvedValue([])
    ;(bendystraw.fetchIssuanceRate as Mock).mockResolvedValue(mockIssuanceRate)

    mockedUseAccount.mockReturnValue({
      address: undefined,
      isConnected: false,
    })
  })

  describe('loading state', () => {
    it('shows loading skeleton initially', () => {
      ;(bendystraw.fetchProject as Mock).mockImplementation(() => new Promise(() => {}))

      render(<CashOutForm projectId="1" />)

      const skeleton = document.querySelector('.animate-pulse')
      expect(skeleton).toBeInTheDocument()
    })
  })

  describe('component display', () => {
    it('renders project name link after loading', async () => {
      render(<CashOutForm projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Test Project')).toBeInTheDocument()
      })
    })

    it('calls fetchProject with correct params', async () => {
      render(<CashOutForm projectId="123" chainId="10" />)

      await waitFor(() => {
        expect(bendystraw.fetchProject).toHaveBeenCalledWith('123', 10)
      })
    })
  })

  describe('token input', () => {
    it('renders token input field', async () => {
      render(<CashOutForm projectId="1" />)

      await waitFor(() => {
        const input = document.querySelector('input[type="number"]')
        expect(input).toBeInTheDocument()
      })
    })
  })

  describe('cash out button', () => {
    it('renders cash out button', async () => {
      render(<CashOutForm projectId="1" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cash out/i })).toBeInTheDocument()
      })
    })

    it('cash out button is disabled initially', async () => {
      render(<CashOutForm projectId="1" />)

      await waitFor(() => {
        const button = screen.getByRole('button', { name: /cash out/i })
        expect(button).toBeDisabled()
      })
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles', async () => {
      useThemeStore.setState({ theme: 'dark' })
      render(<CashOutForm projectId="1" />)

      await waitFor(() => {
        const container = document.querySelector('.bg-juice-dark-lighter')
        expect(container).toBeInTheDocument()
      })
    })

    it('applies light theme styles', async () => {
      useThemeStore.setState({ theme: 'light' })
      render(<CashOutForm projectId="1" />)

      await waitFor(() => {
        const container = document.querySelector('.bg-white')
        expect(container).toBeInTheDocument()
      })
    })
  })
})
