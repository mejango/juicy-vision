import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { encodeAbiParameters } from 'viem'
import ProjectCard from './ProjectCard'
import { useThemeStore, useTransactionStore } from '../../stores'
import * as bendystraw from '../../services/bendystraw'
import {
  fmtCountdown,
  formatExactTokenEstimate,
  isVerifiedZeroIssuance,
  probeRouterPayRoute,
  readPayScheduleGate,
  resolveDirectSwapOffer,
  uniswapPoolLink,
} from '../../services/payPreviewCard'

const { mockReadContract, mockGetPaymentTerminal } = vi.hoisted(() => ({
  mockReadContract: vi.fn(),
  mockGetPaymentTerminal: vi.fn(),
}))

vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    address: undefined,
    isConnected: false,
  })),
}))

// Keep real viem encode/decode/parse behavior; only fake the RPC client.
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getBalance: vi.fn().mockResolvedValue(0n),
      readContract: mockReadContract,
    })),
    http: vi.fn(),
  }
})

vi.mock('../../services/bendystraw', () => ({
  fetchProject: vi.fn(),
  fetchConnectedChains: vi.fn(),
  fetchSuckerGroupBalance: vi.fn(),
  fetchOwnersCount: vi.fn(),
  fetchProjectTokenSymbol: vi.fn(),
  fetchProjectAccountingContexts: vi.fn(),
  fetchEthPrice: vi.fn(),
}))

const NATIVE = '0x000000000000000000000000000000000000EEEe'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const MULTI_TERMINAL = '0x130f5Dd2bD8805443Cf41755253D778a75a67f53'
const ROUTER_REGISTRY = '0xE0427f250FdB0379c8e98E884ee4570521208Cbc'
const BUYBACK_HOOK = '0x77bee1ad2ac0ace98a9b5b58d75685c8b4d94948'

vi.mock('../../utils/paymentTerminal', () => ({
  getPaymentTokenAddress: vi.fn((token: string) => (token === 'ETH'
    ? '0x000000000000000000000000000000000000EEEe'
    : '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')),
  getPaymentTerminal: mockGetPaymentTerminal,
}))

vi.mock('../../utils/projectTrust', () => ({
  assertCurrentProjectPayConfigurationTrusted: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../services/nft', () => ({
  getProjectDataHook: vi.fn().mockResolvedValue(null),
  fetchResolvedNFTTiers: vi.fn().mockResolvedValue([]),
  fetchHookFlags: vi.fn().mockResolvedValue(null),
  getEffectiveTierPrice: vi.fn(),
  resolveTierUri: vi.fn(),
  requireRecognized721HookIdentity: vi.fn(),
}))

vi.mock('../../utils/ipfs', () => ({
  resolveIpfsUri: vi.fn((uri) => (uri ? `https://ipfs.io/${uri}` : null)),
  ipfsGatewayUrls: vi.fn((uri) => (uri ? [`https://ipfs.io/${uri}`] : [])),
  fetchIpfsMetadata: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../hooks/useWalletBalances', () => ({
  useWalletBalances: vi.fn(() => ({
    totalEth: 0n,
    totalUsdc: 0n,
    perChain: [],
    loading: false,
    available: false,
  })),
  formatEthBalance: vi.fn(() => '0'),
  formatUsdcBalance: vi.fn(() => '0'),
}))

vi.mock('../../hooks', () => ({
  useManagedWallet: vi.fn(() => ({
    address: '0x1234567890123456789012345678901234567890',
    isLoading: false,
  })),
}))

// Exact abi.encode order/types from JBBuybackHook's beforePayRecordedWith metadata.
const BUYBACK_PAY_METADATA = [
  { name: 'projectTokenIs0', type: 'bool' },
  { name: 'amountToMintWith', type: 'uint256' },
  { name: 'minimumSwapAmountOut', type: 'uint256' },
  { name: 'hasUserSpecifiedQuote', type: 'bool' },
  { name: 'controller', type: 'address' },
  { name: 'tokenCountWithoutHook', type: 'uint256' },
  { name: 'weightRatio', type: 'uint256' },
  { name: 'quotedAmountToSwapWith', type: 'uint256' },
  { name: 'twapTick', type: 'int24' },
  { name: 'twapLiquidity', type: 'uint128' },
  { name: 'poolId', type: 'bytes32' },
  { name: 'minimumBeneficiaryTokenCount', type: 'uint256' },
  { name: 'minimumReservedTokenCount', type: 'uint256' },
  { name: 'rawSwapQuote', type: 'uint256' },
  { name: 'oracleUnseeded', type: 'bool' },
] as const

