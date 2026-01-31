import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ActivityFeed from './ActivityFeed'
import { useThemeStore } from '../../stores'
import * as bendystraw from '../../services/bendystraw'

// Mock bendystraw service
vi.mock('../../services/bendystraw', () => ({
  fetchPayEventsHistory: vi.fn(),
  fetchCashOutEventsHistory: vi.fn(),
  fetchProject: vi.fn(),
  fetchSuckerGroupBalance: vi.fn(),
}))

const mockPayEvents = [
  {
    txHash: '0xpay1',
    timestamp: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
    from: '0x1234567890abcdef1234567890abcdef12345678',
    amount: '1000000000000000000', // 1 ETH
    newlyIssuedTokenCount: '100000000000000000000', // 100 tokens
    memo: 'Supporting the project!',
  },
  {
    txHash: '0xpay2',
    timestamp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    from: '0xabcdef1234567890abcdef1234567890abcdef12',
    amount: '500000000000000000', // 0.5 ETH
    newlyIssuedTokenCount: '50000000000000000000', // 50 tokens
    memo: null,
  },
]

const mockCashOutEvents = [
  {
    txHash: '0xcash1',
    timestamp: Math.floor(Date.now() / 1000) - 1800, // 30 minutes ago
    from: '0x9876543210fedcba9876543210fedcba98765432',
    reclaimAmount: '200000000000000000', // 0.2 ETH
    cashOutCount: '20000000000000000000', // 20 tokens
  },
]

const mockProject = {
  id: '1-1-5',
  projectId: 1,
  chainId: 1,
  name: 'Test Project',
}

const mockBalanceInfo = {
  totalBalance: '5000000000000000000',
  currency: 1,
  decimals: 18,
  projectBalances: [],
}

