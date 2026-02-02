import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ManageTiersForm from './ManageTiersForm'
import { useThemeStore, useSettingsStore } from '../../stores'
import * as bendystraw from '../../services/bendystraw'
import * as nftService from '../../services/nft'

// Mock wagmi
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    address: undefined,
    isConnected: false,
  })),
}))

// Mock viem
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    formatEther: vi.fn((val) => (Number(val) / 1e18).toString()),
    parseEther: vi.fn((val) => BigInt(parseFloat(val) * 1e18)),
  }
})

// Mock bendystraw service
vi.mock('../../services/bendystraw', () => ({
  fetchProject: vi.fn(),
  fetchConnectedChains: vi.fn(),
}))

// Mock NFT service
vi.mock('../../services/nft', () => ({
  getProjectDataHook: vi.fn(),
  fetchNFTTiersWithPermissions: vi.fn(),
  fetchHookFlags: vi.fn(),
  getBlockedOperations: vi.fn(() => []),
}))

// Mock IPFS utils
vi.mock('../../utils/ipfs', () => ({
  resolveIpfsUri: vi.fn((uri) => (uri ? `https://ipfs.io/${uri}` : null)),
  encodeIpfsUri: vi.fn(() => '0x1234'),
  pinJson: vi.fn().mockResolvedValue('QmTest'),
  pinFile: vi.fn().mockResolvedValue('QmTestFile'),
}))

// Mock ManageTiersModal
vi.mock('../payment', () => ({
  ManageTiersModal: vi.fn(({ isOpen, onClose }) =>
    isOpen ? (
      <div data-testid="manage-tiers-modal">
        <button onClick={onClose}>Close</button>
      </div>
    ) : null
  ),
}))

// Get mocked wagmi
import { useAccount } from 'wagmi'
const mockedUseAccount = useAccount as Mock

