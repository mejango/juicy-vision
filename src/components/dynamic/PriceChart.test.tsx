import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import PriceChart from './PriceChart'

const bendystraw = vi.hoisted(() => ({
  fetchProjectWithRuleset: vi.fn(),
  fetchProjectTokenSymbol: vi.fn(),
  fetchRulesetHistory: vi.fn(),
  fetchAllRulesets: vi.fn(),
  fetchSuckerGroupBalance: vi.fn(),
  isRevnetProject: vi.fn(),
}))

vi.mock('../../services/bendystraw', () => bendystraw)

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => <svg>{children}</svg>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
  ReferenceArea: () => null,
}))

function projectWithHook() {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: '3-1',
    projectId: 3,
    chainId: 1,
    owner: '0x0000000000000000000000000000000000000001',
    name: 'Revnet Network',
    balance: '0',
    controllerRecognized: true,
    currentRuleset: {
      id: '7',
      cycleNumber: 2,
      start: now - 30 * 86_400,
      duration: 86_400,
      weight: '1000000000000000000000',
      weightCutPercent: 10_000_000,
      decayPercent: '10000000',
      pausePay: false,
      allowOwnerMinting: true,
      useDataHookForPay: true,
      reservedPercent: 3_800,
      cashOutTaxRate: 1_000,
      baseCurrency: 1,
    },
  }
}

describe('PriceChart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bendystraw.fetchProjectWithRuleset.mockResolvedValue(projectWithHook())
    bendystraw.fetchProjectTokenSymbol.mockResolvedValue('REV')
    bendystraw.fetchSuckerGroupBalance.mockResolvedValue({
      totalBalance: '0',
      totalVolume: '0',
      totalVolumeUsd: '0',
      totalPaymentsCount: 0,
      currency: 1,
      decimals: 18,
      projectBalances: [],
      balanceAvailable: true,
    })
    bendystraw.fetchRulesetHistory.mockResolvedValue([])
  })

  it('uses stored on-chain rulesets for a recognized Revnet payment hook', async () => {
    const now = Math.floor(Date.now() / 1000)
    bendystraw.isRevnetProject.mockReturnValue(true)
    bendystraw.fetchAllRulesets.mockResolvedValue([{
      id: '7',
      cycleNumber: 1,
      start: now - 30 * 86_400,
      duration: 86_400,
      weight: '1000000000000000000000',
      weightCutPercent: 10_000_000,
      reservedPercent: 3_800,
      cashOutTaxRate: 1_000,
    }])

    render(<PriceChart projectId="3" chainId="1" />)

    await waitFor(() => {
      expect(screen.getByTestId('responsive-container')).toBeInTheDocument()
    })
    expect(bendystraw.fetchAllRulesets).toHaveBeenCalledWith('3', 1)
    expect(screen.queryByText(/unrecognized payment hook/i)).not.toBeInTheDocument()
    expect(screen.getByText(/live payment may use the buyback pool/i)).toBeInTheDocument()
  })

  it('still fails closed for an arbitrary payment hook', async () => {
    bendystraw.isRevnetProject.mockReturnValue(false)

    render(<PriceChart projectId="3" chainId="1" />)

    expect(await screen.findByText(
      'Issuance price unavailable because this project uses an unrecognized payment hook',
    )).toBeInTheDocument()
    expect(bendystraw.fetchAllRulesets).not.toHaveBeenCalled()
  })
})
