import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SetSplitsForm from './SetSplitsForm'
import type { JBSplitData } from '../../services/bendystraw'

const mocks = vi.hoisted(() => ({
  fetchProject: vi.fn(),
  fetchProjectWithRuleset: vi.fn(),
  fetchProjectSplits: vi.fn(),
  isRevnetProject: vi.fn(),
  resolveProjectChains: vi.fn(),
  resolveEnsName: vi.fn(),
  modalProps: vi.fn(),
  fetchStageRulesetsPerChain: vi.fn(),
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x1234567890123456789012345678901234567890',
    isConnected: true,
  }),
}))

vi.mock('../../hooks', () => ({
  useManagedWallet: () => ({ address: null, isManagedMode: false }),
}))

vi.mock('../../services/bendystraw', () => ({
  fetchProject: mocks.fetchProject,
  fetchProjectWithRuleset: mocks.fetchProjectWithRuleset,
  fetchProjectSplits: mocks.fetchProjectSplits,
  isRevnetProject: mocks.isRevnetProject,
}))

vi.mock('../../utils/projectChains', () => ({
  resolveProjectChains: mocks.resolveProjectChains,
}))

vi.mock('../../services/reservedSplits', () => ({
  fetchStageRulesetsPerChain: mocks.fetchStageRulesetsPerChain,
}))

