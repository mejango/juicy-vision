/**
 * Splits subtab: stage scoping (the browsed stage is what the editor targets)
 * and per-chain splits rendering (each chain has its OWN ruleset id and its own
 * JBSplits state, so one chain's rows must never stand in for another's).
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SplitsSubtab } from './SplitsSubtab'
import type { Project } from '../../../services/bendystraw'
import type { ChainStageSplits, ReservedSplit } from '../../../services/reservedSplits'

const mocks = vi.hoisted(() => ({
  fetchAllRulesets: vi.fn(),
  getContractsForProject: vi.fn(),
  fetchConnectedChains: vi.fn(),
  fetchProject: vi.fn(),
  fetchStageReservedSplits: vi.fn(),
  fetchPendingReservedPerChain: vi.fn(),
  fetchReservedDistributions: vi.fn(),
  readPendingReserved: vi.fn(),
}))

vi.mock('../../../services/bendystraw', () => ({
  fetchAllRulesets: mocks.fetchAllRulesets,
  getContractsForProject: mocks.getContractsForProject,
  fetchConnectedChains: mocks.fetchConnectedChains,
  fetchProject: mocks.fetchProject,
}))

vi.mock('../../../services/reservedSplits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/reservedSplits')>()),
  fetchStageReservedSplits: mocks.fetchStageReservedSplits,
  fetchPendingReservedPerChain: mocks.fetchPendingReservedPerChain,
  fetchReservedDistributions: mocks.fetchReservedDistributions,
  readPendingReserved: mocks.readPendingReserved,
}))

vi.mock('../../../hooks/useGuardedTx', () => ({
  useGuardedTx: () => ({ activeAddress: undefined, run: vi.fn() }),
}))

const ZERO = '0x0000000000000000000000000000000000000000'
const ALICE = '0x00000000000000000000000000000000000000a1'
const BOB = '0x00000000000000000000000000000000000000b2'

function split(beneficiary: string): ReservedSplit {
  return {
    percent: 1_000_000_000,
    projectId: 0,
    beneficiary: beneficiary as ReservedSplit['beneficiary'],
    preferAddToBalance: false,
    lockedUntil: 0,
    hook: ZERO as ReservedSplit['hook'],
  }
}

const NOW = Math.floor(Date.now() / 1000)

// Three stages: two started (stage 2 is current), one still in the future.
const HOME_STAGES = [
  { id: '11', cycleNumber: 1, start: NOW - 2000, duration: 1000, weight: '0', weightCutPercent: 0, reservedPercent: 1000, cashOutTaxRate: 0 },
  { id: '12', cycleNumber: 2, start: NOW - 1000, duration: 1000, weight: '0', weightCutPercent: 0, reservedPercent: 2000, cashOutTaxRate: 0 },
  { id: '13', cycleNumber: 3, start: NOW + 1000, duration: 0, weight: '0', weightCutPercent: 0, reservedPercent: 3000, cashOutTaxRate: 0 },
]

const PROJECT = {
  projectId: 5,
  chainId: 1,
  tokenSymbol: 'TEST',
} as unknown as Project

const CHAIN_PROJECTS = [
  { chainId: 1, projectId: 5 },
  { chainId: 10, projectId: 9 },
]

function chainSplits(overrides: Partial<ChainStageSplits> & { chainId: number }): ChainStageSplits {
  return {
    projectId: overrides.chainId === 1 ? 5 : 9,
    rulesetId: '0',
    splits: [],
    ...overrides,
  }
}

function renderSubtab(onEditSplits?: (stageIndex: number) => void) {
  return render(
    <SplitsSubtab
      project={PROJECT}
      chainIds={[1, 10]}
      chainProjects={CHAIN_PROJECTS}
      variant="splits"
      onEditSplits={onEditSplits}
    />,
  )
}

/** The chain block for a chain, located by its heading. */
function chainBlock(name: string): HTMLElement {
  return screen.getByTestId(`splits-chain-${name}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchAllRulesets.mockResolvedValue(HOME_STAGES)
  mocks.fetchPendingReservedPerChain.mockResolvedValue([
    { chainId: 1, pending: 0n },
    { chainId: 10, pending: 0n },
  ])
  mocks.fetchReservedDistributions.mockResolvedValue([])
})

describe('SplitsSubtab per-chain splits', () => {
  it('renders each chain’s own splits — never the home chain’s rows under every chain', async () => {
    mocks.fetchStageReservedSplits.mockImplementation(async (chainProject: { chainId: number }) =>
      chainProject.chainId === 1
        ? chainSplits({ chainId: 1, rulesetId: '12', splits: [split(ALICE)] })
        : chainSplits({ chainId: 10, rulesetId: '22', splits: [split(BOB)] }),
    )

    renderSubtab()

    await waitFor(() => expect(within(chainBlock('1')).getByTitle(ALICE)).toBeInTheDocument())
    expect(within(chainBlock('10')).getByTitle(BOB)).toBeInTheDocument()
    // Cross-contamination check: neither chain shows the other's recipient.
    expect(within(chainBlock('1')).queryByTitle(BOB)).not.toBeInTheDocument()
    expect(within(chainBlock('10')).queryByTitle(ALICE)).not.toBeInTheDocument()

    // Each chain is read with ITS OWN project id, at the browsed stage index.
    expect(mocks.fetchStageReservedSplits).toHaveBeenCalledWith({ chainId: 1, projectId: 5 }, 1)
    expect(mocks.fetchStageReservedSplits).toHaveBeenCalledWith({ chainId: 10, projectId: 9 }, 1)
  })

  it('isolates a failed chain read — the other chain still renders its rows', async () => {
    mocks.fetchStageReservedSplits.mockImplementation(async (chainProject: { chainId: number }) =>
      chainProject.chainId === 1
        ? chainSplits({ chainId: 1, rulesetId: '12', splits: [split(ALICE)] })
        : chainSplits({ chainId: 10, rulesetId: null, splits: null }),
    )

    renderSubtab()

    await waitFor(() => expect(within(chainBlock('1')).getByTitle(ALICE)).toBeInTheDocument())
    expect(within(chainBlock('10')).getByRole('alert')).toHaveTextContent(/could not read splits/i)
    expect(within(chainBlock('1')).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('isolates loading — a slow chain shows its own spinner while the fast chain renders', async () => {
    let releasePeer: (value: ChainStageSplits) => void = () => {}
    const peerPending = new Promise<ChainStageSplits>((resolve) => {
      releasePeer = resolve
    })
    mocks.fetchStageReservedSplits.mockImplementation(async (chainProject: { chainId: number }) =>
      chainProject.chainId === 1
        ? chainSplits({ chainId: 1, rulesetId: '12', splits: [split(ALICE)] })
        : peerPending,
    )

    renderSubtab()

    await waitFor(() => expect(within(chainBlock('1')).getByTitle(ALICE)).toBeInTheDocument())
    expect(within(chainBlock('10')).getByText(/reading splits/i)).toBeInTheDocument()

    releasePeer(chainSplits({ chainId: 10, rulesetId: '22', splits: [split(BOB)] }))
    await waitFor(() => expect(within(chainBlock('10')).getByTitle(BOB)).toBeInTheDocument())
  })
})

describe('SplitsSubtab stage scoping', () => {
  beforeEach(() => {
    mocks.fetchStageReservedSplits.mockImplementation(async (chainProject: { chainId: number }, stageIndex: number) =>
      chainSplits({
        chainId: chainProject.chainId,
        rulesetId: String((chainProject.chainId === 1 ? 10 : 20) + stageIndex + 1),
        splits: [split(chainProject.chainId === 1 ? ALICE : BOB)],
      }),
    )
  })

  it('re-reads the browsed stage on every chain when the stage changes', async () => {
    renderSubtab()
    await waitFor(() => expect(mocks.fetchStageReservedSplits).toHaveBeenCalledTimes(2))

    await userEvent.click(screen.getByRole('button', { name: /stage 3/i }))

    await waitFor(() =>
      expect(mocks.fetchStageReservedSplits).toHaveBeenCalledWith({ chainId: 1, projectId: 5 }, 2),
    )
    expect(mocks.fetchStageReservedSplits).toHaveBeenCalledWith({ chainId: 10, projectId: 9 }, 2)
  })

  it('opens the editor for the BROWSED stage, not whatever stage is current', async () => {
    const onEditSplits = vi.fn()
    renderSubtab(onEditSplits)
    await waitFor(() => expect(screen.getByRole('button', { name: /^edit splits$/i })).toBeInTheDocument())

    // Current stage is stage 2 (index 1); browse to the future stage 3 (index 2).
    await userEvent.click(screen.getByRole('button', { name: /stage 3/i }))
    await userEvent.click(screen.getByRole('button', { name: /^edit splits$/i }))

    expect(onEditSplits).toHaveBeenCalledWith(2)
  })

  it('opens the editor for the current stage when no other stage is browsed', async () => {
    const onEditSplits = vi.fn()
    renderSubtab(onEditSplits)
    await waitFor(() => expect(screen.getByRole('button', { name: /^edit splits$/i })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /^edit splits$/i }))
    expect(onEditSplits).toHaveBeenCalledWith(1)
  })

  it('disables the editor on an ended stage — its ruleset can never be active again', async () => {
    const onEditSplits = vi.fn()
    renderSubtab(onEditSplits)
    await waitFor(() => expect(screen.getByRole('button', { name: /^edit splits$/i })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /stage 1/i }))

    const cta = screen.getByRole('button', { name: /^edit splits$/i })
    expect(cta).toBeDisabled()
    await userEvent.click(cta)
    expect(onEditSplits).not.toHaveBeenCalled()
  })
})
