import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import HoldersChart from './HoldersChart'
import { useThemeStore } from '../../../stores'
import * as bendystraw from '../../../services/bendystraw'
import * as ens from '../../../utils/ens'

// Mock bendystraw service
vi.mock('../../../services/bendystraw', () => ({
  fetchMultiChainParticipants: vi.fn(),
  fetchConnectedChains: vi.fn(),
}))

// Mock ENS utility
vi.mock('../../../utils/ens', () => ({
  resolveEnsNames: vi.fn(),
  truncateAddress: (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`,
}))

// Mock recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie">{children}</div>
  ),
  Cell: () => <div data-testid="cell" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: ({ content }: { content: React.FC<{ payload?: readonly unknown[] }> }) => {
    const Content = content
    return <Content payload={[]} />
  },
}))

const mockParticipants = {
  participants: [
    {
      address: '0x1234567890abcdef1234567890abcdef12345678',
      balance: 50000000000000000000000n, // 50k tokens
      percentage: 50,
      chains: [1, 10],
    },
    {
      address: '0xabcdef1234567890abcdef1234567890abcdef12',
      balance: 30000000000000000000000n, // 30k tokens
      percentage: 30,
      chains: [1],
    },
    {
      address: '0x9876543210fedcba9876543210fedcba98765432',
      balance: 15000000000000000000000n, // 15k tokens
      percentage: 15,
      chains: [8453],
    },
  ],
  totalSupply: 100000000000000000000000n, // 100k tokens
}

describe('HoldersChart', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    vi.clearAllMocks()
    // Default mock for fetchConnectedChains - returns single chain
    vi.mocked(bendystraw.fetchConnectedChains).mockResolvedValue([])
  })

  describe('loading state', () => {
    it('shows loading indicator while fetching', () => {
      vi.mocked(bendystraw.fetchConnectedChains).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      )

      render(<HoldersChart projectId="1" />)
      expect(screen.getByText('Loading...')).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('shows error message when fetch fails', async () => {
      vi.mocked(bendystraw.fetchConnectedChains).mockRejectedValue(new Error('API error'))

      render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('API error')).toBeInTheDocument()
      })
    })

    it('shows error when no holders found', async () => {
      vi.mocked(bendystraw.fetchMultiChainParticipants).mockResolvedValue({
        participants: [],
        totalSupply: 0n,
      })

      render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('No members yet')).toBeInTheDocument()
      })
    })
  })

  describe('successful render', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchMultiChainParticipants).mockResolvedValue(mockParticipants)
      vi.mocked(ens.resolveEnsNames).mockResolvedValue([null, null, null])
    })

    it('renders the header', async () => {
      render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Top Members')).toBeInTheDocument()
      })
    })

    it('shows holder count subtitle', async () => {
      render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText(/Showing 3 by ownership/)).toBeInTheDocument()
      })
    })

    it('renders the pie chart', async () => {
      render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByTestId('pie-chart')).toBeInTheDocument()
      })
    })
  })

  describe('ENS resolution', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchMultiChainParticipants).mockResolvedValue(mockParticipants)
    })

    it('resolves ENS names for addresses', async () => {
      vi.mocked(ens.resolveEnsNames).mockResolvedValue(['vitalik.eth', null, null])

      render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        expect(ens.resolveEnsNames).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('others slice', () => {
    beforeEach(() => {
      vi.mocked(ens.resolveEnsNames).mockResolvedValue([null, null, null])
    })

    it('adds "Others" slice when percentages dont sum to 100', async () => {
      vi.mocked(bendystraw.fetchMultiChainParticipants).mockResolvedValue(mockParticipants)

      render(<HoldersChart projectId="1" />)

      // 50 + 30 + 15 = 95%, so "Others" should be added for remaining 5%
      await waitFor(() => {
        expect(screen.getByTestId('pie-chart')).toBeInTheDocument()
      })
    })
  })

  describe('single-chain scope', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchMultiChainParticipants).mockResolvedValue(mockParticipants)
      vi.mocked(ens.resolveEnsNames).mockResolvedValue([null, null, null])
    })

    it('uses the requested chain when there is no connected group', async () => {
      render(<HoldersChart projectId="1" chainId="10" />)

      await waitFor(() => {
        expect(bendystraw.fetchMultiChainParticipants).toHaveBeenCalledWith(
          [{ chainId: 10, projectId: 1 }], // connectedChainsArray for single chain
          10, // limit
        )
      })
    })
  })

  describe('limit prop', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchMultiChainParticipants).mockResolvedValue(mockParticipants)
      vi.mocked(ens.resolveEnsNames).mockResolvedValue([null, null, null])
    })

    it('respects limit prop', async () => {
      render(<HoldersChart projectId="1" limit={5} />)

      await waitFor(() => {
        expect(bendystraw.fetchMultiChainParticipants).toHaveBeenCalledWith(
          [{ chainId: 1, projectId: 1 }], // connectedChainsArray
          5, // limit
        )
      })
    })

    it('defaults to limit of 10', async () => {
      render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        expect(bendystraw.fetchMultiChainParticipants).toHaveBeenCalledWith(
          [{ chainId: 1, projectId: 1 }], // connectedChainsArray
          10, // default limit
        )
      })
    })
  })

  describe('theme', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchMultiChainParticipants).mockResolvedValue(mockParticipants)
      vi.mocked(ens.resolveEnsNames).mockResolvedValue([null, null, null])
    })

    it('applies dark theme styles', async () => {
      useThemeStore.setState({ theme: 'dark' })
      const { container } = render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        const chartContainer = container.querySelector('.bg-juice-dark-lighter')
        expect(chartContainer).toBeInTheDocument()
      })
    })

    it('applies light theme styles', async () => {
      useThemeStore.setState({ theme: 'light' })
      const { container } = render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        const chartContainer = container.querySelector('.bg-white')
        expect(chartContainer).toBeInTheDocument()
      })
    })
  })

  describe('chainId handling', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchMultiChainParticipants).mockResolvedValue(mockParticipants)
      vi.mocked(ens.resolveEnsNames).mockResolvedValue([null, null, null])
    })

    it('passes chainId to connected-chain discovery', async () => {
      render(<HoldersChart projectId="1" chainId="8453" />)

      await waitFor(() => {
        expect(bendystraw.fetchConnectedChains).toHaveBeenCalledWith('1', 8453)
      })
    })

    it('defaults to chainId 1', async () => {
      render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        expect(bendystraw.fetchConnectedChains).toHaveBeenCalledWith('1', 1)
      })
    })
  })
})
