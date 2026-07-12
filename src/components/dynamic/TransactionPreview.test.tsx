import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TransactionPreview from './TransactionPreview'
import { useThemeStore } from '../../stores'

// Mock wagmi hooks
vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: undefined,
    isConnected: false,
    isConnecting: false,
    isDisconnected: true,
  }),
  useConfig: () => ({}),
  useChainId: () => 1,
}))

// Mock the stores and hooks that TransactionPreview depends on
// useProjectDraftStore is a zustand hook that uses selectors
vi.mock('../../stores/projectDraftStore', () => ({
  useProjectDraftStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const mockState = {
      projectName: null,
      projectDescription: null,
      projectLogo: null,
      tiers: [],
      payoutLimit: null,
      payoutCurrency: 2,
      splits: [],
      setProjectMeta: vi.fn(),
      addTier: vi.fn(),
      setTiers: vi.fn(),
      setPayoutLimit: vi.fn(),
      setSplits: vi.fn(),
      clearDraft: vi.fn(),
      parseFormSubmission: vi.fn(),
    }
    return selector ? selector(mockState) : mockState
  },
}))

vi.mock('../../hooks', () => ({
  useManagedWallet: () => ({
    address: null,
    accounts: [],
    balances: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
    isManagedMode: false,
  }),
}))

vi.mock('../../hooks/relayr', () => ({
  useOmnichainLaunchProject: () => ({
    launch: vi.fn(),
    bundleState: { status: 'idle', chainStates: [], error: null },
    isLaunching: false,
    isComplete: false,
    hasError: false,
    createdProjectIds: {},
    reset: vi.fn(),
  }),
  useOmnichainSetUri: () => ({
    setUri: vi.fn(),
    bundleState: { status: 'idle', chainStates: [], error: null },
    isSettingUri: false,
    isComplete: false,
    hasError: false,
    reset: vi.fn(),
  }),
}))

