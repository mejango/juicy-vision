import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TopProjects from './TopProjects'
import { useThemeStore } from '../../stores'
import * as bendystraw from '../../services/bendystraw'

// Mock bendystraw service
vi.mock('../../services/bendystraw', () => ({
  fetchProjects: vi.fn(),
}))

// Mock IPFS utility
vi.mock('../../utils/ipfs', () => ({
  resolveIpfsUri: (uri: string) => uri ? `https://ipfs.io/ipfs/${uri}` : null,
}))

const mockProjects = [
  {
    id: '1-1-5',
    projectId: 1,
    chainId: 1,
    version: 5,
    name: 'Project Alpha',
    handle: 'alpha',
    logoUri: 'ipfs://Qm123',
    volume: '5000000000000000000',
    volumeUsd: '10000000000000000000000',
    balance: '2000000000000000000',
    contributorsCount: 150,
    paymentsCount: 500,
    createdAt: 1704067200,
    trendingScore: '1000000',
    trendingVolume: '500000000000000000',
    trendingPaymentsCount: 25,
  },
  {
    id: '1-2-5',
    projectId: 2,
    chainId: 1,
    version: 5,
    name: 'Project Beta',
    handle: 'beta',
    logoUri: null,
    volume: '3000000000000000000',
    volumeUsd: '6000000000000000000000',
    balance: '1000000000000000000',
    contributorsCount: 75,
    paymentsCount: 200,
    createdAt: 1704153600,
    trendingScore: '500000',
    trendingVolume: '250000000000000000',
    trendingPaymentsCount: 10,
  },
  {
    id: '10-1-5',
    projectId: 1,
    chainId: 10,
    version: 5,
    name: 'Project Alpha',
    handle: 'alpha',
    logoUri: 'ipfs://Qm123',
    volume: '1000000000000000000',
    volumeUsd: '2000000000000000000000',
    balance: '500000000000000000',
    contributorsCount: 50,
    paymentsCount: 100,
    createdAt: 1704067200,
    trendingScore: '200000',
    trendingVolume: '100000000000000000',
    trendingPaymentsCount: 5,
  },
]