const POOL_ID = `0x${'ab'.repeat(32)}` as `0x${string}`

function buybackSpec(minimumBeneficiary: bigint, minimumReserved: bigint) {
  return {
    hook: BUYBACK_HOOK,
    noop: false,
    amount: 0n,
    metadata: encodeAbiParameters(BUYBACK_PAY_METADATA as never, [
      false,
      0n,
      minimumBeneficiary + minimumReserved,
      false,
      '0x0000000000000000000000000000000000000001',
      minimumBeneficiary + minimumReserved,
      0n,
      10n ** 18n,
      0,
      0n,
      POOL_ID,
      minimumBeneficiary,
      minimumReserved,
      minimumBeneficiary + minimumReserved,
      false,
    ] as never),
  }
}

function rulesetTuple(overrides: Partial<{ cycleNumber: bigint; id: bigint; start: bigint }> = {}) {
  return {
    cycleNumber: 1n,
    id: 1n,
    basedOnId: 0n,
    start: 0n,
    duration: 0n,
    weight: 10n ** 18n,
    weightCutPercent: 0n,
    approvalHook: '0x0000000000000000000000000000000000000000',
    metadata: 0n,
    ...overrides,
  }
}

type ReadArgs = { address: string; functionName: string; args?: unknown[] }

function setupDefaultReads(options: {
  previewResult?: readonly [unknown, bigint, bigint, unknown[]]
  currentRuleset?: ReturnType<typeof rulesetTuple>
  upcomingRuleset?: ReturnType<typeof rulesetTuple>
  registryPreviewLive?: boolean
} = {}) {
  const preview = options.previewResult ?? [
    rulesetTuple(),
    568_002_355_840_000_000_000n,
    348_130_476_160_000_000_000n,
    [],
  ]
  mockReadContract.mockImplementation(async ({ address, functionName }: ReadArgs) => {
    if (functionName === 'previewPayFor') {
      if (address.toLowerCase() === ROUTER_REGISTRY.toLowerCase()) {
        return [rulesetTuple({ id: options.registryPreviewLive ? 1n : 0n }), 0n, 0n, []]
      }
      return preview
    }
    if (functionName === 'currentOf') return options.currentRuleset ?? rulesetTuple()
    if (functionName === 'upcomingOf') return options.upcomingRuleset ?? rulesetTuple({ cycleNumber: 0n })
    return 0n
  })
}