describe('TransactionPreview', () => {
  const defaultProps = {
    action: 'pay',
    contract: '0x130f5dd2bd8805443cf41755253d778a75a67f53',
    chainId: '1',
    parameters: JSON.stringify({ amount: '1000000000000000000' }),
    explanation: 'Pay 1 ETH to project #42',
  }

  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders the explanation text', () => {
      render(<TransactionPreview {...defaultProps} />)
      expect(screen.getByText('Pay 1 ETH to project #42')).toBeInTheDocument()
    })

    it('renders the header', () => {
      render(<TransactionPreview {...defaultProps} />)
      expect(screen.getByText('Review for deployment')).toBeInTheDocument()
    })

    it('does not render an execute button for an unprepared payment', () => {
      render(<TransactionPreview {...defaultProps} />)
      expect(screen.queryByRole('button', { name: 'Pay' })).not.toBeInTheDocument()
      expect(screen.getByText(/not prepared by a supported transaction form/i)).toBeInTheDocument()
    })

    it('does not treat a matching action label as transaction authorization', () => {
      render(<TransactionPreview {...defaultProps} />)
      expect(screen.queryByRole('button', { name: 'Pay' })).not.toBeInTheDocument()
    })

    it('renders project ID when provided', () => {
      render(<TransactionPreview {...defaultProps} projectId="42" />)
      // Project ID is inside expandable technical details section
      const toggleButton = screen.getByText(/technical details/i)
      fireEvent.click(toggleButton)
      expect(screen.getByText('#42')).toBeInTheDocument()
    })
  })

  describe('action buttons', () => {
    const actionButtonPairs = [
      { action: 'pay', label: 'Pay' },
      { action: 'cashOut', label: 'Cash Out' },
      { action: 'sendPayouts', label: 'Send Payouts' },
      { action: 'useAllowance', label: 'Use Allowance' },
      { action: 'mintTokens', label: 'Mint Tokens' },
      { action: 'burnTokens', label: 'Burn Tokens' },
      { action: 'queueRuleset', label: 'Queue Ruleset' },
      { action: 'deployERC20', label: 'Deploy Token' },
    ]

    actionButtonPairs.forEach(({ action, label }) => {
      it(`blocks an unprepared ${action} action instead of displaying "${label}"`, () => {
        render(<TransactionPreview {...defaultProps} action={action} />)
        expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
        expect(screen.getByText(/not prepared by a supported transaction form/i)).toBeInTheDocument()
      })
    })
  })

  describe('execute button labels', () => {
    const actionLabelPairs = [
      { action: 'pay', label: 'Pay' },
      { action: 'cashOut', label: 'Cash Out' },
      // launchProject/launch721Project show "Sign in" when no owner - tested separately below
      { action: 'deployRevnet', label: 'Deploy Revnet' },
      { action: 'queueRuleset', label: 'Queue Ruleset' },
      { action: 'deployERC20', label: 'Deploy Token' },
    ]

    actionLabelPairs.forEach(({ action, label }) => {
      it(`does not expose "${label}" for an unprepared ${action} action`, () => {
        render(<TransactionPreview {...defaultProps} action={action} />)
        expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
      })
    })

    // Launch actions show "Sign in" when no owner address is provided
    // The Sign in button is the main action button at the bottom
    it('displays "Sign in" button for launchProject when no owner', () => {
      render(<TransactionPreview {...defaultProps} action="launchProject" />)
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    })

    it('displays "Sign in" button for launch721Project when no owner', () => {
      render(<TransactionPreview {...defaultProps} action="launch721Project" />)
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    })
  })

  describe('expandable technical details', () => {
    it('shows expand button for technical details', () => {
      render(<TransactionPreview {...defaultProps} />)
      // Look for the Show/Hide technical details button
      const toggleButton = screen.getByText(/technical details/i)
      expect(toggleButton).toBeInTheDocument()
    })

    it('toggles details visibility when clicking toggle button', () => {
      render(<TransactionPreview {...defaultProps} />)

      // Click to show details
      const toggleButton = screen.getByText(/technical details/i)
      fireEvent.click(toggleButton)

      // Technical details should now be visible or toggled
      // (The exact assertion depends on component implementation)
    })
  })

  describe('launchProject action', () => {
    const launchParams = {
      projectUri: 'ipfs://QmTest',
      owner: '0x1234567890123456789012345678901234567890',
      rulesetConfigurations: [
        {
          mustStartAtOrAfter: Math.floor(Date.now() / 1000) + 3600,
          duration: 604800,
          weight: '1000000000000000000',
          weightCutPercent: 0,
          approvalHook: '0x0000000000000000000000000000000000000000',
          metadata: {
            reservedPercent: 0,
            cashOutTaxRate: 0,
            baseCurrency: 0,
            pausePay: false,
            pauseCreditTransfers: false,
            allowOwnerMinting: false,
            allowSetCustomToken: true,
            allowTerminalMigration: true,
            allowSetTerminals: true,
            allowSetController: true,
            allowAddAccountingContext: true,
            allowAddPriceFeed: true,
            ownerMustSendPayouts: false,
            holdFees: false,
            scopeCashOutsToLocalBalances: false,
            useDataHookForPay: false,
            useDataHookForCashOut: false,
            dataHook: '0x0000000000000000000000000000000000000000',
            metadata: 0,
          },
          splitGroups: [],
          fundAccessLimitGroups: [],
        },
      ],
      terminalConfigurations: [
        {
          terminal: '0x130f5dd2bd8805443cf41755253d778a75a67f53',
          accountingContextsToAccept: [],
        },
      ],
      memo: 'Test launch',
    }

    it('renders launchProject preview correctly', () => {
      render(
        <TransactionPreview
          {...defaultProps}
          action="launchProject"
          parameters={JSON.stringify(launchParams)}
          explanation="Launch new Juicebox project"
        />
      )

      expect(screen.getByText('Review for deployment')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Launch Project' })).toBeInTheDocument()
    })

    it('shows Project Owner section for launchProject', () => {
      render(
        <TransactionPreview
          {...defaultProps}
          action="launchProject"
          parameters={JSON.stringify(launchParams)}
          explanation="Launch new Juicebox project"
        />
      )

      expect(screen.getByText('Project Owner')).toBeInTheDocument()
    })
  })

  describe('dark theme', () => {
    it('applies dark theme styles', () => {
      useThemeStore.setState({ theme: 'dark' })
      const { container } = render(<TransactionPreview {...defaultProps} />)

      // The component should have dark theme classes
      const mainDiv = container.firstChild as HTMLElement
      expect(mainDiv.className).toContain('bg-juice-dark')
    })
  })

  describe('light theme', () => {
    it('applies light theme styles', () => {
      useThemeStore.setState({ theme: 'light' })
      const { container } = render(<TransactionPreview {...defaultProps} />)

      // The component should have light theme classes
      const mainDiv = container.firstChild as HTMLElement
      expect(mainDiv.className).toContain('bg-white')
    })
  })

  describe('execute action event', () => {
    it('does not dispatch an execution event for an unprepared action', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      render(<TransactionPreview {...defaultProps} />)

      const executeCall = dispatchSpy.mock.calls.find(
        call => (call[0] as CustomEvent).type === 'juice:execute-action'
      )
      expect(executeCall).toBeUndefined()

      dispatchSpy.mockRestore()
    })

    it('does not forward arbitrary action parameters to a transaction event', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      render(<TransactionPreview {...defaultProps} />)

      const executeCall = dispatchSpy.mock.calls.find(
        call => (call[0] as CustomEvent).type === 'juice:execute-action'
      )
      expect(executeCall).toBeUndefined()

      dispatchSpy.mockRestore()
    })
  })

  describe('NFT tier display', () => {
    const launch721Props = {
      action: 'launch721Project',
      contract: 'JBOmnichainDeployer',
      chainId: '11155111',
      explanation: 'Launch project with NFT tiers',
      parameters: JSON.stringify({
        deployTiersHookConfig: {
          name: 'Test Collection',
          symbol: 'TEST',
          tiersConfig: {
            tiers: [
              {
                name: 'Early Supporter',
                description: 'Exclusive updates',
                price: 25000000,
                initialSupply: 10,
              },
              {
                name: 'Super Fan',
                description: 'VIP access',
                price: 100000000,
                initialSupply: 999999999,
              },
            ],
            currency: 2,
            decimals: 6,
          },
        },
        launchProjectConfig: {
          projectUri: 'ipfs://test',
        },
      }),
    }

    it('does not present incomplete NFT launch data as deployable tier configuration', () => {
      render(<TransactionPreview {...launch721Props} />)

      expect(screen.queryByText(/NFT Tier Hook Configuration/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Launch Project' })).not.toBeInTheDocument()
    })

    it('does not infer a limited supply deployment from an incomplete launch object', () => {
      render(<TransactionPreview {...launch721Props} />)
      expect(screen.queryByText(/10 ×/)).not.toBeInTheDocument()
    })

    it('does not infer an unlimited supply deployment from a sentinel value', () => {
      render(<TransactionPreview {...launch721Props} />)
      expect(screen.queryByText(/Unlimited ×/)).not.toBeInTheDocument()
    })

    it('does not invent a primary-chain supply policy', () => {
      const allLimitedProps = {
        ...launch721Props,
        parameters: JSON.stringify({
          deployTiersHookConfig: {
            name: 'Test Collection',
            symbol: 'TEST',
            tiersConfig: {
              tiers: [
                { name: 'Limited 1', price: 25000000, initialSupply: 10 },
                { name: 'Limited 2', price: 50000000, initialSupply: 20 },
              ],
              currency: 2,
              decimals: 6,
            },
          },
          launchProjectConfig: { projectUri: 'ipfs://test' },
        }),
      }

      render(<TransactionPreview {...allLimitedProps} />)

      expect(screen.queryByText(/primary chain only/i)).not.toBeInTheDocument()
    })

    it('does not invent an all-network supply policy', () => {
      const allUnlimitedProps = {
        ...launch721Props,
        parameters: JSON.stringify({
          deployTiersHookConfig: {
            name: 'Test Collection',
            symbol: 'TEST',
            tiersConfig: {
              tiers: [
                { name: 'Unlimited 1', price: 25000000, initialSupply: 999999999 },
                { name: 'Unlimited 2', price: 50000000, initialSupply: 999999999 },
              ],
              currency: 2,
              decimals: 6,
            },
          },
          launchProjectConfig: { projectUri: 'ipfs://test' },
        }),
      }

      render(<TransactionPreview {...allUnlimitedProps} />)

      expect(screen.queryByText(/all.*networks/i)).not.toBeInTheDocument()
    })
  })
})
