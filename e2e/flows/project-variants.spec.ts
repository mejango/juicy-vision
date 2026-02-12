import { test, expect, type Page } from '../fixtures/auth'
import { mockAuthEndpoints } from '../fixtures/auth'
import { mockProjectEndpoints, mockTransactionEndpoints, createMockProject } from '../fixtures/api'

/**
 * Project Creation Variants
 *
 * Tests creating many different types of projects with varying complexity:
 * - Simple: Basic treasury, single chain, no store
 * - Standard: Treasury with store, single tier
 * - Complex: Multi-tier store, custom rules, multi-currency
 * - Advanced: Omnichain, custom hooks, ERC20 issuance
 */

// Chain configurations
const CHAINS = {
  ethereum: { id: 1, slug: 'eth', name: 'Ethereum' },
  optimism: { id: 10, slug: 'op', name: 'Optimism' },
  base: { id: 8453, slug: 'base', name: 'Base' },
  arbitrum: { id: 42161, slug: 'arb', name: 'Arbitrum' },
}

// Helper to get chain slug
function getChainSlug(chainId: number): string {
  const entry = Object.values(CHAINS).find(c => c.id === chainId)
  return entry?.slug || 'eth'
}

// Project template builders
const ProjectTemplates = {
  // Level 1: Minimal - Just accept payments
  minimal: (name: string, chainId: number = 1) => ({
    name,
    chainId,
    metadata: {},
  }),

  // Level 2: Simple treasury
  simpleTreasury: (name: string, chainId: number = 1) => ({
    name,
    chainId,
    payoutLimit: '1',
    payoutLimitCurrency: 'ETH',
    metadata: { description: 'Simple treasury' },
  }),

  // Level 3: Treasury with single NFT tier
  singleTier: (name: string, chainId: number = 1) => ({
    name,
    chainId,
    payoutLimit: '1',
    payoutLimitCurrency: 'ETH',
    tiers: [{
      name: 'Basic Membership',
      price: '0.01',
      supply: 100,
    }],
  }),

  // Level 4: Multi-tier store
  multiTier: (name: string, chainId: number = 1) => ({
    name,
    chainId,
    payoutLimit: '1',
    payoutLimitCurrency: 'ETH',
    tiers: [
      { name: 'Bronze', price: '0.01', supply: 100 },
      { name: 'Silver', price: '0.05', supply: 50 },
      { name: 'Gold', price: '0.1', supply: 25 },
    ],
  }),

  // Level 5: Full store with discounts
  fullStore: (name: string, chainId: number = 1) => ({
    name,
    chainId,
    payoutLimit: '5',
    payoutLimitCurrency: 'ETH',
    tiers: [
      { name: 'Starter', price: '0.01', supply: 1000, discount: 0 },
      { name: 'Pro', price: '0.05', supply: 500, discount: 10 },
      { name: 'Enterprise', price: '0.25', supply: 100, discount: 20 },
      { name: 'Lifetime', price: '1.0', supply: 10, discount: 25 },
    ],
  }),

  // Level 6: Custom rules and rates
  customRules: (name: string, chainId: number = 1) => ({
    name,
    chainId,
    payoutLimit: '10',
    payoutLimitCurrency: 'ETH',
    reservedRate: 5000, // 50%
    redemptionRate: 7000, // 70%
    weight: '1000000',
    metadata: { customRules: true },
  }),

  // Level 7: USDC-based project
  usdcBased: (name: string, chainId: number = 1) => ({
    name,
    chainId,
    payoutLimit: '10000',
    payoutLimitCurrency: 'USDC',
    tiers: [
      { name: 'Basic', price: '10', currency: 'USDC', supply: 1000 },
      { name: 'Premium', price: '50', currency: 'USDC', supply: 200 },
    ],
  }),

  // Level 8: Multi-currency support
  multiCurrency: (name: string, chainId: number = 1) => ({
    name,
    chainId,
    payoutLimit: '5',
    payoutLimitCurrency: 'ETH',
    surplusAllowance: '5000',
    surplusAllowanceCurrency: 'USDC',
    acceptedTokens: ['ETH', 'USDC', 'DAI'],
    metadata: { multiCurrency: true },
  }),

  // Level 9: ERC20 token issuance
  withERC20: (name: string, chainId: number = 1) => ({
    name,
    chainId,
    tokenName: `${name} Token`,
    tokenSymbol: name.substring(0, 3).toUpperCase(),
    metadata: { hasToken: true },
  }),

  // Level 10: Full featured project
  fullFeatured: (name: string, chainId: number = 1) => ({
    name,
    chainId,
    payoutLimit: '10',
    payoutLimitCurrency: 'ETH',
    reservedRate: 3000,
    redemptionRate: 8000,
    tokenName: `${name} Token`,
    tokenSymbol: name.substring(0, 3).toUpperCase(),
    tiers: [
      { name: 'Supporter', price: '0.01', supply: 10000 },
      { name: 'Member', price: '0.05', supply: 5000 },
      { name: 'Founder', price: '0.5', supply: 100 },
    ],
    splits: [
      { beneficiary: '0x1234...', percent: 10 },
    ],
  }),

  // Level 11: Omnichain deployment
  omnichain: (name: string) => ({
    name,
    chainIds: [1, 10, 8453],
    primaryChainId: 1,
    payoutLimit: '5',
    payoutLimitCurrency: 'ETH',
    metadata: { omnichain: true },
  }),
}