describe('TopProjects', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    vi.clearAllMocks()
  })

  describe('loading state', () => {
    it('shows loading indicator while fetching', () => {
      vi.mocked(bendystraw.fetchProjects).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      )

      render(<TopProjects />)
      expect(screen.getByText('Loading top projects...')).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('shows error message when fetch fails', async () => {
      vi.mocked(bendystraw.fetchProjects).mockRejectedValue(new Error('API error'))

      render(<TopProjects />)

      await waitFor(() => {
        expect(screen.getByText('Failed to load top-projects')).toBeInTheDocument()
      })
    })

    it('shows retry button on error', async () => {
      vi.mocked(bendystraw.fetchProjects).mockRejectedValue(new Error('API error'))

      render(<TopProjects />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
      })
    })

    it('retries fetch when retry button is clicked', async () => {
      vi.mocked(bendystraw.fetchProjects)
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce(mockProjects)

      render(<TopProjects />)

      await waitFor(() => {
        expect(screen.getByText('Failed to load top-projects')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await waitFor(() => {
        expect(screen.getByText('Project Alpha')).toBeInTheDocument()
      })

      expect(bendystraw.fetchProjects).toHaveBeenCalledTimes(2)
    })
  })

  describe('successful render', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProjects).mockResolvedValue(mockProjects)
    })

    it('renders project list', async () => {
      render(<TopProjects />)

      await waitFor(() => {
        expect(screen.getByText('Project Alpha')).toBeInTheDocument()
        expect(screen.getByText('Project Beta')).toBeInTheDocument()
      })
    })

    it('shows header with trending label by default', async () => {
      render(<TopProjects />)

      await waitFor(() => {
        expect(screen.getByText('Trending Projects')).toBeInTheDocument()
        expect(screen.getByText('7-day window')).toBeInTheDocument()
      })
    })

    it('shows volume header when orderBy is volumeUsd', async () => {
      render(<TopProjects orderBy="volumeUsd" />)

      await waitFor(() => {
        expect(screen.getByText('Top Projects by Volume')).toBeInTheDocument()
      })
    })

    it('groups same project across chains', async () => {
      render(<TopProjects />)

      await waitFor(() => {
        // Project Alpha exists on chain 1 and 10, should be grouped
        const alphaElements = screen.getAllByText('Project Alpha')
        // Should only appear once (grouped)
        expect(alphaElements).toHaveLength(1)
      })
    })

    it('shows chain badges for multi-chain projects', async () => {
      render(<TopProjects />)

      await waitFor(() => {
        // Project Alpha should show both ETH and OP badges
        expect(screen.getByText(/V5 ETH #1/)).toBeInTheDocument()
        expect(screen.getByText(/V5 OP #1/)).toBeInTheDocument()
      })
    })

    it('shows ranking numbers', async () => {
      render(<TopProjects />)

      await waitFor(() => {
        expect(screen.getByText('1')).toBeInTheDocument()
        expect(screen.getByText('2')).toBeInTheDocument()
      })
    })

    it('shows project logo when available', async () => {
      render(<TopProjects />)

      await waitFor(() => {
        const logos = screen.getAllByRole('img')
        expect(logos.length).toBeGreaterThan(0)
      })
    })

    it('shows initial letter when no logo', async () => {
      render(<TopProjects />)

      await waitFor(() => {
        // Project Beta has no logo, should show "P"
        expect(screen.getByText('P')).toBeInTheDocument()
      })
    })

    it('shows footer with click instruction', async () => {
      render(<TopProjects />)

      await waitFor(() => {
        expect(screen.getByText('Click a project to learn more')).toBeInTheDocument()
      })
    })
  })

  describe('interactions', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProjects).mockResolvedValue(mockProjects)
    })

    it('dispatches message event when project is clicked', async () => {
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

      render(<TopProjects />)

      await waitFor(() => {
        expect(screen.getByText('Project Alpha')).toBeInTheDocument()
      })

      // Find and click the project button
      const projectButton = screen.getByText('Project Alpha').closest('button')
      expect(projectButton).toBeInTheDocument()
      fireEvent.click(projectButton!)

      expect(dispatchEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'juice:send-message',
          detail: expect.objectContaining({
            message: expect.stringContaining('Project Alpha'),
          }),
        })
      )

      dispatchEventSpy.mockRestore()
    })
  })

  describe('props', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProjects).mockResolvedValue(mockProjects)
    })

    it('respects limit prop', async () => {
      render(<TopProjects limit={1} />)

      await waitFor(() => {
        expect(bendystraw.fetchProjects).toHaveBeenCalledWith(
          expect.objectContaining({ first: 4 }) // limit * 4 for grouping
        )
      })
    })

    it('respects orderBy prop', async () => {
      render(<TopProjects orderBy="balance" />)

      await waitFor(() => {
        expect(bendystraw.fetchProjects).toHaveBeenCalledWith(
          expect.objectContaining({ orderBy: 'balance' })
        )
      })
    })
  })

  describe('theme', () => {
    beforeEach(() => {
      vi.mocked(bendystraw.fetchProjects).mockResolvedValue(mockProjects)
    })

    it('applies dark theme styles', async () => {
      useThemeStore.setState({ theme: 'dark' })
      render(<TopProjects />)

      await waitFor(() => {
        const container = screen.getByText('Trending Projects').closest('.rounded-lg')
        expect(container).toHaveClass('bg-juice-dark-lighter')
      })
    })

    it('applies light theme styles', async () => {
      useThemeStore.setState({ theme: 'light' })
      render(<TopProjects />)

      await waitFor(() => {
        const container = screen.getByText('Trending Projects').closest('.rounded-lg')
        expect(container).toHaveClass('bg-white')
      })
    })
  })
})
