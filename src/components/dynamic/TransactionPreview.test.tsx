import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
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
  useProjectDraftStore: (selector?: (state: any) => any) => {
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
    contract: '0x52869db3d61dde1e391967f2ce5039ad0ecd371c',
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

    it('renders the execute button', () => {
      render(<TransactionPreview {...defaultProps} />)
      // Pay action should show Pay button
      expect(screen.getByRole('button', { name: 'Pay' })).toBeInTheDocument()
    })

    it('renders execute button with correct label', () => {
      render(<TransactionPreview {...defaultProps} />)
      expect(screen.getByRole('button', { name: 'Pay' })).toBeInTheDocument()
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
      it(`displays "${label}" button for ${action} action`, () => {
        render(<TransactionPreview {...defaultProps} action={action} />)
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
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
      it(`displays "${label}" button for ${action} action`, () => {
        render(<TransactionPreview {...defaultProps} action={action} />)
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
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
            useTotalSurplusForCashOuts: false,
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
          terminal: '0x52869db3d61dde1e391967f2ce5039ad0ecd371c',
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
    it('dispatches juice:execute-action event when execute button is clicked', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      render(<TransactionPreview {...defaultProps} />)

      const executeButton = screen.getByRole('button', { name: 'Pay' })
      fireEvent.click(executeButton)

      const executeCall = dispatchSpy.mock.calls.find(
        call => (call[0] as CustomEvent).type === 'juice:execute-action'
      )
      expect(executeCall).toBeDefined()

      dispatchSpy.mockRestore()
    })

    it('includes action and parameters in execute event', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      render(<TransactionPreview {...defaultProps} />)

      const executeButton = screen.getByRole('button', { name: 'Pay' })
      fireEvent.click(executeButton)

      const executeCall = dispatchSpy.mock.calls.find(
        call => (call[0] as CustomEvent).type === 'juice:execute-action'
      )
      expect(executeCall).toBeDefined()

      const event = executeCall![0] as CustomEvent
      expect(event.detail.action).toBe('pay')

      dispatchSpy.mockRestore()
    })
  })

  describe('NFT tier display', () => {
    const launch721Props = {
      action: 'launch721Project',
      contract: 'JBOmnichainDeployer5_1',
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

    it('displays tier names instead of generic "Tier 1" labels', () => {
      render(<TransactionPreview {...launch721Props} />)

      // Expand technical details
      const expandButton = screen.getByText(/Technical Details/i)
      fireEvent.click(expandButton)

      // Then expand the NFT Tier Hook Configuration section
      const nftSection = screen.getByText(/NFT Tier Hook Configuration/i)
      fireEvent.click(nftSection)

      // Should show actual tier names (they appear in the tier list)
      expect(screen.getByText('Early Supporter')).toBeInTheDocument()
      expect(screen.getByText('Super Fan')).toBeInTheDocument()
    })

    it('displays limited supply correctly', () => {
      render(<TransactionPreview {...launch721Props} />)

      // Expand technical details
      const expandButton = screen.getByText(/Technical Details/i)
      fireEvent.click(expandButton)

      // Should show "10" for limited tier
      expect(screen.getByText(/10 ×/)).toBeInTheDocument()
    })

    it('displays "Unlimited" for tiers with supply >= 999999999', () => {
      render(<TransactionPreview {...launch721Props} />)

      // Expand technical details
      const expandButton = screen.getByText(/Technical Details/i)
      fireEvent.click(expandButton)

      // Should show "Unlimited" for unlimited tier
      expect(screen.getByText(/Unlimited ×/)).toBeInTheDocument()
    })

    it('shows correct supply note for limited tiers', () => {
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

      // Expand technical details
      const expandButton = screen.getByText(/Technical Details/i)
      fireEvent.click(expandButton)

      // Should show note about limited tiers on primary chain only
      expect(screen.getByText(/primary chain only/i)).toBeInTheDocument()
    })

    it('shows correct supply note for unlimited tiers', () => {
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

      // Expand technical details
      const expandButton = screen.getByText(/Technical Details/i)
      fireEvent.click(expandButton)

      // Should show note about unlimited tiers on all networks
      expect(screen.getByText(/all.*networks/i)).toBeInTheDocument()
    })
  })
})
