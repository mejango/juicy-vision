import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import TokenPriceChart from './TokenPriceChart'
import { useThemeStore } from '../../../stores'
import * as bendystraw from '../../../services/bendystraw'
import * as bendystrawClient from '../../../services/bendystraw/client'
import * as uniswap from '../../../services/uniswap'

// Mock bendystraw service
vi.mock('../../../services/bendystraw', () => ({
  fetchProjectWithRuleset: vi.fn(),
  fetchProjectTokenSymbol: vi.fn(),
  fetchProjectTokenAddress: vi.fn(),
  fetchProjectTokenSupply: vi.fn(),
  fetchPendingReservedTokens: vi.fn(),
  fetchProjectSuckerGroupId: vi.fn(),
  fetchSuckerGroupBalance: vi.fn(),
  fetchSuckerGroupMoments: vi.fn(),
  fetchCashOutTaxSnapshots: vi.fn(),
  calculateFloorPrice: vi.fn(),
  fetchAllRulesets: vi.fn(),
  fetchIndexedAmmPriceHistory: vi.fn(),
  isRevnetProject: vi.fn(),
}))

// The min-price helper is imported straight from the client module, not the barrel
vi.mock('../../../services/bendystraw/client', () => ({
  calculateFloorMinPrice: vi.fn(),
}))

// Mock uniswap service
vi.mock('../../../services/uniswap', () => ({
  fetchPoolPriceHistory: vi.fn(),
  shouldUseHourlyData: vi.fn(),
  getPoolRangeStartTimestamp: vi.fn(),
  discoverUniswapPool: vi.fn(),
}))

// Mock recharts, exposing the YAxis domain props for assertions
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: ({ dataKey, strokeDasharray }: { dataKey: string; strokeDasharray?: string }) => (
    <div data-testid={`line-${dataKey}`} data-stroke-dasharray={strokeDasharray} />
  ),
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: ({ domain, allowDataOverflow }: { domain: unknown; allowDataOverflow?: boolean }) => (
    <div
      data-testid="y-axis"
      data-domain={JSON.stringify(domain)}
      data-allow-overflow={String(allowDataOverflow)}
    />
  ),
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
}))

const NOW = Math.floor(Date.now() / 1000)

// weight 0.5e18 tokens per ETH → issuance price of 2 ETH per token
const mockProject = {
  projectId: 1,
  chainId: 1,
  currentRuleset: {
    start: NOW - 86400 * 30,
    duration: 86400 * 7,
    weight: '500000000000000000',
    weightCutPercent: 0,
    baseCurrency: 1,
    useDataHookForPay: false,
  },
}

