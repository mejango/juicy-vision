import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LaunchProjectModal from './LaunchProjectModal'
import { useThemeStore, useAuthStore } from '../../stores'
import { ALL_CHAIN_IDS, CHAINS } from '../../constants'

// Derive chain IDs and labels from the same constants the component renders and
// the verification util validates against, so these tests are env-independent
// (testnet Sepolia vs mainnet) and don't trip the "Unsupported chain ID"
// verification warning that would disable Create and add a second Cancel button.
const CHAIN_IDS = [...ALL_CHAIN_IDS]
const [C0, C1, C2, C3] = CHAIN_IDS
const NAME0 = CHAINS[C0].name
const NAME1 = CHAINS[C1].name
const NAME2 = CHAINS[C2].name
const NAME3 = CHAINS[C3].name
const SHORT0 = CHAINS[C0].shortName
const SHORT1 = CHAINS[C1].shortName
const SHORT2 = CHAINS[C2].shortName
const SHORT3 = CHAINS[C3].shortName

// Mock wagmi
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    address: '0x1234567890123456789012345678901234567890',
    isConnected: true,
  })),
}))

// Mock useManagedWallet
vi.mock('../../hooks', () => ({
  useManagedWallet: vi.fn(() => ({
    address: '0xabcdef1234567890abcdef1234567890abcdef12',
    isLoading: false,
  })),
}))

// Mock useOmnichainLaunchProject with dynamic return values
const mockLaunch = vi.fn()
const mockReset = vi.fn()

// Use a getter pattern for dynamic mock values
const mockHookState = {
  bundleState: {
    bundleId: null as string | null,
    status: 'idle' as string,
    chainStates: [] as Array<{ chainId: number; projectId?: number; status: string; txHash?: string; error?: string }>,
    paymentOptions: [],
    selectedPaymentChain: null,
    paymentTxHash: null,
    error: null as string | null,
  },
  isLaunching: false,
  isComplete: false,
  hasError: false,
  createdProjectIds: {} as Record<number, number>,
}

vi.mock('../../hooks/relayr', () => ({
  useOmnichainLaunchProject: vi.fn(() => ({
    launch: mockLaunch,
    bundleState: mockHookState.bundleState,
    isLaunching: mockHookState.isLaunching,
    isComplete: mockHookState.isComplete,
    hasError: mockHookState.hasError,
    createdProjectIds: mockHookState.createdProjectIds,
    reset: mockReset,
  })),
}))

vi.mock('../../services/omnichainDeployer', () => ({
  fetchProjectCreationFee: vi.fn().mockResolvedValue(1_000_000_000_000_000n),
}))

// Mock createPortal to render directly
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom')
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  }
})

/**
 * The modal is a native <dialog>: the dimming layer is the ::backdrop
 * pseudo-element, so a "backdrop click" is a click whose target is the dialog
 * element itself, outside the content wrapper.
 */
async function clickBackdrop(user: ReturnType<typeof userEvent.setup>) {
  const dialog = document.querySelector('dialog')
  if (!dialog) throw new Error('modal dialog is not open')
  await user.click(dialog)
}