describe('payPreviewCard service', () => {
  describe('fmtCountdown', () => {
    it('formats days/hours/minutes/seconds', () => {
      expect(fmtCountdown(90061)).toBe('1d 01h 01m 01s')
      expect(fmtCountdown(3671)).toBe('01h 01m 11s')
      expect(fmtCountdown(59)).toBe('00m 59s')
      expect(fmtCountdown(-5)).toBe('00m 00s')
    })
  })

  describe('formatExactTokenEstimate', () => {
    it('rounds 18-decimal amounts with exact bigint math', () => {
      expect(formatExactTokenEstimate(568_002_355_840_000_000_000n)).toBe('568.00')
      expect(formatExactTokenEstimate(1_000_000_000_000_000_000n)).toBe('1')
      expect(formatExactTokenEstimate(0n)).toBe('0')
    })
  })

  describe('isVerifiedZeroIssuance', () => {
    it('flags only zero/zero quotes', () => {
      expect(isVerifiedZeroIssuance(0n, 0n)).toBe(true)
      expect(isVerifiedZeroIssuance(1n, 0n)).toBe(false)
      expect(isVerifiedZeroIssuance(0n, 1n)).toBe(false)
    })
  })

  describe('probeRouterPayRoute', () => {
    it('reports a live route when the registry previews a non-zero ruleset', async () => {
      const readContract = vi.fn().mockResolvedValue([rulesetTuple({ id: 7n }), 0n, 0n, []])
      const live = await probeRouterPayRoute(
        { readContract } as never,
        ROUTER_REGISTRY,
        1n,
        USDC,
        6,
      )
      expect(live).toBe(true)
      expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
        address: ROUTER_REGISTRY,
        functionName: 'previewPayFor',
        args: [1n, USDC, 10n ** 6n, '0x0000000000000000000000000000000000000001', '0x'],
      }))
    })

    it('reports a dead route on a zero ruleset id', async () => {
      const readContract = vi.fn().mockResolvedValue([rulesetTuple({ id: 0n }), 0n, 0n, []])
      expect(await probeRouterPayRoute({ readContract } as never, ROUTER_REGISTRY, 1n, USDC, 6)).toBe(false)
    })

    it('reports a dead route on revert', async () => {
      const readContract = vi.fn().mockRejectedValue(new Error('execution reverted'))
      expect(await probeRouterPayRoute({ readContract } as never, ROUTER_REGISTRY, 1n, USDC, 6)).toBe(false)
    })
  })

  describe('readPayScheduleGate', () => {
    it('has no gate when a ruleset is already live', async () => {
      const readContract = vi.fn().mockResolvedValue(rulesetTuple({ cycleNumber: 3n }))
      expect(await readPayScheduleGate({ readContract } as never, 1n)).toEqual({ startsAt: null })
      expect(readContract).toHaveBeenCalledTimes(1)
    })

    it('gates on the upcoming start when the first ruleset is in the future', async () => {
      const start = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const readContract = vi.fn()
        .mockResolvedValueOnce(rulesetTuple({ cycleNumber: 0n }))
        .mockResolvedValueOnce(rulesetTuple({ cycleNumber: 1n, start }))
      expect(await readPayScheduleGate({ readContract } as never, 1n)).toEqual({ startsAt: Number(start) })
    })

    it('has no gate when the upcoming start already passed', async () => {
      const readContract = vi.fn()
        .mockResolvedValueOnce(rulesetTuple({ cycleNumber: 0n }))
        .mockResolvedValueOnce(rulesetTuple({ cycleNumber: 1n, start: 1n }))
      expect(await readPayScheduleGate({ readContract } as never, 1n)).toEqual({ startsAt: null })
    })

    it('fails open (no countdown) when the schedule cannot be read', async () => {
      const readContract = vi.fn().mockRejectedValue(new Error('rpc down'))
      expect(await readPayScheduleGate({ readContract } as never, 1n)).toEqual({ startsAt: null })
    })
  })

  describe('resolveDirectSwapOffer', () => {
    const base = {
      route: 'amm' as const,
      beneficiaryTokenCount: 100n * 10n ** 18n,
      reservedTokenCount: 50n * 10n ** 18n,
      poolId: POOL_ID,
      hasTiers: false,
      addsToBalance: false,
      viaRouter: false,
    }

    it('offers the full pool output with a 1% display floor', () => {
      const offer = resolveDirectSwapOffer(base)
      expect(offer).not.toBeNull()
      expect(offer!.quotedOut).toBe(150n * 10n ** 18n)
      expect(offer!.minOut).toBe((150n * 10n ** 18n * 9_900n) / 10_000n)
      expect(offer!.advantage).toBe(50n * 10n ** 18n)
    })

    it('never offers on the issuance route', () => {
      expect(resolveDirectSwapOffer({ ...base, route: 'issuance' })).toBeNull()
    })

    it('never offers for NFT checkouts, add-to-balance, or routed tokens', () => {
      expect(resolveDirectSwapOffer({ ...base, hasTiers: true })).toBeNull()
      expect(resolveDirectSwapOffer({ ...base, addsToBalance: true })).toBeNull()
      expect(resolveDirectSwapOffer({ ...base, viaRouter: true })).toBeNull()
    })

    it('never offers when the pool output has no advantage over paying', () => {
      expect(resolveDirectSwapOffer({ ...base, reservedTokenCount: 0n })).toBeNull()
      expect(resolveDirectSwapOffer({ ...base, poolId: null })).toBeNull()
    })
  })

  describe('uniswapPoolLink', () => {
    it('links mainnet pools on the Uniswap app and skips unmapped chains', () => {
      expect(uniswapPoolLink(1, POOL_ID)).toBe(`https://app.uniswap.org/explore/pools/ethereum/${POOL_ID}`)
      expect(uniswapPoolLink(8453, POOL_ID)).toContain('/base/')
      expect(uniswapPoolLink(11155111, POOL_ID)).toBeNull()
    })
  })
})