describe('TokenPriceChart', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    vi.clearAllMocks()
    vi.mocked(bendystraw.fetchProjectWithRuleset).mockResolvedValue(mockProject as any)
    vi.mocked(bendystraw.fetchProjectTokenSymbol).mockResolvedValue('TEST')
    vi.mocked(bendystraw.fetchProjectSuckerGroupId).mockResolvedValue(null)
    vi.mocked(bendystraw.fetchSuckerGroupBalance).mockResolvedValue({
      totalBalance: '0',
      currency: 1,
      decimals: 18,
    } as any)
    vi.mocked(bendystraw.isRevnetProject).mockReturnValue(false)
    vi.mocked(bendystraw.fetchProjectTokenAddress).mockResolvedValue(null)
    vi.mocked(bendystraw.fetchIndexedAmmPriceHistory).mockResolvedValue({
      hasPool: false,
      points: [],
    })
    vi.mocked(uniswap.discoverUniswapPool).mockResolvedValue(null)
    vi.mocked(uniswap.shouldUseHourlyData).mockReturnValue(false)
    vi.mocked(uniswap.getPoolRangeStartTimestamp).mockReturnValue(NOW - 86400 * 30)
    vi.mocked(uniswap.fetchPoolPriceHistory).mockResolvedValue([])
  })

  it('anchors the Y domain to the issuance series', async () => {
    render(<TokenPriceChart projectId="1" />)

    await waitFor(() => {
      expect(screen.getByTestId('line-issuancePrice')).toBeInTheDocument()
    })

    const yAxis = screen.getByTestId('y-axis')
    expect(yAxis.getAttribute('data-domain')).toBe(JSON.stringify([0, 2 * 1.05]))
    expect(yAxis.getAttribute('data-allow-overflow')).toBe('true')
  })

  it('keeps the issuance-anchored Y domain when pool data has 100x values', async () => {
    vi.mocked(bendystraw.fetchProjectTokenAddress).mockResolvedValue('0xtoken')
    vi.mocked(uniswap.discoverUniswapPool).mockResolvedValue({
      address: '0xpool',
      quoteToken: 'WETH',
    } as any)
    vi.mocked(uniswap.fetchPoolPriceHistory).mockResolvedValue([
      { timestamp: NOW - 86400 * 5, price: 200 },
      { timestamp: NOW - 86400, price: 250 },
    ] as any)

    render(<TokenPriceChart projectId="1" />)

    await waitFor(() => {
      expect(screen.getByTestId('line-poolPrice')).toBeInTheDocument()
    })

    const yAxis = screen.getByTestId('y-axis')
    expect(yAxis.getAttribute('data-domain')).toBe(JSON.stringify([0, 2 * 1.05]))
    expect(yAxis.getAttribute('data-allow-overflow')).toBe('true')
  })

  it('falls back to auto domain when there is no issuance series', async () => {
    vi.mocked(bendystraw.fetchProjectWithRuleset).mockResolvedValue({
      ...mockProject,
      currentRuleset: { ...mockProject.currentRuleset, useDataHookForPay: true },
    } as any)
    vi.mocked(bendystraw.fetchProjectTokenAddress).mockResolvedValue('0xtoken')
    vi.mocked(uniswap.discoverUniswapPool).mockResolvedValue({
      address: '0xpool',
      quoteToken: 'WETH',
    } as any)
    vi.mocked(uniswap.fetchPoolPriceHistory).mockResolvedValue([
      { timestamp: NOW - 86400 * 5, price: 200 },
    ] as any)

    render(<TokenPriceChart projectId="1" />)

    await waitFor(() => {
      expect(screen.getByTestId('line-poolPrice')).toBeInTheDocument()
    })

    const yAxis = screen.getByTestId('y-axis')
    expect(yAxis.getAttribute('data-domain')).toBe(JSON.stringify(['auto', 'auto']))
    expect(yAxis.getAttribute('data-allow-overflow')).toBe('false')
  })

  it('renders the dashed cash-out minimum line behind the issuance line, keeping the issuance-anchored domain', async () => {
    vi.mocked(bendystraw.fetchProjectWithRuleset).mockResolvedValue({
      ...mockProject,
      currentRuleset: { ...mockProject.currentRuleset, cashOutTaxRate: 4000 },
    } as any)
    vi.mocked(bendystraw.fetchSuckerGroupBalance).mockResolvedValue({
      totalBalance: '1013906664594272',
      currency: 1,
      decimals: 18,
    } as any)
    vi.mocked(bendystraw.fetchProjectTokenSupply).mockResolvedValue('10138952920494645629')
    vi.mocked(bendystraw.fetchPendingReservedTokens).mockResolvedValue('0')
    vi.mocked(bendystraw.calculateFloorPrice).mockReturnValue(0.000064)
    vi.mocked(bendystrawClient.calculateFloorMinPrice).mockReturnValue(0.00006)

    render(<TokenPriceChart projectId="1" />)

    await waitFor(() => {
      expect(screen.getByTestId('line-cashOutMinPrice')).toBeInTheDocument()
    })

    expect(screen.getByTestId('line-cashOutMinPrice').getAttribute('data-stroke-dasharray')).toBe('5 4')

    const chart = screen.getByTestId('line-chart')
    const lines = Array.from(chart.querySelectorAll('[data-testid^="line-"]'))
      .map(el => el.getAttribute('data-testid'))
    expect(lines.indexOf('line-cashOutMinPrice')).toBeLessThan(lines.indexOf('line-issuancePrice'))
    expect(lines.indexOf('line-cashOutMinPrice')).toBeLessThan(lines.indexOf('line-cashOutPrice'))

    const yAxis = screen.getByTestId('y-axis')
    expect(yAxis.getAttribute('data-domain')).toBe(JSON.stringify([0, 2 * 1.05]))
    expect(yAxis.getAttribute('data-allow-overflow')).toBe('true')
  })

  it('renders overlay lines before the issuance line', async () => {
    vi.mocked(bendystraw.fetchProjectTokenAddress).mockResolvedValue('0xtoken')
    vi.mocked(uniswap.discoverUniswapPool).mockResolvedValue({
      address: '0xpool',
      quoteToken: 'WETH',
    } as any)
    vi.mocked(uniswap.fetchPoolPriceHistory).mockResolvedValue([
      { timestamp: NOW - 86400 * 5, price: 200 },
    ] as any)

    render(<TokenPriceChart projectId="1" />)

    await waitFor(() => {
      expect(screen.getByTestId('line-poolPrice')).toBeInTheDocument()
    })

    const chart = screen.getByTestId('line-chart')
    const lines = Array.from(chart.querySelectorAll('[data-testid^="line-"]'))
      .map(el => el.getAttribute('data-testid'))
    expect(lines.indexOf('line-poolPrice')).toBeLessThan(lines.indexOf('line-issuancePrice'))
  })
})
