import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import CashOutForm from './CashOutForm'
import { useThemeStore } from '../../stores'
import * as bendystraw from '../../services/bendystraw'

// Mock wagmi
vi.mock('wagmi', async (importOriginal) => ({
  ...await importOriginal<typeof import('wagmi')>(),
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
  fetchProjectAccountingContexts: vi.fn(),
  fetchUserTokenBalance: vi.fn(),
}))

// Mock IPFS utils
vi.mock('../../utils/ipfs', () => ({
  resolveIpfsUri: vi.fn((uri) => (uri ? `https://ipfs.io/${uri}` : null)),
  ipfsGatewayUrls: vi.fn((uri) => (uri ? [`https://ipfs.io/${uri}`] : [])),
}))

// Mock CashOutModal
vi.mock('../payment', () => ({
  CashOutModal: vi.fn(({ isOpen, onClose, onConfirmed, projectId, tokenAmount }) =>
    isOpen ? (
      <div data-testid="cash-out-modal">
        <div>Project: {projectId}</div>
        <div>Amount: {tokenAmount}</div>
        <button onClick={() => onConfirmed('0xabc')}>Confirm cash out</button>
        <button onClick={onClose}>Close</button>
      </div>
    ) : null
  ),
}))

// Get mocked wagmi
import { useAccount } from 'wagmi'
const mockedUseAccount = useAccount as Mock

function renderForm(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) }
}

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
    ;(bendystraw.fetchProjectAccountingContexts as Mock).mockResolvedValue([{
      terminal: '0x130f5dd2bd8805443cf41755253d778a75a67f53',
      token: '0x000000000000000000000000000000000000eeee',
      decimals: 18,
      currency: 61166,
      symbol: 'ETH',
      isNative: true,
      balance: 0n,
    }])
    ;(bendystraw.fetchUserTokenBalance as Mock).mockResolvedValue({ balance: '0' })

    mockedUseAccount.mockReturnValue({
      address: undefined,
      isConnected: false,
    })
  })

  describe('loading state', () => {
    it('shows loading skeleton initially', () => {
      ;(bendystraw.fetchProject as Mock).mockImplementation(() => new Promise(() => {}))

      renderForm(<CashOutForm projectId="1" />)

      const skeleton = document.querySelector('.animate-pulse')
      expect(skeleton).toBeInTheDocument()
    })
  })

  describe('component display', () => {
    it('renders project name link after loading', async () => {
      renderForm(<CashOutForm projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Test Project')).toBeInTheDocument()
      })
    })

    it('calls fetchProject with correct params', async () => {
      renderForm(<CashOutForm projectId="123" chainId="10" />)

      await waitFor(() => {
        expect(bendystraw.fetchProject).toHaveBeenCalledWith('123', 10)
      })
    })
  })

  describe('token input', () => {
    it('renders token input field', async () => {
      renderForm(<CashOutForm projectId="1" />)

      await waitFor(() => {
        const input = document.querySelector('input[type="number"]')
        expect(input).toBeInTheDocument()
      })
    })
  })

  describe('cash out button', () => {
    it('renders cash out button', async () => {
      renderForm(<CashOutForm projectId="1" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cash out/i })).toBeInTheDocument()
      })
    })

    it('cash out button is disabled initially', async () => {
      renderForm(<CashOutForm projectId="1" />)

      await waitFor(() => {
        const button = screen.getByRole('button', { name: /cash out/i })
        expect(button).toBeDisabled()
      })
    })
  })

  describe('cash out without a deployed ERC-20', () => {
    const holder = '0x1234567890123456789012345678901234567890'

    beforeEach(() => {
      // The project has NO deployed ERC-20 (tokenAddress null/zero); the holder's
      // positive JBTokens.totalBalanceOf comes entirely from internal credits.
      mockedUseAccount.mockReturnValue({ address: holder, isConnected: true })
      ;(bendystraw.fetchUserTokenBalance as Mock).mockResolvedValue({
        balance: (100n * 10n ** 18n).toString(),
      })
    })

    it('keeps cash out available with no ERC-20 when internal credits cover the amount', async () => {
      renderForm(<CashOutForm projectId="1" />)

      await waitFor(() => {
        expect(bendystraw.fetchUserTokenBalance).toHaveBeenCalledWith('1', 1, holder)
      })
      fireEvent.change(document.querySelector('input[type="number"]')!, { target: { value: '10' } })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^cash out$/i })).toBeEnabled()
      })
    })

    it('fires the invalidation event and clears the amount after a confirmed cash out', async () => {
      const invalidated = vi.fn()
      window.addEventListener('juice:project-data-invalidated', invalidated)
      renderForm(<CashOutForm projectId="1" />)

      await waitFor(() => {
        expect(bendystraw.fetchUserTokenBalance).toHaveBeenCalledWith('1', 1, holder)
      })
      const input = document.querySelector('input[type="number"]')!
      fireEvent.change(input, { target: { value: '10' } })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^cash out$/i })).toBeEnabled()
      })

      fireEvent.click(screen.getByRole('button', { name: /^cash out$/i }))
      fireEvent.click(await screen.findByRole('button', { name: 'Confirm cash out' }))

      await waitFor(() => expect(invalidated).toHaveBeenCalledTimes(1))
      expect((invalidated.mock.calls[0][0] as CustomEvent).detail).toEqual({ chainId: 1, projectId: 1 })
      await waitFor(() => expect(screen.queryByTestId('cash-out-modal')).not.toBeInTheDocument())
      expect(input).toHaveValue(null)
      // The confirmed transaction locks the form and reloads the live balance.
      await waitFor(() => expect(bendystraw.fetchUserTokenBalance).toHaveBeenCalledTimes(2))
      window.removeEventListener('juice:project-data-invalidated', invalidated)
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles', async () => {
      useThemeStore.setState({ theme: 'dark' })
      renderForm(<CashOutForm projectId="1" />)

      await waitFor(() => {
        const container = document.querySelector('.bg-juice-dark-lighter')
        expect(container).toBeInTheDocument()
      })
    })

    it('applies light theme styles', async () => {
      useThemeStore.setState({ theme: 'light' })
      renderForm(<CashOutForm projectId="1" />)

      await waitFor(() => {
        const container = document.querySelector('.bg-white')
        expect(container).toBeInTheDocument()
      })
    })
  })
})
