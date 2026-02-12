import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import NFTTierCard from './NFTTierCard'
import { useThemeStore, useTransactionStore } from '../../stores'
import type { ResolvedNFTTier } from '../../services/nft'

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
  createPublicClient: vi.fn(() => ({
    readContract: vi.fn().mockResolvedValue(null),
  })),
  http: vi.fn(),
}))

// Mock IPFS utils
vi.mock('../../utils/ipfs', () => ({
  resolveIpfsUri: vi.fn((uri) => (uri ? `https://ipfs.io/${uri}` : null)),
  inlineSvgImages: vi.fn((img) => Promise.resolve(img)),
}))

// Mock NFT services
vi.mock('../../services/nft', () => ({
  resolveTierUri: vi.fn(() => Promise.resolve(null)),
}))

// Mock technicalDetails - need to keep the real implementation for isUsdcCurrency
vi.mock('../../utils/technicalDetails', async () => {
  const actual = await vi.importActual('../../utils/technicalDetails')
  return actual
})

describe('NFTTierCard', () => {
  const baseTier: ResolvedNFTTier = {
    tierId: 1,
    name: 'Test Tier',
    description: 'A test tier',
    imageUri: 'ipfs://QmTest',
    price: 1000000000000000000n, // 1 ETH
    currency: 1, // ETH
    initialSupply: 100,
    remainingSupply: 50,
    reservedRate: 0,
    votingUnits: 0n,
    category: 1,
    allowOwnerMint: false,
    transfersPausable: false,
  }

  const defaultProps = {
    tier: baseTier,
    projectId: '1',
    chainId: 1,
  }

  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    useTransactionStore.setState({ transactions: [] })
    vi.clearAllMocks()
  })

  describe('ETH-based tier pricing', () => {
    it('shows ETH as primary price for currency=1 tier', () => {
      const ethTier = { ...baseTier, currency: 1, price: 500000000000000000n } // 0.5 ETH
      render(<NFTTierCard {...defaultProps} tier={ethTier} />)

      // Should show ETH price
      expect(screen.getByText(/0\.5.*ETH/i)).toBeInTheDocument()
    })

    it('shows USD estimate as secondary for ETH tier when ethPrice provided', () => {
      const ethTier = { ...baseTier, currency: 1, price: 1000000000000000000n } // 1 ETH
      render(<NFTTierCard {...defaultProps} tier={ethTier} ethPrice={2500} />)

      // Should show ETH as primary
      expect(screen.getByText(/1\.0.*ETH/i)).toBeInTheDocument()
      // Should show USD estimate as secondary
      expect(screen.getByText(/~\$2,?500/i)).toBeInTheDocument()
    })
  })

  describe('USD-based tier pricing (currency=2)', () => {
    it('shows USD as primary price for currency=2 tier', () => {
      const usdTier = {
        ...baseTier,
        currency: 2, // Base USD
        price: 5000000n, // $5.00 (6 decimals)
      }
      render(<NFTTierCard {...defaultProps} tier={usdTier} />)

      // Should show USD price as primary
      expect(screen.getByText(/\$5\.00/)).toBeInTheDocument()
    })

    it('shows larger USD prices correctly', () => {
      const usdTier = {
        ...baseTier,
        currency: 2,
        price: 100000000n, // $100.00
      }
      render(<NFTTierCard {...defaultProps} tier={usdTier} />)

      expect(screen.getByText(/\$100\.00/)).toBeInTheDocument()
    })

    it('does not show ETH for USD-based tier', () => {
      const usdTier = {
        ...baseTier,
        currency: 2,
        price: 25000000n, // $25.00
      }
      render(<NFTTierCard {...defaultProps} tier={usdTier} />)

      // Should show USD
      expect(screen.getByText(/\$25\.00/)).toBeInTheDocument()
      // Should NOT show ETH as primary
      const texts = screen.queryAllByText(/ETH/)
      expect(texts.length).toBe(0)
    })
  })

  describe('USDC-based tier pricing (chain-specific currency codes)', () => {
    // Sepolia USDC currency code
    it('shows USD as primary price for Sepolia USDC (909516616)', () => {
      const usdcTier = {
        ...baseTier,
        currency: 909516616, // Sepolia USDC
        price: 10000000n, // $10.00
      }
      render(<NFTTierCard {...defaultProps} tier={usdcTier} />)

      expect(screen.getByText(/\$10\.00/)).toBeInTheDocument()
    })

    // OP Sepolia USDC currency code
    it('shows USD as primary price for OP Sepolia USDC (3530704773)', () => {
      const usdcTier = {
        ...baseTier,
        currency: 3530704773, // OP Sepolia USDC
        price: 15000000n, // $15.00
      }
      render(<NFTTierCard {...defaultProps} tier={usdcTier} />)

      expect(screen.getByText(/\$15\.00/)).toBeInTheDocument()
    })

    // Base Sepolia USDC currency code
    it('shows USD as primary price for Base Sepolia USDC (3169378579)', () => {
      const usdcTier = {
        ...baseTier,
        currency: 3169378579, // Base Sepolia USDC
        price: 20000000n, // $20.00
      }
      render(<NFTTierCard {...defaultProps} tier={usdcTier} />)

      expect(screen.getByText(/\$20\.00/)).toBeInTheDocument()
    })

    // Arb Sepolia USDC currency code
    it('shows USD as primary price for Arb Sepolia USDC (1156540465)', () => {
      const usdcTier = {
        ...baseTier,
        currency: 1156540465, // Arb Sepolia USDC
        price: 50000000n, // $50.00
      }
      render(<NFTTierCard {...defaultProps} tier={usdcTier} />)

      expect(screen.getByText(/\$50\.00/)).toBeInTheDocument()
    })
  })

  describe('compact mode pricing', () => {
    it('shows USD in compact mode for USD-based tier', () => {
      const usdTier = {
        ...baseTier,
        currency: 2,
        price: 5000000n, // $5.00
      }
      render(<NFTTierCard {...defaultProps} tier={usdTier} compact />)

      expect(screen.getByText(/\$5\.00/)).toBeInTheDocument()
    })

    it('shows ETH in compact mode for ETH-based tier', () => {
      const ethTier = {
        ...baseTier,
        currency: 1,
        price: 100000000000000000n, // 0.1 ETH
      }
      render(<NFTTierCard {...defaultProps} tier={ethTier} compact />)

      expect(screen.getByText(/0\.1.*ETH/i)).toBeInTheDocument()
    })
  })

  describe('edge cases', () => {
    it('handles zero price', () => {
      const freeTier = {
        ...baseTier,
        currency: 2,
        price: 0n,
      }
      render(<NFTTierCard {...defaultProps} tier={freeTier} />)

      expect(screen.getByText(/\$0\.00/)).toBeInTheDocument()
    })

    it('handles very small USD prices', () => {
      const cheapTier = {
        ...baseTier,
        currency: 2,
        price: 10000n, // $0.01
      }
      render(<NFTTierCard {...defaultProps} tier={cheapTier} />)

      expect(screen.getByText(/\$0\.01/)).toBeInTheDocument()
    })

    it('handles unknown currency codes as ETH', () => {
      const unknownCurrencyTier = {
        ...baseTier,
        currency: 99999, // Unknown
        price: 1000000000000000000n, // 1 ETH
      }
      render(<NFTTierCard {...defaultProps} tier={unknownCurrencyTier} />)

      // Should fall back to ETH display
      expect(screen.getByText(/1\.0.*ETH/i)).toBeInTheDocument()
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles', () => {
      useThemeStore.setState({ theme: 'dark' })
      const { container } = render(<NFTTierCard {...defaultProps} />)

      expect(container.querySelector('.bg-juice-dark-lighter')).toBeInTheDocument()
    })

    it('applies light theme styles', () => {
      useThemeStore.setState({ theme: 'light' })
      const { container } = render(<NFTTierCard {...defaultProps} />)

      expect(container.querySelector('.bg-white')).toBeInTheDocument()
    })
  })
})
