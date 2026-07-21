import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import VolumeChart from './VolumeChart'
import { useThemeStore } from '../../../stores'
import * as bendystraw from '../../../services/bendystraw'

// Mock bendystraw service
vi.mock('../../../services/bendystraw', () => ({
  fetchPayEventsHistory: vi.fn(),
  fetchConnectedChains: vi.fn(),
  fetchSuckerGroupBalance: vi.fn(),
}))

// Mock recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => <div data-testid="bar" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
}))

const now = Math.floor(Date.now() / 1000)
const mockPayEvents = [
  {
    txHash: '0xpay1',
    timestamp: now - 86400, // 1 day ago
    from: '0x1234',
    amount: '1000000000000000000', // 1 ETH
    amountUsd: '100000000000000000000', // $100, 18-decimal scaled
    newlyIssuedTokenCount: '100000000000000000000',
  },
  {
    txHash: '0xpay2',
    timestamp: now - 86400 * 2, // 2 days ago
    from: '0xabcd',
    amount: '2000000000000000000', // 2 ETH
    amountUsd: '200000000000000000000', // $200
    newlyIssuedTokenCount: '200000000000000000000',
  },
  {
    txHash: '0xpay3',
    timestamp: now - 86400 * 2, // Also 2 days ago (same day)
    from: '0x5678',
    amount: '500000000000000000', // 0.5 ETH
    amountUsd: '50000000000000000000', // $50
    newlyIssuedTokenCount: '50000000000000000000',
  },
]

describe('VolumeChart', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    vi.clearAllMocks()
    vi.mocked(bendystraw.fetchSuckerGroupBalance).mockResolvedValue({
      currency: 1,
      decimals: 18,
    } as any)
  })

  describe('loading state', () => {
    it('shows loading indicator while fetching', () => {
      vi.mocked(bendystraw.fetchConnectedChains).mockImplementation(
        () => new Promise(() => {})
      )

      render(<VolumeChart projectId="1" />)
      expect(
        screen.getByRole('status', { name: 'Loading chart' })
      ).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('shows error message when fetch fails', async () => {
      vi.mocked(bendystraw.fetchConnectedChains).mockRejectedValue(new Error('API error'))

      render(<VolumeChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('API error')).toBeInTheDocument()
      })
    })
  })

  describe('successful render', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchConnectedChains).mockResolvedValue([])
      vi.mocked(bendystraw.fetchPayEventsHistory).mockResolvedValue(mockPayEvents as any)
    })

    it('renders the header', async () => {
      render(<VolumeChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Payments')).toBeInTheDocument()
      })
    })

    it('renders the bar chart', async () => {
      render(<VolumeChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
      })
    })

    it('shows payment count in footer', async () => {
      render(<VolumeChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText(/3 payments/)).toBeInTheDocument()
      })
    })

    it('shows total volume in footer', async () => {
      render(<VolumeChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText(/\$350 total/)).toBeInTheDocument()
      })
    })
  })

  describe('range selector', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchConnectedChains).mockResolvedValue([])
      vi.mocked(bendystraw.fetchPayEventsHistory).mockResolvedValue(mockPayEvents as any)
    })

    it('renders all range options', async () => {
      render(<VolumeChart projectId="1" />)

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
      })

      // Labels are uppercase: 7D, 30D, 90D, 1Y, All
      expect(screen.getByText('7D')).toBeInTheDocument()
      expect(screen.getByText('30D')).toBeInTheDocument()
      expect(screen.getByText('90D')).toBeInTheDocument()
      expect(screen.getByText('1Y')).toBeInTheDocument()
      expect(screen.getByText('All')).toBeInTheDocument()
    })

    it('defaults to 1y range', async () => {
      render(<VolumeChart projectId="1" />)

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
      })

      const button1y = screen.getByText('1Y')
      expect(button1y.className).toContain('bg-white/10')
    })

    it('changes range when clicking different option', async () => {
      render(<VolumeChart projectId="1" />)

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('7D'))

      const button7d = screen.getByText('7D')
      expect(button7d.className).toContain('bg-white/10')
    })

    it('uses initial range prop', async () => {
      render(<VolumeChart projectId="1" range="30d" />)

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
      })

      const button30d = screen.getByText('30D')
      expect(button30d.className).toContain('bg-white/10')
    })
  })

  describe('multi-chain support', () => {
    it('fetches events from connected chains', async () => {
      vi.mocked(bendystraw.fetchConnectedChains).mockResolvedValue([
        { projectId: 1, chainId: 1 },
        { projectId: 1, chainId: 10 },
      ])
      vi.mocked(bendystraw.fetchPayEventsHistory).mockResolvedValue(mockPayEvents as any)

      render(<VolumeChart projectId="1" />)

      await waitFor(() => {
        // Should fetch from both chains
        expect(bendystraw.fetchPayEventsHistory).toHaveBeenCalledWith('1', 1)
        expect(bendystraw.fetchPayEventsHistory).toHaveBeenCalledWith('1', 10)
      })
    })

    it('falls back to single chain when no connected chains', async () => {
      vi.mocked(bendystraw.fetchConnectedChains).mockResolvedValue([])
      vi.mocked(bendystraw.fetchPayEventsHistory).mockResolvedValue(mockPayEvents as any)

      render(<VolumeChart projectId="1" chainId="8453" />)

      await waitFor(() => {
        expect(bendystraw.fetchPayEventsHistory).toHaveBeenCalledWith('1', 8453)
      })
    })
  })

  describe('empty data', () => {
    it('shows zero payments when no events', async () => {
      vi.mocked(bendystraw.fetchConnectedChains).mockResolvedValue([])
      vi.mocked(bendystraw.fetchPayEventsHistory).mockResolvedValue([])

      render(<VolumeChart projectId="1" range="7d" />)

      // With empty events, the chart still renders but shows 0 payments
      // because aggregateByDay fills in all days in the range with count=0
      await waitFor(() => {
        expect(screen.getByText(/0 payment/)).toBeInTheDocument()
      })
    })
  })

  describe('theme', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchConnectedChains).mockResolvedValue([])
      vi.mocked(bendystraw.fetchPayEventsHistory).mockResolvedValue(mockPayEvents as any)
    })

    it('applies dark theme styles', async () => {
      useThemeStore.setState({ theme: 'dark' })
      const { container } = render(<VolumeChart projectId="1" />)

      await waitFor(() => {
        const chartContainer = container.querySelector('.bg-juice-dark-lighter')
        expect(chartContainer).toBeInTheDocument()
      })
    })

    it('applies light theme styles', async () => {
      useThemeStore.setState({ theme: 'light' })
      const { container } = render(<VolumeChart projectId="1" />)

      await waitFor(() => {
        const chartContainer = container.querySelector('.bg-white')
        expect(chartContainer).toBeInTheDocument()
      })
    })
  })

  describe('data aggregation', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchConnectedChains).mockResolvedValue([])
    })

    it('aggregates multiple payments on same day', async () => {
      vi.mocked(bendystraw.fetchPayEventsHistory).mockResolvedValue(mockPayEvents as any)

      render(<VolumeChart projectId="1" />)

      // 3 payments total, 2 on same day = should aggregate correctly
      await waitFor(() => {
        expect(screen.getByText(/3 payments/)).toBeInTheDocument()
      })
    })
  })
})