describe('ProjectCard pay panel', () => {
  const mockProject = {
    id: '1',
    projectId: 1,
    chainId: 1,
    name: 'Test Project',
    handle: 'test-project',
    owner: '0x0000000000000000000000000000000000000002',
    balance: '1000000000000000000',
    volume: '5000000000000000000',
    paymentsCount: 1,
    createdAt: 1,
    logoUri: 'ipfs://QmLogo',
    baseCurrency: 1,
    totalPaid: '5000000000000000000',
  }

  const mockSuckerBalance = {
    totalBalance: '1000000000000000000',
    totalVolume: '5000000000000000000',
    totalVolumeUsd: '0',
    totalPaymentsCount: 1,
    currency: 1,
    decimals: 18,
    projectBalances: [],
    balanceAvailable: true,
    volumeAvailable: true,
    paymentsAvailable: true,
    dataScope: 'project',
  }

  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    useTransactionStore.setState({ transactions: [] })
    localStorage.clear()
    vi.clearAllMocks()

    ;(bendystraw.fetchProject as Mock).mockResolvedValue(mockProject)
    ;(bendystraw.fetchConnectedChains as Mock).mockResolvedValue([])
    ;(bendystraw.fetchSuckerGroupBalance as Mock).mockResolvedValue(mockSuckerBalance)
    ;(bendystraw.fetchOwnersCount as Mock).mockResolvedValue(100)
    ;(bendystraw.fetchProjectTokenSymbol as Mock).mockResolvedValue('REV')
    ;(bendystraw.fetchProjectAccountingContexts as Mock).mockResolvedValue([{
      terminal: MULTI_TERMINAL,
      token: NATIVE,
      decimals: 18,
      currency: 61166,
      symbol: 'ETH',
      balance: 1n,
    }])
    ;(bendystraw.fetchEthPrice as Mock).mockResolvedValue(2500)

    mockGetPaymentTerminal.mockImplementation(async (_client, _chainId, _projectId, token: string) => {
      if (token.toLowerCase() !== NATIVE.toLowerCase()) {
        throw new Error('This project does not accept the selected payment token')
      }
      return { address: MULTI_TERMINAL, type: 'multi' }
    })
    setupDefaultReads()
  })

  describe('structure', () => {
    it('renders memo directly under the pay row, before the feedback block', async () => {
      render(<ProjectCard projectId="1" chainId="11155111" />)

      const youGet = await screen.findByText('You get', undefined, { timeout: 2000 })
      const memo = screen.getByPlaceholderText('Add a memo (optional)')
      const payButton = screen.getByRole('button', { name: 'Pay' })

      // Pay button → memo → feedback, top to bottom.
      expect(payButton.compareDocumentPosition(memo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(memo.compareDocumentPosition(youGet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('shows the flavor explainer above the pay controls', async () => {
      render(<ProjectCard projectId="1" chainId="11155111" />)
      expect(await screen.findByText(/owner configures issuance and reserved splits/i)).toBeInTheDocument()
    })

    it('switches the explainer for revnets', async () => {
      render(<ProjectCard projectId="1" chainId="11155111" isRevnet />)
      expect(await screen.findByText(/locked onchain/i)).toBeInTheDocument()
    })

    it('shows the min-received caveat near the pay controls once a quote is live', async () => {
      render(<ProjectCard projectId="1" chainId="11155111" />)
      expect(await screen.findByText(/minimum shown is enforced onchain/i, undefined, { timeout: 2000 })).toBeInTheDocument()
    })
  })

  describe('starts-in countdown', () => {
    it('idles the pay button behind a countdown until the first ruleset starts', async () => {
      setupDefaultReads({
        currentRuleset: rulesetTuple({ cycleNumber: 0n }),
        upcomingRuleset: rulesetTuple({ cycleNumber: 1n, start: BigInt(Math.floor(Date.now() / 1000) + 7200) }),
      })

      render(<ProjectCard projectId="1" chainId="11155111" />)

      expect(await screen.findByText('Starts in', undefined, { timeout: 2000 })).toBeInTheDocument()
      const button = await screen.findByRole('button', { name: 'Not started' })
      expect(button).toBeDisabled()
    })
  })

  describe('zero-issuance quotes', () => {
    it('keeps a verified zero quote submittable and hides the token output', async () => {
      setupDefaultReads({ previewResult: [rulesetTuple(), 0n, 0n, []] })

      render(<ProjectCard projectId="1" chainId="11155111" />)

      expect(await screen.findByText(/issues no tokens for payments/i, undefined, { timeout: 2000 })).toBeInTheDocument()
      expect(screen.queryByText('You get')).not.toBeInTheDocument()
      expect(screen.queryByText(/Splits get/)).not.toBeInTheDocument()
      const payButton = screen.getByRole('button', { name: 'Pay' })
      await waitFor(() => expect(payButton).toBeEnabled())
    })
  })

  describe('AMM route', () => {
    it('displays the slippage-floored minimum the transaction will submit', async () => {
      // Buyback wins with no reserved cut: no direct-swap advantage, so the pay
      // quote itself renders — floored at 1% exactly like the executor submits.
      setupDefaultReads({
        previewResult: [rulesetTuple(), 0n, 0n, [buybackSpec(100n * 10n ** 18n, 0n)]],
      })

      render(<ProjectCard projectId="1" chainId="11155111" />)

      expect(await screen.findByText('You get at least', undefined, { timeout: 2000 })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '99 REV' })).toBeInTheDocument()
      expect(screen.getByText('amm')).toBeInTheDocument()
    })

    it('offers a direct pool swap when it beats paying', async () => {
      setupDefaultReads({
        previewResult: [rulesetTuple(), 0n, 0n, [buybackSpec(100n * 10n ** 18n, 50n * 10n ** 18n)]],
      })

      render(<ProjectCard projectId="1" chainId="11155111" />)

      expect(await screen.findByText('You get at least', undefined, { timeout: 2000 })).toBeInTheDocument()
      // Full pool output (150) floored 1% — the buy keeps the reserved share too.
      expect(screen.getByText(/148\.50 REV/)).toBeInTheDocument()
      expect(screen.getByText(/splits take 0 REV/i)).toBeInTheDocument()
      // Sepolia has no Uniswap-app pool page, so the link-out is omitted there
      // (uniswapPoolLink's mainnet URL is covered by the service tests above).
      expect(screen.queryByRole('link', { name: /Swap via Uniswap/i })).not.toBeInTheDocument()
      expect(screen.getByText('swap')).toBeInTheDocument()
    })
  })

  describe('currency list', () => {
    async function openTokenDropdown() {
      const tokenButton = await screen.findByRole('button', { name: 'ETH' })
      await waitFor(() => {
        const payButton = screen.getByRole('button', { name: 'Pay' })
        expect(payButton).toBeInTheDocument()
      })
      fireEvent.click(tokenButton)
    }

    it('offers a router token only when the registry previews a live ruleset', async () => {
      mockGetPaymentTerminal.mockImplementation(async (_client, _chainId, _projectId, token: string) =>
        token.toLowerCase() === NATIVE.toLowerCase()
          ? { address: MULTI_TERMINAL, type: 'multi' }
          : { address: ROUTER_REGISTRY, type: 'router' })
      setupDefaultReads({ registryPreviewLive: true })

      render(<ProjectCard projectId="1" chainId="11155111" />)

      await screen.findByText('You get', undefined, { timeout: 2000 })
      await openTokenDropdown()
      expect(screen.getByRole('button', { name: 'USDC' })).toBeInTheDocument()
    })

    it('drops a router token whose registry preview is dead', async () => {
      mockGetPaymentTerminal.mockImplementation(async (_client, _chainId, _projectId, token: string) =>
        token.toLowerCase() === NATIVE.toLowerCase()
          ? { address: MULTI_TERMINAL, type: 'multi' }
          : { address: ROUTER_REGISTRY, type: 'router' })
      setupDefaultReads({ registryPreviewLive: false })

      render(<ProjectCard projectId="1" chainId="11155111" />)

      await screen.findByText('You get', undefined, { timeout: 2000 })
      await openTokenDropdown()
      expect(screen.queryByRole('button', { name: 'USDC' })).not.toBeInTheDocument()
    })
  })

  describe('add to balance', () => {
    it('describes the balance-only effect and blocks token output', async () => {
      render(<ProjectCard projectId="1" chainId="11155111" />)

      const action = await screen.findByRole('button', { name: 'Payment action: Pay' })
      fireEvent.click(action)
      fireEvent.click(screen.getByRole('menuitem', { name: 'Add to balance' }))

      expect(screen.getByText(/Adds to the project balance — nothing else/)).toBeInTheDocument()
      expect(screen.queryByText('You get')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
    })
  })
})