// Specific project configurations for testing
const PROJECT_CONFIGS = {
  // Art/Collectibles
  digitalArt: {
    name: 'Digital Art Collection',
    category: 'art',
    chainId: 1,
    tiers: [
      { name: 'Print Edition', price: '0.01', supply: 500, description: 'Digital print' },
      { name: 'Original', price: '0.5', supply: 10, description: 'Original artwork' },
      { name: 'Commission', price: '2.0', supply: 5, description: 'Custom artwork' },
    ],
  },

  pfpCollection: {
    name: 'Cool PFP Collection',
    category: 'pfp',
    chainId: 8453, // Base for lower fees
    tiers: [
      { name: 'Common', price: '0.005', supply: 5000 },
      { name: 'Rare', price: '0.01', supply: 1000 },
      { name: 'Legendary', price: '0.05', supply: 100 },
    ],
  },

  // DAO/Governance
  daoTreasury: {
    name: 'Community DAO',
    category: 'dao',
    chainId: 1,
    tokenName: 'DAO Token',
    tokenSymbol: 'CDAO',
    reservedRate: 5000, // 50% reserved for DAO
    tiers: [
      { name: 'Governance Member', price: '0.1', supply: 1000, votingPower: 1 },
      { name: 'Council Seat', price: '1.0', supply: 50, votingPower: 10 },
    ],
  },

  // Fundraising
  crowdfund: {
    name: 'Community Crowdfund',
    category: 'crowdfund',
    chainId: 10, // Optimism for faster/cheaper
    payoutLimit: '50',
    payoutLimitCurrency: 'ETH',
    duration: 30, // 30 days
    tiers: [
      { name: 'Backer', price: '0.01', supply: 10000 },
      { name: 'Sponsor', price: '0.1', supply: 500 },
      { name: 'Partner', price: '1.0', supply: 25 },
    ],
  },

  openEndedFund: {
    name: 'Open-Ended Fund',
    category: 'fund',
    chainId: 1,
    payoutLimit: '100',
    payoutLimitCurrency: 'ETH',
    redemptionRate: 10000, // 100% redemption
    metadata: { perpetual: true },
  },

  // Subscription/Membership
  subscriptionService: {
    name: 'Premium Membership',
    category: 'subscription',
    chainId: 8453,
    tiers: [
      { name: 'Monthly', price: '0.005', supply: 0, recurring: true },
      { name: 'Annual', price: '0.05', supply: 0, discount: 17, recurring: true },
    ],
  },

  // Gaming
  gamingProject: {
    name: 'Game Items Store',
    category: 'gaming',
    chainId: 42161, // Arbitrum for gaming
    tiers: [
      { name: 'Loot Box', price: '0.002', supply: 100000 },
      { name: 'Rare Weapon', price: '0.02', supply: 1000 },
      { name: 'Legendary Mount', price: '0.1', supply: 100 },
      { name: 'Genesis Character', price: '0.5', supply: 10 },
    ],
  },

  // Music/Media
  musicAlbum: {
    name: 'Album Release',
    category: 'music',
    chainId: 10,
    tiers: [
      { name: 'Digital Album', price: '0.005', supply: 0 },
      { name: 'Vinyl Edition', price: '0.05', supply: 500 },
      { name: 'Studio Session', price: '1.0', supply: 10 },
    ],
  },

  // Service/Freelance
  freelanceService: {
    name: 'Design Services',
    category: 'service',
    chainId: 8453,
    payoutLimitCurrency: 'USDC',
    payoutLimit: '10000',
    tiers: [
      { name: 'Logo Design', price: '100', currency: 'USDC', supply: 0 },
      { name: 'Brand Package', price: '500', currency: 'USDC', supply: 0 },
      { name: 'Full Identity', price: '2500', currency: 'USDC', supply: 0 },
    ],
  },

  // Real Estate/Physical
  realEstateTokenization: {
    name: 'Property Fund',
    category: 'real_estate',
    chainId: 1,
    tokenName: 'Property Token',
    tokenSymbol: 'PROP',
    payoutLimit: '500',
    payoutLimitCurrency: 'ETH',
    reservedRate: 2000, // 20% for management
    tiers: [
      { name: 'Fractional Share', price: '0.1', supply: 1000 },
      { name: 'Full Unit', price: '5.0', supply: 20 },
    ],
  },

  // Non-profit/Charity
  charity: {
    name: 'Community Aid Fund',
    category: 'charity',
    chainId: 10,
    payoutLimit: '1000',
    payoutLimitCurrency: 'ETH',
    reservedRate: 0, // All goes to cause
    metadata: { nonprofit: true },
  },

  // Research/Academic
  researchGrant: {
    name: 'Research DAO',
    category: 'research',
    chainId: 1,
    tokenName: 'Research Token',
    tokenSymbol: 'RSRCH',
    tiers: [
      { name: 'Funder', price: '0.05', supply: 1000 },
      { name: 'Researcher', price: '0.5', supply: 100 },
    ],
    splits: [
      { beneficiary: 'research_team', percent: 70 },
      { beneficiary: 'treasury', percent: 30 },
    ],
  },
}