vi.mock('../../utils/ens', () => ({
  resolveEnsName: mocks.resolveEnsName,
  truncateAddress: (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`,
}))

vi.mock('../payment', () => ({
  SetSplitsModal: (props: { isOpen: boolean; reservedSplits: unknown[] }) => {
    mocks.modalProps(props)
    return props.isOpen ? <div data-testid="set-splits-modal" /> : null
  },
}))

const TOKEN = '0x000000000000000000000000000000000000eeee'
const TERMINAL = '0x130f5dd2bd8805443cf41755253d778a75a67f53'
const BENEFICIARY = '0x00000000000000000000000000000000000000a1'
const ZERO = '0x0000000000000000000000000000000000000000'

function split(overrides: Partial<JBSplitData> = {}): JBSplitData {
  return {
    preferAddToBalance: false,
    percent: 1_000_000_000, // 100%
    projectId: 0,
    beneficiary: BENEFICIARY,
    lockedUntil: 0,
    hook: ZERO,
    ...overrides,
  }
}

function splitsData(reserved: JBSplitData[], payout: JBSplitData[] = []) {
  const groupId = BigInt(TOKEN).toString()
  return {
    payoutSplits: payout,
    reservedSplits: reserved,
    splitGroups: [{ groupId, splits: payout }],
    accountingContexts: [{ terminal: TERMINAL, token: TOKEN, tokenDecimals: 18, currency: 61166 }],
    configurationComplete: true,
  }
}

/**
 * @param fallbackReserved reserved splits stored under the fallback ruleset (id 0),
 * which `JBSplits.splitsOf` returns whenever the active ruleset's group is empty.
 */
function primeForm(options: {
  reserved: JBSplitData[]
  fallbackReserved?: JBSplitData[]
  isRevnet?: boolean
}) {
  mocks.fetchProject.mockResolvedValue({
    projectId: 5,
    chainId: 1,
    name: 'Test Project',
    owner: '0x00000000000000000000000000000000000000ff',
  })
  mocks.isRevnetProject.mockReturnValue(options.isRevnet ?? false)
  mocks.resolveProjectChains.mockResolvedValue({
    mappingAvailable: true,
    chains: [{ chainId: 1, projectId: 5 }],
  })
  mocks.fetchProjectWithRuleset.mockResolvedValue({
    owner: '0x00000000000000000000000000000000000000ff',
    currentRuleset: { id: '7', baseCurrency: 1, duration: 0 },
  })
  mocks.resolveEnsName.mockResolvedValue(null)
  mocks.fetchProjectSplits.mockImplementation((_projectId: string, _chainId: number, rulesetId: string) =>
    Promise.resolve(
      rulesetId === '0'
        ? splitsData(options.fallbackReserved ?? [])
        : splitsData(options.reserved)
    )
  )
}

async function renderForm() {
  render(<SetSplitsForm projectId="5" chainId="1" />)
  await waitFor(() => expect(screen.getByRole('button', { name: /Reserved Splits/i })).toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: /Reserved Splits/i }))
}

describe('SetSplitsForm reserved-split removal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows deleting every reserved row and submitting an empty group when no fallback splits exist', async () => {
    primeForm({ reserved: [split()], fallbackReserved: [] })
    await renderForm()

    await userEvent.click(screen.getByRole('button', { name: /remove split/i }))
    expect(screen.getByText(/No reserved splits configured/i)).toBeInTheDocument()

    const submit = screen.getByRole('button', { name: /^Update Splits/i })
    expect(submit).toBeEnabled()

    await userEvent.click(submit)
    await waitFor(() => expect(screen.getByTestId('set-splits-modal')).toBeInTheDocument())
    const calls = mocks.modalProps.mock.calls
    const lastCall = calls[calls.length - 1][0] as { reservedSplits: unknown[] }
    expect(lastCall.reservedSplits).toEqual([])
  })

  it('still blocks clearing when fallback (ruleset 0) splits would take over', async () => {
    primeForm({ reserved: [split()], fallbackReserved: [split()] })
    await renderForm()

    await userEvent.click(screen.getByRole('button', { name: /remove split/i }))

    expect(screen.getByTestId('splits-fallback-warning')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Update Splits/i })).toBeDisabled()
  })

  it('does not allow removing an actively locked row', async () => {
    const lockedUntil = Math.floor(Date.now() / 1000) + 86_400
    primeForm({ reserved: [split({ lockedUntil })], fallbackReserved: [] })
    await renderForm()

    expect(screen.queryByRole('button', { name: /remove split/i })).not.toBeInTheDocument()
    expect(screen.getByText(/Locked until/i)).toBeInTheDocument()
  })
})

describe('SetSplitsForm stage targeting', () => {
  const ruleset = (id: string) => ({
    id,
    cycleNumber: 1,
    start: 0,
    duration: 0,
    weight: '0',
    weightCutPercent: 0,
    reservedPercent: 0,
    cashOutTaxRate: 0,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    primeForm({ reserved: [split()], fallbackReserved: [] })
    // Two chains, each with its OWN project id and its own ruleset id per stage.
    mocks.resolveProjectChains.mockResolvedValue({
      mappingAvailable: true,
      chains: [
        { chainId: 1, projectId: 5 },
        { chainId: 10, projectId: 9 },
      ],
    })
    mocks.fetchStageRulesetsPerChain.mockResolvedValue([
      { chainId: 1, projectId: 5, ruleset: ruleset('13') },
      { chainId: 10, projectId: 9, ruleset: ruleset('23') },
    ])
  })

  const rulesetIdsRead = () =>
    mocks.fetchProjectSplits.mock.calls.map(call => [call[0], call[1], call[2]])

  it('reads and edits the browsed stage’s ruleset on EVERY chain, not the current ruleset', async () => {
    render(<SetSplitsForm projectId="5" chainId="1" stageIndex={2} />)
    await waitFor(() => expect(mocks.fetchProjectSplits).toHaveBeenCalled())

    await waitFor(() =>
      expect(rulesetIdsRead()).toEqual(
        expect.arrayContaining([
          ['5', 1, '13'],
          ['9', 10, '23'],
        ]),
      ),
    )
    // The current ruleset (7) must never be touched when a stage is browsed.
    expect(rulesetIdsRead().some(([, , rulesetId]) => rulesetId === '7')).toBe(false)
    expect(mocks.fetchStageRulesetsPerChain).toHaveBeenCalledWith(
      [
        { chainId: 1, projectId: 5 },
        { chainId: 10, projectId: 9 },
      ],
      2,
    )
  })

  it('names the stage it is editing so the target is never implicit', async () => {
    render(<SetSplitsForm projectId="5" chainId="1" stageIndex={2} />)
    await waitFor(() => expect(screen.getByTestId('splits-target-stage')).toHaveTextContent(/stage 3/i))
  })

  it('falls back to the current ruleset when no stage is browsed', async () => {
    render(<SetSplitsForm projectId="5" chainId="1" />)
    await waitFor(() => expect(mocks.fetchProjectSplits).toHaveBeenCalled())

    await waitFor(() =>
      expect(rulesetIdsRead()).toEqual(expect.arrayContaining([['5', 1, '7']])),
    )
    expect(mocks.fetchStageRulesetsPerChain).not.toHaveBeenCalled()
    expect(screen.queryByTestId('splits-target-stage')).not.toBeInTheDocument()
  })

  it('marks a chain unavailable when it has no ruleset for the browsed stage', async () => {
    mocks.fetchStageRulesetsPerChain.mockResolvedValue([
      { chainId: 1, projectId: 5, ruleset: ruleset('13') },
      { chainId: 10, projectId: 9, ruleset: null },
    ])
    render(<SetSplitsForm projectId="5" chainId="1" stageIndex={2} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /OP.*Unavailable|Unavailable/i })).toBeInTheDocument())
    expect(rulesetIdsRead().some(([chainProjectId]) => chainProjectId === '9')).toBe(false)
  })
})

describe('SetSplitsForm reserved-percent explainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('explains that this edits routing, not the reserved percentage, and offers the queue route', async () => {
    primeForm({ reserved: [split()], fallbackReserved: [] })
    await renderForm()

    const explainer = screen.getByTestId('reserved-percent-explainer')
    expect(explainer).toHaveTextContent(/how many tokens are reserved/i)

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    await userEvent.click(within(explainer).getByRole('button', { name: /reserved rate to 0%/i }))
    const sent = dispatchSpy.mock.calls
      .map(call => call[0] as CustomEvent)
      .find(event => event.type === 'juice:send-message')
    expect(sent).toBeDefined()
    expect((sent?.detail as { message: string }).message).toMatch(/0%/)
    dispatchSpy.mockRestore()
  })

  it('states the stage-fixed constraint for revnets instead of offering a ruleset queue', async () => {
    primeForm({ reserved: [split()], fallbackReserved: [], isRevnet: true })
    await renderForm()

    const explainer = screen.getByTestId('reserved-percent-explainer')
    expect(explainer).toHaveTextContent(/stage/i)
    expect(within(explainer).queryByRole('button', { name: /reserved rate to 0%/i })).not.toBeInTheDocument()
  })
})