describe('ActivityFeed', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    vi.clearAllMocks()
  })

  describe('loading state', () => {
    it('shows loading indicator while fetching', () => {
      vi.mocked(bendystraw.fetchProject).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      )
      vi.mocked(bendystraw.fetchSuckerGroupBalance).mockImplementation(
        () => new Promise(() => {})
      )
      vi.mocked(bendystraw.fetchPayEventsHistory).mockImplementation(
        () => new Promise(() => {})
      )
      vi.mocked(bendystraw.fetchCashOutEventsHistory).mockImplementation(
        () => new Promise(() => {})
      )

      render(<ActivityFeed projectId="1" />)
      expect(screen.getByText('Loading activity...')).toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('shows no activity message when no events', async () => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchSuckerGroupBalance).mockResolvedValue(mockBalanceInfo as any)
      vi.mocked(bendystraw.fetchPayEventsHistory).mockResolvedValue([])
      vi.mocked(bendystraw.fetchCashOutEventsHistory).mockResolvedValue([])

      render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('No activity yet')).toBeInTheDocument()
      })
    })
  })

  describe('successful render', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchSuckerGroupBalance).mockResolvedValue(mockBalanceInfo as any)
      vi.mocked(bendystraw.fetchPayEventsHistory).mockResolvedValue(mockPayEvents as any)
      vi.mocked(bendystraw.fetchCashOutEventsHistory).mockResolvedValue(mockCashOutEvents as any)
    })

    it('renders activity header', async () => {
      render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Activity')).toBeInTheDocument()
      })
    })

    it('displays project name in header', async () => {
      render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Test Project')).toBeInTheDocument()
      })
    })

    it('renders pay events with correct icons', async () => {
      render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        expect(screen.getAllByText('💰').length).toBeGreaterThan(0)
      })
    })

    it('renders cashout events with correct icons', async () => {
      render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('🔄')).toBeInTheDocument()
      })
    })

    it('shows "paid" label for pay events', async () => {
      render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        expect(screen.getAllByText('paid').length).toBeGreaterThan(0)
      })
    })

    it('shows "cashed out" label for cashout events', async () => {
      render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('cashed out')).toBeInTheDocument()
      })
    })

    it('displays memo when present', async () => {
      render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('"Supporting the project!"')).toBeInTheDocument()
      })
    })

    it('shows token amounts', async () => {
      render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText(/100 tokens/)).toBeInTheDocument()
        expect(screen.getByText(/50 tokens/)).toBeInTheDocument()
      })
    })

    it('shows time ago format', async () => {
      render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('1m ago')).toBeInTheDocument()
        expect(screen.getByText('1h ago')).toBeInTheDocument()
      })
    })

    it('formats addresses correctly', async () => {
      render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        // Address: 0x1234567890abcdef1234567890abcdef12345678 -> 0x1234...5678
        expect(screen.getByText('0x1234...5678')).toBeInTheDocument()
      })
    })
  })

  describe('expand/collapse', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchSuckerGroupBalance).mockResolvedValue(mockBalanceInfo as any)
      vi.mocked(bendystraw.fetchPayEventsHistory).mockResolvedValue([
        ...mockPayEvents,
        ...mockPayEvents.map((e, i) => ({ ...e, txHash: `0xpay${i + 10}` })),
        ...mockPayEvents.map((e, i) => ({ ...e, txHash: `0xpay${i + 20}` })),
      ] as any)
      vi.mocked(bendystraw.fetchCashOutEventsHistory).mockResolvedValue(mockCashOutEvents as any)
    })

    it('shows "Show more" button when there are more events than limit', async () => {
      render(<ActivityFeed projectId="1" limit={3} />)

      await waitFor(() => {
        expect(screen.getByText(/Show .* more/)).toBeInTheDocument()
      })
    })

    it('expands to show all events when clicking "Show more"', async () => {
      render(<ActivityFeed projectId="1" limit={3} />)

      await waitFor(() => {
        expect(screen.getByText(/Show .* more/)).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText(/Show .* more/))

      await waitFor(() => {
        expect(screen.getByText('Show less')).toBeInTheDocument()
      })
    })

    it('collapses back when clicking "Show less"', async () => {
      render(<ActivityFeed projectId="1" limit={3} />)

      await waitFor(() => {
        expect(screen.getByText(/Show .* more/)).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText(/Show .* more/))

      await waitFor(() => {
        expect(screen.getByText('Show less')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Show less'))

      await waitFor(() => {
        expect(screen.getByText(/Show .* more/)).toBeInTheDocument()
      })
    })
  })

  describe('chain configuration', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchSuckerGroupBalance).mockResolvedValue(mockBalanceInfo as any)
      vi.mocked(bendystraw.fetchPayEventsHistory).mockResolvedValue(mockPayEvents as any)
      vi.mocked(bendystraw.fetchCashOutEventsHistory).mockResolvedValue(mockCashOutEvents as any)
    })

    it('uses Ethereum explorer by default', async () => {
      render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        const links = screen.getAllByRole('link')
        expect(links.some(link => link.getAttribute('href')?.includes('etherscan.io'))).toBe(true)
      })
    })

    it('uses Optimism explorer for chainId 10', async () => {
      render(<ActivityFeed projectId="1" chainId="10" />)

      await waitFor(() => {
        const links = screen.getAllByRole('link')
        expect(links.some(link => link.getAttribute('href')?.includes('optimistic.etherscan.io'))).toBe(true)
      })
    })

    it('uses Base explorer for chainId 8453', async () => {
      render(<ActivityFeed projectId="1" chainId="8453" />)

      await waitFor(() => {
        const links = screen.getAllByRole('link')
        expect(links.some(link => link.getAttribute('href')?.includes('basescan.org'))).toBe(true)
      })
    })
  })

  describe('USDC currency support', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchSuckerGroupBalance).mockResolvedValue({
        ...mockBalanceInfo,
        currency: 2, // USDC
        decimals: 6,
      } as any)
      vi.mocked(bendystraw.fetchPayEventsHistory).mockResolvedValue([
        {
          txHash: '0xpay1',
          timestamp: Math.floor(Date.now() / 1000) - 60,
          from: '0x1234567890abcdef1234567890abcdef12345678',
          amount: '1000000', // 1 USDC (6 decimals)
          newlyIssuedTokenCount: '100000000000000000000',
          memo: null,
        },
      ] as any)
      vi.mocked(bendystraw.fetchCashOutEventsHistory).mockResolvedValue([])
    })

    it('displays USDC amounts correctly', async () => {
      render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText(/USDC/)).toBeInTheDocument()
      })
    })
  })

  describe('theme', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchSuckerGroupBalance).mockResolvedValue(mockBalanceInfo as any)
      vi.mocked(bendystraw.fetchPayEventsHistory).mockResolvedValue(mockPayEvents as any)
      vi.mocked(bendystraw.fetchCashOutEventsHistory).mockResolvedValue(mockCashOutEvents as any)
    })

    it('applies dark theme styles', async () => {
      useThemeStore.setState({ theme: 'dark' })
      const { container } = render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Activity')).toBeInTheDocument()
      })

      const mainDiv = container.querySelector('.bg-juice-dark-lighter')
      expect(mainDiv).toBeInTheDocument()
    })

    it('applies light theme styles', async () => {
      useThemeStore.setState({ theme: 'light' })
      const { container } = render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Activity')).toBeInTheDocument()
      })

      const mainDiv = container.querySelector('.bg-white')
      expect(mainDiv).toBeInTheDocument()
    })
  })

  describe('error handling', () => {
    it('handles fetch errors gracefully', async () => {
      vi.mocked(bendystraw.fetchProject).mockRejectedValue(new Error('API error'))
      vi.mocked(bendystraw.fetchSuckerGroupBalance).mockRejectedValue(new Error('API error'))
      vi.mocked(bendystraw.fetchPayEventsHistory).mockRejectedValue(new Error('API error'))
      vi.mocked(bendystraw.fetchCashOutEventsHistory).mockRejectedValue(new Error('API error'))

      render(<ActivityFeed projectId="1" />)

      // Should not crash and should show empty state
      await waitFor(() => {
        expect(screen.getByText('No activity yet')).toBeInTheDocument()
      })
    })
  })

  describe('links', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchSuckerGroupBalance).mockResolvedValue(mockBalanceInfo as any)
      vi.mocked(bendystraw.fetchPayEventsHistory).mockResolvedValue(mockPayEvents as any)
      vi.mocked(bendystraw.fetchCashOutEventsHistory).mockResolvedValue(mockCashOutEvents as any)
    })

    it('links to address on explorer', async () => {
      render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        const addressLink = screen.getByText('0x1234...5678')
        expect(addressLink.closest('a')?.getAttribute('href')).toContain('/address/')
      })
    })

    it('links to transaction on explorer', async () => {
      render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        const links = screen.getAllByRole('link')
        expect(links.some(link => link.getAttribute('href')?.includes('/tx/'))).toBe(true)
      })
    })

    it('opens links in new tab', async () => {
      render(<ActivityFeed projectId="1" />)

      await waitFor(() => {
        const links = screen.getAllByRole('link')
        links.forEach(link => {
          expect(link.getAttribute('target')).toBe('_blank')
          expect(link.getAttribute('rel')).toContain('noopener')
        })
      })
    })
  })
})
