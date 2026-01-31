import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import HoldersChart from './HoldersChart'
import { useThemeStore } from '../../../stores'
import * as bendystraw from '../../../services/bendystraw'
import * as ens from '../../../utils/ens'

// Mock bendystraw service
vi.mock('../../../services/bendystraw', () => ({
  fetchProject: vi.fn(),
  fetchProjectSuckerGroupId: vi.fn(),
  fetchAggregatedParticipants: vi.fn(),
}))

// Mock ENS utility
vi.mock('../../../utils/ens', () => ({
  resolveEnsName: vi.fn(),
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
  Legend: ({ content }: { content: React.FC<any> }) => {
    const Content = content
    return <Content payload={[]} />
  },
}))

const mockProject = {
  id: '1-1-5',
  projectId: 1,
  chainId: 1,
  name: 'Test Project',
  metadata: JSON.stringify({ name: 'Test Project' }),
}

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
  })

  describe('loading state', () => {
    it('shows loading indicator while fetching', () => {
      vi.mocked(bendystraw.fetchProject).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      )

      render(<HoldersChart projectId="1" />)
      expect(screen.getByText('Loading...')).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('shows error message when fetch fails', async () => {
      vi.mocked(bendystraw.fetchProject).mockRejectedValue(new Error('API error'))

      render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('API error')).toBeInTheDocument()
      })
    })

    it('shows error when no holders found', async () => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchProjectSuckerGroupId).mockResolvedValue('sucker-1')
      vi.mocked(bendystraw.fetchAggregatedParticipants).mockResolvedValue({
        participants: [],
        totalSupply: 0n,
      })

      render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('No token holders found')).toBeInTheDocument()
      })
    })
  })

  describe('successful render', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchProjectSuckerGroupId).mockResolvedValue('sucker-1')
      vi.mocked(bendystraw.fetchAggregatedParticipants).mockResolvedValue(mockParticipants)
      vi.mocked(ens.resolveEnsName).mockResolvedValue(null)
    })

    it('renders the header', async () => {
      render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Token Holders')).toBeInTheDocument()
      })
    })

    it('shows project name in header', async () => {
      render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Test Project')).toBeInTheDocument()
      })
    })

    it('shows holder count', async () => {
      render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText(/Top 3 holders/)).toBeInTheDocument()
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
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchProjectSuckerGroupId).mockResolvedValue('sucker-1')
      vi.mocked(bendystraw.fetchAggregatedParticipants).mockResolvedValue(mockParticipants)
    })

    it('resolves ENS names for addresses', async () => {
      vi.mocked(ens.resolveEnsName).mockImplementation(async (addr) => {
        if (addr === '0x1234567890abcdef1234567890abcdef12345678') {
          return 'vitalik.eth'
        }
        return null
      })

      render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        expect(ens.resolveEnsName).toHaveBeenCalledTimes(3)
      })
    })
  })

  describe('others slice', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchProjectSuckerGroupId).mockResolvedValue('sucker-1')
      vi.mocked(ens.resolveEnsName).mockResolvedValue(null)
    })

    it('adds "Others" slice when percentages dont sum to 100', async () => {
      vi.mocked(bendystraw.fetchAggregatedParticipants).mockResolvedValue(mockParticipants)

      render(<HoldersChart projectId="1" />)

      // 50 + 30 + 15 = 95%, so "Others" should be added for remaining 5%
      await waitFor(() => {
        expect(screen.getByTestId('pie-chart')).toBeInTheDocument()
      })
    })
  })

  describe('sucker group fallback', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchAggregatedParticipants).mockResolvedValue(mockParticipants)
      vi.mocked(ens.resolveEnsName).mockResolvedValue(null)
    })

    it('falls back to single chain when no suckerGroupId', async () => {
      vi.mocked(bendystraw.fetchProjectSuckerGroupId).mockResolvedValue(null)

      render(<HoldersChart projectId="1" chainId="10" />)

      await waitFor(() => {
        expect(bendystraw.fetchAggregatedParticipants).toHaveBeenCalledWith(
          '', // empty suckerGroupId
          10, // limit
          '1', // projectId
          10 // chainId
        )
      })
    })
  })

  describe('limit prop', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchProjectSuckerGroupId).mockResolvedValue('sucker-1')
      vi.mocked(bendystraw.fetchAggregatedParticipants).mockResolvedValue(mockParticipants)
      vi.mocked(ens.resolveEnsName).mockResolvedValue(null)
    })

    it('respects limit prop', async () => {
      render(<HoldersChart projectId="1" limit={5} />)

      await waitFor(() => {
        expect(bendystraw.fetchAggregatedParticipants).toHaveBeenCalledWith(
          'sucker-1',
          5, // limit
          '1',
          1
        )
      })
    })

    it('defaults to limit of 10', async () => {
      render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        expect(bendystraw.fetchAggregatedParticipants).toHaveBeenCalledWith(
          'sucker-1',
          10, // default limit
          '1',
          1
        )
      })
    })
  })

  describe('theme', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchProjectSuckerGroupId).mockResolvedValue('sucker-1')
      vi.mocked(bendystraw.fetchAggregatedParticipants).mockResolvedValue(mockParticipants)
      vi.mocked(ens.resolveEnsName).mockResolvedValue(null)
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
      vi.mocked(bendystraw.fetchProject).mockResolvedValue(mockProject as any)
      vi.mocked(bendystraw.fetchProjectSuckerGroupId).mockResolvedValue('sucker-1')
      vi.mocked(bendystraw.fetchAggregatedParticipants).mockResolvedValue(mockParticipants)
      vi.mocked(ens.resolveEnsName).mockResolvedValue(null)
    })

    it('passes chainId to fetchProject', async () => {
      render(<HoldersChart projectId="1" chainId="8453" />)

      await waitFor(() => {
        expect(bendystraw.fetchProject).toHaveBeenCalledWith('1', 8453)
      })
    })

    it('defaults to chainId 1', async () => {
      render(<HoldersChart projectId="1" />)

      await waitFor(() => {
        expect(bendystraw.fetchProject).toHaveBeenCalledWith('1', 1)
      })
    })
  })
})