describe('LaunchProjectModal', () => {
  const user = userEvent.setup()

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    projectName: 'Test Project',
    owner: '0x1234567890123456789012345678901234567890',
    projectUri: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3gq2t5lz2wqzzx4m6w6v7s7qm',
    chainIds: CHAIN_IDS,
    rulesetConfig: {
      mustStartAtOrAfter: 0,
      duration: 0,
      weight: '1000000000000000000000000',
      weightCutPercent: 0,
      approvalHook: '0x0000000000000000000000000000000000000000',
      metadata: {
        reservedPercent: 0,
        cashOutTaxRate: 0,
        baseCurrency: 1,
        pausePay: false,
        pauseCreditTransfers: false,
        allowOwnerMinting: true,
        allowSetCustomToken: false,
        allowTerminalMigration: false,
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
    terminalConfigurations: [{
      terminal: '0x130f5dd2bd8805443cf41755253d778a75a67f53',
      accountingContextsToAccept: [{
        token: '0x000000000000000000000000000000000000EEEe',
        decimals: 18,
        currency: 61166,
      }],
    }],
    synchronizedStartTime: Math.floor(Date.now() / 1000) + 300,
    memo: 'Test launch',
  }

  const resetMockState = () => {
    mockHookState.bundleState = {
      bundleId: null,
      status: 'idle',
      chainStates: [],
      paymentOptions: [],
      selectedPaymentChain: null,
      paymentTxHash: null,
      error: null,
    }
    mockHookState.isLaunching = false
    mockHookState.isComplete = false
    mockHookState.hasError = false
    mockHookState.createdProjectIds = {}
  }

  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    useAuthStore.setState({ mode: 'self_custody' })
    vi.clearAllMocks()
    resetMockState()
    defaultProps.onClose = vi.fn()
  })

  describe('initial render', () => {
    it('renders the modal when open', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Launch Project')).toBeInTheDocument()
      // Project name appears in both header and TransactionSummary
      expect(screen.getAllByText('Test Project').length).toBeGreaterThanOrEqual(1)
    })

    it('does not render when closed', () => {
      render(<LaunchProjectModal {...defaultProps} isOpen={false} />)

      expect(screen.queryByText('Launch Project')).not.toBeInTheDocument()
    })

    it('shows synchronized start time', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Synchronized Start Time')).toBeInTheDocument()
      expect(screen.getByText('All chains will activate at the same time')).toBeInTheDocument()
    })

    it('shows chain list with waiting status', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      // Chain names from CHAINS constant
      expect(screen.getByText(NAME0)).toBeInTheDocument()
      expect(screen.getByText(NAME1)).toBeInTheDocument()
      expect(screen.getByText(NAME2)).toBeInTheDocument()
      expect(screen.getByText(NAME3)).toBeInTheDocument()
      expect(screen.getAllByText('Waiting...')).toHaveLength(4)
    })

    it('shows gas sponsorship separately from the protocol creation fee', async () => {
      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Gas Sponsored')).toBeInTheDocument()
      expect(await screen.findByText(/Protocol creation fee included:/)).toHaveTextContent(
        /0.004 ETH total across 4 chains/,
      )
    })

    it('shows project owner', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      // Component shows "Project owner (Wallet)" when using wallet address
      expect(screen.getByText('Project owner (Wallet)')).toBeInTheDocument()
      expect(screen.getByText('0x123456...567890')).toBeInTheDocument()
    })
  })

  describe('button states', () => {
    it('shows Cancel and Create buttons before launch', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create Projects' })).toBeInTheDocument()
    })

    it('calls launch when Create button is clicked', async () => {
      render(<LaunchProjectModal {...defaultProps} />)

      const createButton = screen.getByRole('button', { name: 'Create Projects' })
      await waitFor(() => expect(createButton).toBeEnabled())
      await user.click(createButton)

      expect(mockLaunch).toHaveBeenCalledWith({
        chainIds: defaultProps.chainIds,
        owner: defaultProps.owner,
        projectUri: defaultProps.projectUri,
        rulesetConfigurations: [defaultProps.rulesetConfig],
        terminalConfigurations: defaultProps.terminalConfigurations,
        memo: defaultProps.memo,
        forceSelfCustody: false,
      })
    })

    it('calls onClose when Cancel is clicked', async () => {
      render(<LaunchProjectModal {...defaultProps} />)

      const cancelButton = screen.getByRole('button', { name: 'Cancel' })
      await user.click(cancelButton)

      expect(defaultProps.onClose).toHaveBeenCalled()
      expect(mockReset).toHaveBeenCalled()
    })
  })

  describe('launching state', () => {
    it('shows creating title after clicking Create', async () => {
      render(<LaunchProjectModal {...defaultProps} />)

      // Click create to trigger hasStarted state
      const createButton = screen.getByRole('button', { name: 'Create Projects' })
      await waitFor(() => expect(createButton).toBeEnabled())
      await user.click(createButton)

      // Component sets hasStarted to true after clicking, showing "Creating Projects..."
      expect(screen.getByText('Creating Projects...')).toBeInTheDocument()
    })

    it('shows processing indicator when launching', async () => {
      mockHookState.isLaunching = true
      mockHookState.bundleState.status = 'processing'

      render(<LaunchProjectModal {...defaultProps} />)

      // Simulate clicking create to set hasStarted
      const createButton = screen.getByRole('button', { name: 'Create Projects' })
      await waitFor(() => expect(createButton).toBeEnabled())
      await user.click(createButton)

      expect(screen.getByText('Creating projects...')).toBeInTheDocument()
      expect(screen.getByText('Do not close this window')).toBeInTheDocument()
    })

    it('hides cancel button after launch starts', async () => {
      render(<LaunchProjectModal {...defaultProps} />)

      const createButton = screen.getByRole('button', { name: 'Create Projects' })
      await waitFor(() => expect(createButton).toBeEnabled())
      await user.click(createButton)

      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })
  })

  describe('chain status updates', () => {
    it('shows pending status', () => {
      mockHookState.bundleState.chainStates = [
        { chainId: C0, status: 'pending' },
      ]

      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Pending')).toBeInTheDocument()
    })

    it('shows submitted/creating status', () => {
      mockHookState.bundleState.chainStates = [
        { chainId: C0, status: 'submitted' },
      ]

      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Creating...')).toBeInTheDocument()
    })

    it('shows confirmed status with checkmark', () => {
      mockHookState.bundleState.chainStates = [
        { chainId: C0, status: 'confirmed', txHash: '0xtxhash123' },
      ]

      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('✓')).toBeInTheDocument()
    })

    it('shows view link for confirmed transactions', () => {
      mockHookState.bundleState.chainStates = [
        { chainId: C0, status: 'confirmed', txHash: '0xtxhash123' },
      ]

      render(<LaunchProjectModal {...defaultProps} />)

      const viewLink = screen.getByText('View')
      expect(viewLink).toHaveAttribute('href', expect.stringContaining('0xtxhash123'))
    })

    it('shows failed status', () => {
      mockHookState.bundleState.chainStates = [
        { chainId: C0, status: 'failed' },
      ]

      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Failed')).toBeInTheDocument()
    })

    it('shows project ID when available', () => {
      mockHookState.createdProjectIds = { [C0]: 100 }

      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('#100')).toBeInTheDocument()
    })
  })

  describe('complete state', () => {
    beforeEach(() => {
      mockHookState.isComplete = true
      mockHookState.bundleState.status = 'completed'
      mockHookState.createdProjectIds = { [C0]: 100, [C1]: 101, [C2]: 102, [C3]: 103 }
      mockHookState.bundleState.chainStates = [
        { chainId: C0, status: 'confirmed', txHash: '0xtx1' },
        { chainId: C1, status: 'confirmed', txHash: '0xtx10' },
        { chainId: C2, status: 'confirmed', txHash: '0xtx8453' },
        { chainId: C3, status: 'confirmed', txHash: '0xtx42161' },
      ]
    })

    it('shows Projects Created title', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Projects Created')).toBeInTheDocument()
    })

    it('shows created project IDs summary', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Created Project IDs')).toBeInTheDocument()
      expect(screen.getByText(new RegExp(`${SHORT0}: #100`))).toBeInTheDocument()
      expect(screen.getByText(new RegExp(`${SHORT1}: #101`))).toBeInTheDocument()
      expect(screen.getByText(new RegExp(`${SHORT2}: #102`))).toBeInTheDocument()
      expect(screen.getByText(new RegExp(`${SHORT3}: #103`))).toBeInTheDocument()
    })

    it('confirms cross-chain bridges were deployed atomically', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText(/Cross-chain bridges were deployed atomically/)).toBeInTheDocument()
    })

    it('shows Done button', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    beforeEach(() => {
      mockHookState.hasError = true
      mockHookState.bundleState.status = 'failed'
      mockHookState.bundleState.error = 'Transaction failed'
    })

    it('shows Launch Failed title', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Launch Failed')).toBeInTheDocument()
    })

    it('shows error message', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Transaction failed')).toBeInTheDocument()
    })

    it('shows Close button', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles', () => {
      useThemeStore.setState({ theme: 'dark' })
      render(<LaunchProjectModal {...defaultProps} />)

      const modal = document.querySelector('.bg-juice-dark')
      expect(modal).toBeInTheDocument()
    })

    it('applies light theme styles', () => {
      useThemeStore.setState({ theme: 'light' })
      render(<LaunchProjectModal {...defaultProps} />)

      const modal = document.querySelector('.bg-white')
      expect(modal).toBeInTheDocument()
    })
  })

  describe('backdrop interaction', () => {
    it('closes modal when clicking backdrop before launch', async () => {
      render(<LaunchProjectModal {...defaultProps} />)

      await clickBackdrop(user)

      expect(defaultProps.onClose).toHaveBeenCalled()
    })

    it('does not close modal when launch has started and not complete', async () => {
      render(<LaunchProjectModal {...defaultProps} />)

      // Click create to start the launch (sets hasStarted = true)
      const createButton = screen.getByRole('button', { name: 'Create Projects' })
      await waitFor(() => expect(createButton).toBeEnabled())
      await user.click(createButton)

      // Reset the onClose mock to track only backdrop clicks
      defaultProps.onClose.mockClear()

      await clickBackdrop(user)

      expect(defaultProps.onClose).not.toHaveBeenCalled()
    })

    it('allows closing modal when complete', async () => {
      mockHookState.isComplete = true
      mockHookState.bundleState.status = 'completed'
      mockHookState.createdProjectIds = { [C0]: 100 }

      render(<LaunchProjectModal {...defaultProps} />)

      await clickBackdrop(user)

      expect(defaultProps.onClose).toHaveBeenCalled()
    })
  })

  describe('reset behavior', () => {
    it('resets state when modal opens', () => {
      const { rerender } = render(<LaunchProjectModal {...defaultProps} isOpen={false} />)

      rerender(<LaunchProjectModal {...defaultProps} isOpen={true} />)

      expect(mockReset).toHaveBeenCalled()
    })
  })

  describe('single chain', () => {
    it('shows the exact single-chain protocol fee', async () => {
      render(<LaunchProjectModal {...defaultProps} chainIds={[C0]} />)

      expect(await screen.findByText(/Protocol creation fee included:/)).toHaveTextContent(
        /0.001 ETH total across 1 chain/,
      )
    })

    it('shows Create Project (singular) button', () => {
      render(<LaunchProjectModal {...defaultProps} chainIds={[C0]} />)

      expect(screen.getByRole('button', { name: 'Create Project' })).toBeInTheDocument()
    })

    it('does not show sucker hint for single chain when complete', () => {
      mockHookState.isComplete = true
      mockHookState.createdProjectIds = { [C0]: 100 }

      render(<LaunchProjectModal {...defaultProps} chainIds={[C0]} />)

      expect(screen.queryByText(/Deploy suckers/)).not.toBeInTheDocument()
    })

    it('hides synchronized start subtitle for single chain', () => {
      render(<LaunchProjectModal {...defaultProps} chainIds={[C0]} />)

      // Still shows the start time, but not the "all chains" subtitle
      expect(screen.getByText('Synchronized Start Time')).toBeInTheDocument()
      expect(screen.queryByText('All chains will activate at the same time')).not.toBeInTheDocument()
    })
  })
})
