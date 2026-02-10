import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import BalanceChart from './BalanceChart'
import { useThemeStore } from '../../../stores'
import * as bendystraw from '../../../services/bendystraw'

// Mock bendystraw service
vi.mock('../../../services/bendystraw', () => ({
  fetchProject: vi.fn(),
  fetchProjectSuckerGroupId: vi.fn(),
  fetchSuckerGroupMoments: vi.fn(),
  fetchConnectedChains: vi.fn(),
  fetchProjectMoments: vi.fn(),
}))

// Mock recharts to avoid rendering issues in tests
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => <div data-testid="line" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
}))

const mockProject = {
  id: '1-1-5',
  projectId: 1,
  chainId: 1,
  name: 'Test Project',
  balance: '5000000000000000000', // 5 ETH
  metadata: JSON.stringify({ name: 'Test Project' }),
}

const mockMoments = [
  {
    timestamp: Math.floor(Date.now() / 1000) - 86400 * 30, // 30 days ago
    balance: '1000000000000000000', // 1 ETH
  },
  {
    timestamp: Math.floor(Date.now() / 1000) - 86400 * 15, // 15 days ago
    balance: '2500000000000000000', // 2.5 ETH
  },
  {
    timestamp: Math.floor(Date.now() / 1000) - 86400, // 1 day ago
    balance: '4000000000000000000', // 4 ETH
  },
  {
    timestamp: Math.floor(Date.now() / 1000), // Now
    balance: '5000000000000000000', // 5 ETH
  },
]

describe('BalanceChart', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    vi.clearAllMocks()
    // Default mock for new dependencies
    vi.mocked(bendystraw.fetchConnectedChains).mockResolvedValue([])
    vi.mocked(bendystraw.fetchProjectMoments).mockResolvedValue([])
  })

  describe('loading state', () => {
    it('shows loading indicator while fetching', () => {
      vi.mocked(bendystraw.fetchProject).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      )

      render(<BalanceChart projectId="1" />)
      expect(screen.getByText('Loading...')).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('shows error message when fetch fails', async () => {
      vi.mocked(bendystraw.fetchProject).mockRejectedValue(new Error('API error'))

      render(<BalanceChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('API error')).toBeInTheDocument()
      })
    })
  })

  describe('successful render', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchProjectSuckerGroupId).mockResolvedValue('sucker-group-1')
      vi.mocked(bendystraw.fetchSuckerGroupMoments).mockResolvedValue(mockMoments as any)
    })

    it('renders the header', async () => {
      render(<BalanceChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Balance')).toBeInTheDocument()
      })
    })

    it('renders the chart', async () => {
      render(<BalanceChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByTestId('line-chart')).toBeInTheDocument()
      })
    })

    it('shows current balance in footer', async () => {
      render(<BalanceChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText(/Current:/)).toBeInTheDocument()
      })
    })
  })

  describe('range selector', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchProjectSuckerGroupId).mockResolvedValue('sucker-group-1')
      vi.mocked(bendystraw.fetchSuckerGroupMoments).mockResolvedValue(mockMoments as any)
    })

    it('renders all range options', async () => {
      render(<BalanceChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByTestId('line-chart')).toBeInTheDocument()
      })

      // Labels are uppercase: 7D, 30D, 90D, 1Y, All
      expect(screen.getByText('7D')).toBeInTheDocument()
      expect(screen.getByText('30D')).toBeInTheDocument()
      expect(screen.getByText('90D')).toBeInTheDocument()
      expect(screen.getByText('1Y')).toBeInTheDocument()
      expect(screen.getByText('All')).toBeInTheDocument()
    })

    it('defaults to 30d range', async () => {
      render(<BalanceChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByTestId('line-chart')).toBeInTheDocument()
      })

      const button30d = screen.getByText('30D')
      expect(button30d.className).toContain('bg-white/10')
    })

    it('changes range when clicking different option', async () => {
      render(<BalanceChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByTestId('line-chart')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('7D'))

      const button7d = screen.getByText('7D')
      expect(button7d.className).toContain('bg-white/10')
    })

    it('uses initial range prop', async () => {
      render(<BalanceChart projectId="1" range="90d" />)

      await waitFor(() => {
        expect(screen.getByTestId('line-chart')).toBeInTheDocument()
      })

      const button90d = screen.getByText('90D')
      expect(button90d.className).toContain('bg-white/10')
    })
  })

  describe('fallback behavior', () => {
    it('shows single point when no suckerGroupId', async () => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchProjectSuckerGroupId).mockResolvedValue(null)

      render(<BalanceChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByTestId('line-chart')).toBeInTheDocument()
      })
    })

    it('shows single point when moments are empty', async () => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchProjectSuckerGroupId).mockResolvedValue('sucker-group-1')
      vi.mocked(bendystraw.fetchSuckerGroupMoments).mockResolvedValue([])

      render(<BalanceChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByTestId('line-chart')).toBeInTheDocument()
      })
    })
  })

  describe('empty data', () => {
    it('shows message when no data for range', async () => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue({
        ...mockProject,
        balance: '0',
      } as any)
      vi.mocked(bendystraw.fetchProjectSuckerGroupId).mockResolvedValue(null)

      render(<BalanceChart projectId="1" range="7d" />)

      // Should render chart even with single point
      await waitFor(() => {
        expect(screen.getByTestId('line-chart')).toBeInTheDocument()
      })
    })
  })

  describe('theme', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchProjectSuckerGroupId).mockResolvedValue('sucker-group-1')
      vi.mocked(bendystraw.fetchSuckerGroupMoments).mockResolvedValue(mockMoments as any)
    })

    it('applies dark theme styles', async () => {
      useThemeStore.setState({ theme: 'dark' })
      const { container } = render(<BalanceChart projectId="1" />)

      await waitFor(() => {
        const chartContainer = container.querySelector('.bg-juice-dark-lighter')
        expect(chartContainer).toBeInTheDocument()
      })
    })

    it('applies light theme styles', async () => {
      useThemeStore.setState({ theme: 'light' })
      const { container } = render(<BalanceChart projectId="1" />)

      await waitFor(() => {
        const chartContainer = container.querySelector('.bg-white')
        expect(chartContainer).toBeInTheDocument()
      })
    })

    it('changes range button style in light mode', async () => {
      useThemeStore.setState({ theme: 'light' })
      render(<BalanceChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByTestId('line-chart')).toBeInTheDocument()
      })

      const button30d = screen.getByText('30D')
      expect(button30d.className).toContain('bg-gray-200')
    })
  })

  describe('chainId handling', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchProjectSuckerGroupId).mockResolvedValue('sucker-group-1')
      vi.mocked(bendystraw.fetchSuckerGroupMoments).mockResolvedValue(mockMoments as any)
    })

    it('passes chainId to fetchProject', async () => {
      render(<BalanceChart projectId="1" chainId="10" />)

      await waitFor(() => {
        expect(bendystraw.fetchProject).toHaveBeenCalledWith('1', 10)
      })
    })

    it('defaults to chainId 1', async () => {
      render(<BalanceChart projectId="1" />)

      await waitFor(() => {
        expect(bendystraw.fetchProject).toHaveBeenCalledWith('1', 1)
      })
    })
  })
})