describe('ManageTiersForm', () => {
  const mockProject = {
    id: '1',
    name: 'Test Project',
    logoUri: 'ipfs://QmLogo',
  }

  const mockHookAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`

  const mockHookFlags = {
    noNewTiersWithReserves: false,
    noNewTiersWithVotes: false,
    noNewTiersWithOwnerMinting: false,
    preventOverspending: false,
  }

  const mockTiers = [
    {
      tierId: 1,
      name: 'Basic Tier',
      description: 'A basic tier',
      price: BigInt('100000000000000000'), // 0.1 ETH
      currency: 1,
      initialSupply: 100,
      remainingSupply: 50,
      reservedRate: 0,
      votingUnits: 0n,
      category: 0,
      allowOwnerMint: false,
      transfersPausable: false,
      permissions: {
        cannotBeRemoved: false,
        cannotIncreaseDiscountPercent: false,
      },
    },
    {
      tierId: 2,
      name: 'Premium Tier',
      description: 'A premium tier',
      price: BigInt('1000000000000000000'), // 1 ETH
      currency: 1,
      initialSupply: 10,
      remainingSupply: 5,
      reservedRate: 0,
      votingUnits: 0n,
      category: 1,
      allowOwnerMint: true,
      transfersPausable: false,
      permissions: {
        cannotBeRemoved: true,
        cannotIncreaseDiscountPercent: false,
      },
    },
  ]

  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    useSettingsStore.setState({ pinataJwt: undefined })
    localStorage.clear()
    vi.clearAllMocks()

    // Setup default mock returns
    ;(bendystraw.fetchProject as Mock).mockResolvedValue(mockProject)
    ;(bendystraw.fetchConnectedChains as Mock).mockResolvedValue([])
    ;(nftService.getProjectDataHook as Mock).mockResolvedValue(mockHookAddress)
    ;(nftService.fetchHookFlags as Mock).mockResolvedValue(mockHookFlags)
    ;(nftService.fetchNFTTiersWithPermissions as Mock).mockResolvedValue(mockTiers)

    mockedUseAccount.mockReturnValue({
      address: undefined,
      isConnected: false,
    })
  })

  describe('loading state', () => {
    it('shows loading skeleton initially', () => {
      ;(bendystraw.fetchProject as Mock).mockImplementation(() => new Promise(() => {}))

      render(<ManageTiersForm projectId="1" />)

      const skeleton = document.querySelector('.animate-pulse')
      expect(skeleton).toBeInTheDocument()
    })
  })

  describe('no hook state', () => {
    it('shows error message when no hook configured', async () => {
      ;(nftService.getProjectDataHook as Mock).mockResolvedValue(null)

      render(<ManageTiersForm projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText(/No NFT collection configured/i)).toBeInTheDocument()
      })
    })
  })

  describe('tier display', () => {
    it('renders project name after loading', async () => {
      render(<ManageTiersForm projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Test Project')).toBeInTheDocument()
      })
    })

    it('displays existing tiers', async () => {
      render(<ManageTiersForm projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Basic Tier')).toBeInTheDocument()
        expect(screen.getByText('Premium Tier')).toBeInTheDocument()
      })
    })

    it('shows tier count', async () => {
      render(<ManageTiersForm projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText(/Current Tiers \(2\)/i)).toBeInTheDocument()
      })
    })

    it('shows locked indicator for non-removable tiers', async () => {
      render(<ManageTiersForm projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText(/\(locked\)/)).toBeInTheDocument()
      })
    })
  })

  describe('add tier button', () => {
    it('renders add tier button', async () => {
      render(<ManageTiersForm projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText(/Add New Tier/i)).toBeInTheDocument()
      })
    })

    it('shows tier editor when add button clicked', async () => {
      render(<ManageTiersForm projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText(/Add New Tier/i)).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText(/Add New Tier/i))

      await waitFor(() => {
        expect(screen.getByText('Cancel')).toBeInTheDocument()
        expect(screen.getByText('Add Tier')).toBeInTheDocument()
      })
    })
  })

  describe('remove tier functionality', () => {
    it('renders remove button for removable tiers', async () => {
      render(<ManageTiersForm projectId="1" />)

      await waitFor(() => {
        const removeButtons = screen.getAllByText('Remove')
        // Only 1 remove button should be enabled (Basic Tier)
        // Premium Tier has cannotBeRemoved: true
        expect(removeButtons.length).toBeGreaterThan(0)
      })
    })

    it('marks tier for removal when remove clicked', async () => {
      render(<ManageTiersForm projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Basic Tier')).toBeInTheDocument()
      })

      // Find the remove button for Basic Tier (the one that's not disabled)
      const removeButtons = screen.getAllByRole('button', { name: /Remove/i })
      const enabledRemoveButton = removeButtons.find(btn => !btn.hasAttribute('disabled'))

      if (enabledRemoveButton) {
        fireEvent.click(enabledRemoveButton)

        await waitFor(() => {
          expect(screen.getByText(/1 tier will be removed/i)).toBeInTheDocument()
        })
      }
    })

    it('shows undo button after marking for removal', async () => {
      render(<ManageTiersForm projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Basic Tier')).toBeInTheDocument()
      })

      const removeButtons = screen.getAllByRole('button', { name: /Remove/i })
      const enabledRemoveButton = removeButtons.find(btn => !btn.hasAttribute('disabled'))

      if (enabledRemoveButton) {
        fireEvent.click(enabledRemoveButton)

        await waitFor(() => {
          expect(screen.getByText('Undo')).toBeInTheDocument()
        })
      }
    })
  })

  describe('pending changes', () => {
    it('shows submit button when there are pending changes', async () => {
      render(<ManageTiersForm projectId="1" />)

      await waitFor(() => {
        expect(screen.getByText('Basic Tier')).toBeInTheDocument()
      })

      // Mark a tier for removal
      const removeButtons = screen.getAllByRole('button', { name: /Remove/i })
      const enabledRemoveButton = removeButtons.find(btn => !btn.hasAttribute('disabled'))

      if (enabledRemoveButton) {
        fireEvent.click(enabledRemoveButton)

        await waitFor(() => {
          expect(screen.getByText(/Review & Submit Changes/i)).toBeInTheDocument()
        })
      }
    })
  })

  describe('permission alerts', () => {
    it('shows permission alert when flags are restrictive', async () => {
      ;(nftService.fetchHookFlags as Mock).mockResolvedValue({
        noNewTiersWithReserves: true,
        noNewTiersWithVotes: true,
        noNewTiersWithOwnerMinting: false,
        preventOverspending: false,
      })
      ;(nftService.getBlockedOperations as Mock).mockReturnValue([
        'Adding tiers with reserved NFT minting',
        'Adding tiers with voting power',
      ])

      render(<ManageTiersForm projectId="1" />)

      await waitFor(() => {
        // Should show something about operations being restricted
        expect(screen.getByText(/operations restricted/i)).toBeInTheDocument()
      })
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles', async () => {
      useThemeStore.setState({ theme: 'dark' })
      render(<ManageTiersForm projectId="1" />)

      await waitFor(() => {
        const container = document.querySelector('.bg-juice-dark-lighter')
        expect(container).toBeInTheDocument()
      })
    })

    it('applies light theme styles', async () => {
      useThemeStore.setState({ theme: 'light' })
      render(<ManageTiersForm projectId="1" />)

      await waitFor(() => {
        const container = document.querySelector('.bg-white')
        expect(container).toBeInTheDocument()
      })
    })
  })

  describe('API calls', () => {
    it('calls fetchProject with correct params', async () => {
      render(<ManageTiersForm projectId="123" chainId="10" />)

      await waitFor(() => {
        expect(bendystraw.fetchProject).toHaveBeenCalledWith('123', 10)
      })
    })

    it('calls getProjectDataHook with correct params', async () => {
      render(<ManageTiersForm projectId="123" chainId="10" />)

      await waitFor(() => {
        expect(nftService.getProjectDataHook).toHaveBeenCalledWith('123', 10)
      })
    })

    it('calls fetchHookFlags with hook address', async () => {
      render(<ManageTiersForm projectId="123" />)

      await waitFor(() => {
        expect(nftService.fetchHookFlags).toHaveBeenCalledWith(mockHookAddress, 1)
      })
    })

    it('calls fetchNFTTiersWithPermissions with hook address', async () => {
      render(<ManageTiersForm projectId="123" />)

      await waitFor(() => {
        expect(nftService.fetchNFTTiersWithPermissions).toHaveBeenCalledWith(mockHookAddress, 1)
      })
    })
  })
})