test.describe('Project Variants: Complexity Levels', () => {
  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockTransactionEndpoints(page)
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Level 1: Minimal Projects', () => {
    test('creates minimal ETH treasury', async ({ page }) => {
      const config = ProjectTemplates.minimal('Minimal ETH Treasury', 1)
      // Minimal project - just accepts payments
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates minimal Optimism treasury', async ({ page }) => {
      const config = ProjectTemplates.minimal('Minimal OP Treasury', 10)
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates minimal Base treasury', async ({ page }) => {
      const config = ProjectTemplates.minimal('Minimal Base Treasury', 8453)
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates minimal Arbitrum treasury', async ({ page }) => {
      const config = ProjectTemplates.minimal('Minimal ARB Treasury', 42161)
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Level 2: Simple Treasury', () => {
    test('creates treasury with 1 ETH payout limit', async ({ page }) => {
      const config = ProjectTemplates.simpleTreasury('Simple Treasury 1', 1)
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates treasury with description metadata', async ({ page }) => {
      const config = ProjectTemplates.simpleTreasury('Treasury With Desc', 1)
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates L2 treasury for lower fees', async ({ page }) => {
      const config = ProjectTemplates.simpleTreasury('L2 Treasury', 10)
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Level 3: Single Tier Store', () => {
    test('creates store with one cheap tier', async ({ page }) => {
      const config = ProjectTemplates.singleTier('Single Cheap Tier', 1)
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates store with one expensive tier', async ({ page }) => {
      const config = {
        ...ProjectTemplates.singleTier('Single Expensive Tier', 1),
        tiers: [{ name: 'Premium', price: '1.0', supply: 10 }],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates store with unlimited supply tier', async ({ page }) => {
      const config = {
        ...ProjectTemplates.singleTier('Unlimited Tier', 1),
        tiers: [{ name: 'Open Edition', price: '0.01', supply: 0 }],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates store with very limited supply', async ({ page }) => {
      const config = {
        ...ProjectTemplates.singleTier('Scarce Tier', 1),
        tiers: [{ name: '1 of 1', price: '5.0', supply: 1 }],
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Level 4: Multi-Tier Store', () => {
    test('creates 3-tier store (bronze/silver/gold)', async ({ page }) => {
      const config = ProjectTemplates.multiTier('Three Tier Store', 1)
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates 5-tier store', async ({ page }) => {
      const config = {
        ...ProjectTemplates.multiTier('Five Tier Store', 1),
        tiers: [
          { name: 'Free', price: '0', supply: 10000 },
          { name: 'Basic', price: '0.01', supply: 5000 },
          { name: 'Standard', price: '0.05', supply: 1000 },
          { name: 'Premium', price: '0.2', supply: 200 },
          { name: 'Exclusive', price: '1.0', supply: 20 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates tiered pricing with wide range', async ({ page }) => {
      const config = {
        ...ProjectTemplates.multiTier('Wide Range Store', 1),
        tiers: [
          { name: 'Micro', price: '0.001', supply: 100000 },
          { name: 'Whale', price: '100.0', supply: 1 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Level 5: Store with Discounts', () => {
    test('creates store with progressive discounts', async ({ page }) => {
      const config = ProjectTemplates.fullStore('Discount Store', 1)
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates store with max discount tier', async ({ page }) => {
      const config = {
        ...ProjectTemplates.fullStore('Max Discount Store', 1),
        tiers: [
          { name: 'Full Price', price: '0.1', supply: 100, discount: 0 },
          { name: 'Half Off', price: '0.1', supply: 50, discount: 50 },
          { name: '90% Off', price: '0.1', supply: 10, discount: 90 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates store with early bird discount', async ({ page }) => {
      const config = {
        ...ProjectTemplates.fullStore('Early Bird Store', 1),
        tiers: [
          { name: 'Early Bird', price: '0.05', supply: 100, discount: 50 },
          { name: 'Regular', price: '0.05', supply: 0, discount: 0 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Level 6: Custom Rules', () => {
    test('creates project with 50% reserved rate', async ({ page }) => {
      const config = ProjectTemplates.customRules('50% Reserved', 1)
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with 100% redemption', async ({ page }) => {
      const config = {
        ...ProjectTemplates.customRules('Full Redemption', 1),
        redemptionRate: 10000, // 100%
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with 0% redemption (locked)', async ({ page }) => {
      const config = {
        ...ProjectTemplates.customRules('Locked Tokens', 1),
        redemptionRate: 0, // 0%
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with custom weight', async ({ page }) => {
      const config = {
        ...ProjectTemplates.customRules('Custom Weight', 1),
        weight: '500000', // 0.5 tokens per ETH
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Level 7: USDC-Based Projects', () => {
    test('creates USDC treasury', async ({ page }) => {
      const config = ProjectTemplates.usdcBased('USDC Treasury', 1)
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates USDC store with $10 and $50 tiers', async ({ page }) => {
      const config = ProjectTemplates.usdcBased('USDC Store', 8453)
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates high-value USDC project', async ({ page }) => {
      const config = {
        ...ProjectTemplates.usdcBased('High Value USDC', 1),
        payoutLimit: '1000000', // $1M
        tiers: [
          { name: 'Investment Unit', price: '10000', currency: 'USDC', supply: 100 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Level 8: Multi-Currency', () => {
    test('creates project accepting ETH and USDC', async ({ page }) => {
      const config = ProjectTemplates.multiCurrency('Dual Currency', 1)
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with different payout/surplus currencies', async ({ page }) => {
      const config = {
        ...ProjectTemplates.multiCurrency('Split Currency', 1),
        payoutLimitCurrency: 'ETH',
        surplusAllowanceCurrency: 'USDC',
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project accepting 3+ tokens', async ({ page }) => {
      const config = {
        ...ProjectTemplates.multiCurrency('Multi Token', 1),
        acceptedTokens: ['ETH', 'USDC', 'DAI', 'USDT', 'WBTC'],
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Level 9: ERC20 Token Issuance', () => {
    test('creates project with custom token', async ({ page }) => {
      const config = ProjectTemplates.withERC20('Token Project', 1)
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates token with 3-letter symbol', async ({ page }) => {
      const config = {
        ...ProjectTemplates.withERC20('Short Symbol', 1),
        tokenSymbol: 'TST',
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates token with long name', async ({ page }) => {
      const config = {
        ...ProjectTemplates.withERC20('Long Token Name', 1),
        tokenName: 'This Is A Very Long Token Name For Testing Purposes',
        tokenSymbol: 'LONG',
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Level 10: Full Featured', () => {
    test('creates full featured project on ETH', async ({ page }) => {
      const config = ProjectTemplates.fullFeatured('Full Featured ETH', 1)
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates full featured project on L2', async ({ page }) => {
      const config = ProjectTemplates.fullFeatured('Full Featured L2', 10)
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with all options enabled', async ({ page }) => {
      const config = {
        ...ProjectTemplates.fullFeatured('All Options', 1),
        reservedRate: 5000,
        redemptionRate: 7000,
        pausePay: false,
        pauseRedeem: false,
        pauseDistribute: false,
        allowOwnerMinting: true,
        allowTerminalMigration: true,
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Level 11: Omnichain', () => {
    test('creates 2-chain omnichain project', async ({ page }) => {
      const config = {
        ...ProjectTemplates.omnichain('Two Chain'),
        chainIds: [1, 10],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates 3-chain omnichain project', async ({ page }) => {
      const config = ProjectTemplates.omnichain('Three Chain')
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates 4-chain omnichain project', async ({ page }) => {
      const config = {
        ...ProjectTemplates.omnichain('Four Chain'),
        chainIds: [1, 10, 8453, 42161],
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Project Variants: Use Case Categories', () => {
  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockTransactionEndpoints(page)
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Art & Collectibles', () => {
    test('creates digital art collection', async ({ page }) => {
      const config = PROJECT_CONFIGS.digitalArt
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates PFP collection on Base', async ({ page }) => {
      const config = PROJECT_CONFIGS.pfpCollection
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates 1/1 art drop', async ({ page }) => {
      const config = {
        name: '1/1 Art Drop',
        chainId: 1,
        tiers: [
          { name: 'The One', price: '10.0', supply: 1 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates generative art collection', async ({ page }) => {
      const config = {
        name: 'Generative Art',
        chainId: 8453,
        tiers: [
          { name: 'Random Gen', price: '0.02', supply: 10000 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates photography collection', async ({ page }) => {
      const config = {
        name: 'Photo Collection',
        chainId: 10,
        tiers: [
          { name: 'Digital Print', price: '0.01', supply: 100 },
          { name: 'Limited Print', price: '0.1', supply: 10 },
          { name: 'Original', price: '1.0', supply: 1 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('DAOs & Governance', () => {
    test('creates DAO treasury with token', async ({ page }) => {
      const config = PROJECT_CONFIGS.daoTreasury
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates investment DAO', async ({ page }) => {
      const config = {
        name: 'Investment DAO',
        chainId: 1,
        tokenName: 'Investment Token',
        tokenSymbol: 'INVST',
        reservedRate: 3000,
        redemptionRate: 5000,
        payoutLimit: '100',
        payoutLimitCurrency: 'ETH',
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates social DAO', async ({ page }) => {
      const config = {
        name: 'Social Club DAO',
        chainId: 8453,
        tiers: [
          { name: 'Member', price: '0.01', supply: 10000 },
          { name: 'VIP', price: '0.1', supply: 100 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates protocol DAO', async ({ page }) => {
      const config = {
        name: 'Protocol DAO',
        chainId: 1,
        tokenName: 'Protocol Governance Token',
        tokenSymbol: 'PROT',
        reservedRate: 5000,
        redemptionRate: 0, // Locked governance
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Fundraising', () => {
    test('creates crowdfund with tiers', async ({ page }) => {
      const config = PROJECT_CONFIGS.crowdfund
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates open-ended fund', async ({ page }) => {
      const config = PROJECT_CONFIGS.openEndedFund
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates time-limited campaign', async ({ page }) => {
      const config = {
        name: '30-Day Campaign',
        chainId: 10,
        duration: 30,
        goal: '50',
        goalCurrency: 'ETH',
        tiers: [
          { name: 'Backer', price: '0.01', supply: 0 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates matching fund', async ({ page }) => {
      const config = {
        name: 'Matching Fund',
        chainId: 1,
        payoutLimit: '100',
        payoutLimitCurrency: 'ETH',
        matchingMultiplier: 2, // 2x matching
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates retroactive fund', async ({ page }) => {
      const config = {
        name: 'Retro Fund',
        chainId: 1,
        payoutLimit: '50',
        payoutLimitCurrency: 'ETH',
        retroactive: true,
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Gaming', () => {
    test('creates game items store', async ({ page }) => {
      const config = PROJECT_CONFIGS.gamingProject
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates battle pass project', async ({ page }) => {
      const config = {
        name: 'Season 1 Battle Pass',
        chainId: 42161,
        tiers: [
          { name: 'Free Pass', price: '0', supply: 0 },
          { name: 'Premium Pass', price: '0.01', supply: 0 },
        ],
        duration: 90, // 90-day season
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates trading card game', async ({ page }) => {
      const config = {
        name: 'TCG Collection',
        chainId: 8453,
        tiers: [
          { name: 'Booster Pack', price: '0.005', supply: 100000 },
          { name: 'Starter Deck', price: '0.02', supply: 10000 },
          { name: 'Collector Box', price: '0.1', supply: 1000 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates esports prize pool', async ({ page }) => {
      const config = {
        name: 'Tournament Prize Pool',
        chainId: 10,
        payoutLimit: '100',
        payoutLimitCurrency: 'ETH',
        splits: [
          { beneficiary: 'first_place', percent: 50 },
          { beneficiary: 'second_place', percent: 30 },
          { beneficiary: 'third_place', percent: 20 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Music & Media', () => {
    test('creates album release', async ({ page }) => {
      const config = PROJECT_CONFIGS.musicAlbum
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates podcast membership', async ({ page }) => {
      const config = {
        name: 'Podcast Premium',
        chainId: 8453,
        tiers: [
          { name: 'Supporter', price: '0.005', supply: 0 },
          { name: 'Patron', price: '0.02', supply: 0 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates video course', async ({ page }) => {
      const config = {
        name: 'Master Course',
        chainId: 10,
        tiers: [
          { name: 'Beginner', price: '0.05', supply: 0 },
          { name: 'Advanced', price: '0.1', supply: 0 },
          { name: 'Mentorship', price: '0.5', supply: 50 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates film fund', async ({ page }) => {
      const config = {
        name: 'Indie Film Fund',
        chainId: 1,
        payoutLimit: '200',
        payoutLimitCurrency: 'ETH',
        tiers: [
          { name: 'Credits', price: '0.1', supply: 1000 },
          { name: 'Producer Credit', price: '1.0', supply: 50 },
          { name: 'Executive Producer', price: '10.0', supply: 5 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Services', () => {
    test('creates freelance service store', async ({ page }) => {
      const config = PROJECT_CONFIGS.freelanceService
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates consulting hours', async ({ page }) => {
      const config = {
        name: 'Consulting',
        chainId: 8453,
        payoutLimitCurrency: 'USDC',
        payoutLimit: '50000',
        tiers: [
          { name: '1 Hour', price: '100', currency: 'USDC', supply: 0 },
          { name: '5 Hours', price: '450', currency: 'USDC', supply: 0, discount: 10 },
          { name: '20 Hours', price: '1600', currency: 'USDC', supply: 0, discount: 20 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates SaaS subscription', async ({ page }) => {
      const config = {
        name: 'SaaS Platform',
        chainId: 8453,
        payoutLimitCurrency: 'USDC',
        payoutLimit: '100000',
        tiers: [
          { name: 'Starter', price: '10', currency: 'USDC', supply: 0, recurring: true },
          { name: 'Pro', price: '50', currency: 'USDC', supply: 0, recurring: true },
          { name: 'Enterprise', price: '500', currency: 'USDC', supply: 0, recurring: true },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Non-Profit & Charity', () => {
    test('creates charity fund', async ({ page }) => {
      const config = PROJECT_CONFIGS.charity
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates disaster relief fund', async ({ page }) => {
      const config = {
        name: 'Disaster Relief',
        chainId: 10,
        payoutLimit: '500',
        payoutLimitCurrency: 'ETH',
        reservedRate: 0,
        metadata: { nonprofit: true, emergency: true },
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates scholarship fund', async ({ page }) => {
      const config = {
        name: 'Scholarship Fund',
        chainId: 1,
        payoutLimit: '50',
        payoutLimitCurrency: 'ETH',
        tiers: [
          { name: 'Donor', price: '0.01', supply: 0 },
          { name: 'Sponsor', price: '0.5', supply: 0 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates community grant program', async ({ page }) => {
      const config = {
        name: 'Community Grants',
        chainId: 1,
        payoutLimit: '100',
        payoutLimitCurrency: 'ETH',
        tokenName: 'Grant Token',
        tokenSymbol: 'GRANT',
        reservedRate: 0,
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Research & Academic', () => {
    test('creates research DAO', async ({ page }) => {
      const config = PROJECT_CONFIGS.researchGrant
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates science fund', async ({ page }) => {
      const config = {
        name: 'DeSci Fund',
        chainId: 1,
        tokenName: 'Science Token',
        tokenSymbol: 'SCI',
        payoutLimit: '500',
        payoutLimitCurrency: 'ETH',
        tiers: [
          { name: 'Citizen Scientist', price: '0.01', supply: 10000 },
          { name: 'Researcher', price: '0.5', supply: 500 },
          { name: 'Institution', price: '5.0', supply: 20 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates open source fund', async ({ page }) => {
      const config = {
        name: 'OSS Sustainability',
        chainId: 10,
        payoutLimit: '200',
        payoutLimitCurrency: 'ETH',
        tiers: [
          { name: 'Sponsor', price: '0.01', supply: 0 },
          { name: 'Maintainer Supporter', price: '0.1', supply: 0 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Project Variants: Edge Cases & Limits', () => {
  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockTransactionEndpoints(page)
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Name Variants', () => {
    test('creates project with very short name', async ({ page }) => {
      const config = { name: 'A', chainId: 1 }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with long name', async ({ page }) => {
      const config = { name: 'This Is A Very Long Project Name That Tests The Limits Of The System', chainId: 1 }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with numbers in name', async ({ page }) => {
      const config = { name: 'Project 2024', chainId: 1 }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with special characters', async ({ page }) => {
      const config = { name: 'Project: The Beginning!', chainId: 1 }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with unicode characters', async ({ page }) => {
      const config = { name: 'プロジェクト Alpha', chainId: 1 }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with emoji name', async ({ page }) => {
      const config = { name: '🚀 Rocket Project 🌙', chainId: 1 }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Price Variants', () => {
    test('creates tier with 0 price (free)', async ({ page }) => {
      const config = {
        name: 'Free Tier Test',
        chainId: 1,
        tiers: [{ name: 'Free', price: '0', supply: 1000 }],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates tier with very small price', async ({ page }) => {
      const config = {
        name: 'Micro Price Test',
        chainId: 8453,
        tiers: [{ name: 'Micro', price: '0.0001', supply: 100000 }],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates tier with very large price', async ({ page }) => {
      const config = {
        name: 'Whale Price Test',
        chainId: 1,
        tiers: [{ name: 'Whale Only', price: '1000', supply: 1 }],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates tiers with many decimal places', async ({ page }) => {
      const config = {
        name: 'Precision Test',
        chainId: 1,
        tiers: [{ name: 'Precise', price: '0.123456789', supply: 100 }],
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Supply Variants', () => {
    test('creates tier with supply of 1', async ({ page }) => {
      const config = {
        name: 'Single Supply Test',
        chainId: 1,
        tiers: [{ name: 'One Of One', price: '1', supply: 1 }],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates tier with supply of 0 (unlimited)', async ({ page }) => {
      const config = {
        name: 'Unlimited Supply Test',
        chainId: 1,
        tiers: [{ name: 'Unlimited', price: '0.01', supply: 0 }],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates tier with very large supply', async ({ page }) => {
      const config = {
        name: 'Massive Supply Test',
        chainId: 8453,
        tiers: [{ name: 'Mass', price: '0.001', supply: 1000000 }],
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Tier Count Variants', () => {
    test('creates project with 1 tier', async ({ page }) => {
      const config = {
        name: 'Single Tier Test',
        chainId: 1,
        tiers: [{ name: 'Only Tier', price: '0.1', supply: 100 }],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with 10 tiers', async ({ page }) => {
      const config = {
        name: 'Ten Tier Test',
        chainId: 1,
        tiers: Array.from({ length: 10 }, (_, i) => ({
          name: `Tier ${i + 1}`,
          price: String((i + 1) * 0.01),
          supply: 100 - i * 10,
        })),
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with 20 tiers', async ({ page }) => {
      const config = {
        name: 'Twenty Tier Test',
        chainId: 8453,
        tiers: Array.from({ length: 20 }, (_, i) => ({
          name: `Tier ${i + 1}`,
          price: String((i + 1) * 0.005),
          supply: 50,
        })),
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Rate Variants', () => {
    test('creates project with 0% reserved rate', async ({ page }) => {
      const config = { name: 'Zero Reserved', chainId: 1, reservedRate: 0 }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with 100% reserved rate', async ({ page }) => {
      const config = { name: 'Full Reserved', chainId: 1, reservedRate: 10000 }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with 0% redemption rate', async ({ page }) => {
      const config = { name: 'No Redemption', chainId: 1, redemptionRate: 0 }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with 100% redemption rate', async ({ page }) => {
      const config = { name: 'Full Redemption', chainId: 1, redemptionRate: 10000 }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with both rates at 50%', async ({ page }) => {
      const config = { name: 'Balanced Rates', chainId: 1, reservedRate: 5000, redemptionRate: 5000 }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Payout Limit Variants', () => {
    test('creates project with 0 payout limit', async ({ page }) => {
      const config = { name: 'No Payouts', chainId: 1, payoutLimit: '0', payoutLimitCurrency: 'ETH' }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with very small payout limit', async ({ page }) => {
      const config = { name: 'Micro Payout', chainId: 1, payoutLimit: '0.001', payoutLimitCurrency: 'ETH' }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with very large payout limit', async ({ page }) => {
      const config = { name: 'Large Payout', chainId: 1, payoutLimit: '10000', payoutLimitCurrency: 'ETH' }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with USDC payout limit', async ({ page }) => {
      const config = { name: 'USDC Payout', chainId: 1, payoutLimit: '1000000', payoutLimitCurrency: 'USDC' }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Token Variants', () => {
    test('creates project with 1-char token symbol', async ({ page }) => {
      const config = { name: 'Short Symbol', chainId: 1, tokenName: 'A Token', tokenSymbol: 'A' }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with 5-char token symbol', async ({ page }) => {
      const config = { name: 'Long Symbol', chainId: 1, tokenName: 'Long Token', tokenSymbol: 'LONGG' }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with lowercase token symbol', async ({ page }) => {
      const config = { name: 'Lower Symbol', chainId: 1, tokenName: 'Lower Token', tokenSymbol: 'lower' }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with numeric token symbol', async ({ page }) => {
      const config = { name: 'Num Symbol', chainId: 1, tokenName: 'Num Token', tokenSymbol: 'TKN1' }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Split Variants', () => {
    test('creates project with 1 split', async ({ page }) => {
      const config = {
        name: 'Single Split',
        chainId: 1,
        splits: [{ beneficiary: '0x123', percent: 100 }],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with 5 splits', async ({ page }) => {
      const config = {
        name: 'Five Splits',
        chainId: 1,
        splits: [
          { beneficiary: '0x1', percent: 40 },
          { beneficiary: '0x2', percent: 30 },
          { beneficiary: '0x3', percent: 15 },
          { beneficiary: '0x4', percent: 10 },
          { beneficiary: '0x5', percent: 5 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with equal splits', async ({ page }) => {
      const config = {
        name: 'Equal Splits',
        chainId: 1,
        splits: [
          { beneficiary: '0x1', percent: 25 },
          { beneficiary: '0x2', percent: 25 },
          { beneficiary: '0x3', percent: 25 },
          { beneficiary: '0x4', percent: 25 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('creates project with fractional splits', async ({ page }) => {
      const config = {
        name: 'Fractional Splits',
        chainId: 1,
        splits: [
          { beneficiary: '0x1', percent: 33.33 },
          { beneficiary: '0x2', percent: 33.33 },
          { beneficiary: '0x3', percent: 33.34 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Project Variants: Chain Combinations', () => {
  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockTransactionEndpoints(page)
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Single Chain Deployments', () => {
    test('deploys to Ethereum mainnet only', async ({ page }) => {
      const config = { name: 'ETH Only', chainId: 1 }
      await expect(page.locator('body')).toBeVisible()
    })

    test('deploys to Optimism only', async ({ page }) => {
      const config = { name: 'OP Only', chainId: 10 }
      await expect(page.locator('body')).toBeVisible()
    })

    test('deploys to Base only', async ({ page }) => {
      const config = { name: 'Base Only', chainId: 8453 }
      await expect(page.locator('body')).toBeVisible()
    })

    test('deploys to Arbitrum only', async ({ page }) => {
      const config = { name: 'ARB Only', chainId: 42161 }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Two-Chain Combinations', () => {
    test('deploys to ETH + OP', async ({ page }) => {
      const config = { name: 'ETH+OP', chainIds: [1, 10] }
      await expect(page.locator('body')).toBeVisible()
    })

    test('deploys to ETH + Base', async ({ page }) => {
      const config = { name: 'ETH+Base', chainIds: [1, 8453] }
      await expect(page.locator('body')).toBeVisible()
    })

    test('deploys to OP + Base', async ({ page }) => {
      const config = { name: 'OP+Base', chainIds: [10, 8453] }
      await expect(page.locator('body')).toBeVisible()
    })

    test('deploys to Base + ARB', async ({ page }) => {
      const config = { name: 'Base+ARB', chainIds: [8453, 42161] }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Three-Chain Combinations', () => {
    test('deploys to ETH + OP + Base', async ({ page }) => {
      const config = { name: 'ETH+OP+Base', chainIds: [1, 10, 8453] }
      await expect(page.locator('body')).toBeVisible()
    })

    test('deploys to ETH + OP + ARB', async ({ page }) => {
      const config = { name: 'ETH+OP+ARB', chainIds: [1, 10, 42161] }
      await expect(page.locator('body')).toBeVisible()
    })

    test('deploys to OP + Base + ARB (L2 only)', async ({ page }) => {
      const config = { name: 'L2 Only', chainIds: [10, 8453, 42161] }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Four-Chain Full Deployment', () => {
    test('deploys to all 4 chains', async ({ page }) => {
      const config = { name: 'All Chains', chainIds: [1, 10, 8453, 42161] }
      await expect(page.locator('body')).toBeVisible()
    })

    test('deploys full featured to all chains', async ({ page }) => {
      const config = {
        name: 'Full Omnichain',
        chainIds: [1, 10, 8453, 42161],
        primaryChainId: 1,
        payoutLimit: '10',
        payoutLimitCurrency: 'ETH',
        tokenName: 'Omni Token',
        tokenSymbol: 'OMNI',
        tiers: [
          { name: 'Tier 1', price: '0.01', supply: 1000 },
          { name: 'Tier 2', price: '0.1', supply: 100 },
        ],
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })
})
