import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import QueueRulesetForm from './QueueRulesetForm'
import type { JBRulesetConfig } from '../../services/relayr'
import { chainMarksFor } from '../../test/test-utils'

const mocks = vi.hoisted(() => ({
  fetchProject: vi.fn(),
  fetchProjectWithRuleset: vi.fn(),
  fetchProjectSplits: vi.fn(),
  resolveProjectChains: vi.fn(),
  resolveRulesetQueueRoute: vi.fn(),
  assertRulesetConfigurationTrusted: vi.fn(),
  assertSafeStoredSplitGroups: vi.fn(),
  buildSplit: vi.fn(),
  modalProps: vi.fn(),
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
}))

vi.mock('../../utils/projectChains', () => ({
  resolveProjectChains: mocks.resolveProjectChains,
}))

vi.mock('../../utils/projectTrust', () => ({
  resolveRulesetQueueRoute: mocks.resolveRulesetQueueRoute,
  assertRulesetConfigurationTrusted: mocks.assertRulesetConfigurationTrusted,
}))

vi.mock('../../utils/splitSafety', () => ({
  assertSafeStoredSplitGroups: mocks.assertSafeStoredSplitGroups,
  buildSplit: mocks.buildSplit,
}))

vi.mock('../../utils/transactionSafety', () => ({
  getSafetyPublicClient: vi.fn(() => ({})),
}))

vi.mock('../payment', () => ({
  QueueRulesetModal: (props: { isOpen: boolean; rulesetConfigsByChain: Record<number, JBRulesetConfig> }) => {
    mocks.modalProps(props)
    return props.isOpen ? <div data-testid="queue-modal" /> : null
  },
}))

const TOKEN = '0x000000000000000000000000000000000000eeee'
const TERMINAL = '0x130f5dd2bd8805443cf41755253d778a75a67f53'
const QUEUE_TARGET = '0x0000000000000000000000000000000000000c11'

// Live ruleset reserving 20% — the state kmac88 wants to reconfigure away from.
const CURRENT_RULESET = {
  id: '7',
  duration: 0,
  weight: '1000000000000000000000000',
  weightCutPercent: 0,
  reservedPercent: 2000,
  cashOutTaxRate: 0,
  // Matches the live native accounting context below (uint32(NATIVE_TOKEN)).
  baseCurrency: 61166,
  pausePay: false,
  allowOwnerMinting: false,
  ownerMustSendPayouts: false,
  approvalHook: '0x0000000000000000000000000000000000000000',
  decayPercent: '0',
}

function primeForm() {
  mocks.fetchProject.mockResolvedValue({ projectId: 5, chainId: 1, name: 'Test Project' })
  mocks.resolveProjectChains.mockResolvedValue({
    mappingAvailable: true,
    chains: [{ chainId: 1, projectId: 5 }],
  })
  mocks.fetchProjectWithRuleset.mockResolvedValue({
    owner: '0x00000000000000000000000000000000000000ff',
    currentRuleset: CURRENT_RULESET,
  })
  mocks.fetchProjectSplits.mockResolvedValue({
    payoutSplits: [],
    reservedSplits: [],
    splitGroups: [],
    fundAccessLimitGroups: [],
    fundAccessLimits: null,
    accountingContexts: [{ terminal: TERMINAL, token: TOKEN, tokenDecimals: 18, currency: 61166 }],
    configurationComplete: true,
  })
  mocks.resolveRulesetQueueRoute.mockResolvedValue({
    target: QUEUE_TARGET,
    dataHook: '0x0000000000000000000000000000000000000000',
    useDataHookForPay: false,
    useDataHookForCashOut: false,
  })
}

describe('QueueRulesetForm reserved rate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a 0% reserved rate and encodes reservedPercent 0', async () => {
    primeForm()
    render(<QueueRulesetForm projectId="5" chainId="1" />)

    const reservedInput = await waitFor(() => {
      const input = screen.getByDisplayValue('20')
      expect(input).toBeInTheDocument()
      return input
    })

    await userEvent.clear(reservedInput)
    await userEvent.type(reservedInput, '0')

    const submit = screen.getByRole('button', { name: /Queue Ruleset/i })
    await waitFor(() => expect(submit).toBeEnabled())
    await userEvent.click(submit)

    await waitFor(() => expect(screen.getByTestId('queue-modal')).toBeInTheDocument())
    const calls = mocks.modalProps.mock.calls
    const props = calls[calls.length - 1][0] as {
      rulesetConfigsByChain: Record<number, JBRulesetConfig>
    }
    // No minimum gate: 0 survives input -> form state -> config encode.
    expect(props.rulesetConfigsByChain[1].metadata.reservedPercent).toBe(0)
  })
})

describe('QueueRulesetForm chain selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows each chain’s logo beside its name', async () => {
    primeForm()
    mocks.resolveProjectChains.mockResolvedValue({
      mappingAvailable: true,
      chains: [
        { chainId: 1, projectId: 5 },
        { chainId: 10, projectId: 9 },
      ],
    })

    render(<QueueRulesetForm projectId="5" chainId="1" />)

    await waitFor(() =>
      expect(chainMarksFor(1)).not.toHaveLength(0)
    )
    expect(chainMarksFor(10)).not.toHaveLength(0)
  })
})
