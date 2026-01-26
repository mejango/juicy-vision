import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LaunchProjectModal from './LaunchProjectModal'
import { useThemeStore, useAuthStore } from '../../stores'

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

// Mock createPortal to render directly
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom')
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  }
})

describe('LaunchProjectModal', () => {
  const user = userEvent.setup()

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    projectName: 'Test Project',
    owner: '0x1234567890123456789012345678901234567890',
    projectUri: 'QmXyz123',
    chainIds: [1, 10, 8453, 42161],
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
        useTotalSurplusForCashOuts: false,
        useDataHookForPay: false,
        useDataHookForCashOut: false,
        dataHook: '0x0000000000000000000000000000000000000000',
        metadata: 0,
      },
      splitGroups: [],
      fundAccessLimitGroups: [],
    },
    terminalConfigurations: [{
      terminal: '0x52869db3d61dde1e391967f2ce5039ad0ecd371c',
      accountingContextsToAccept: [{
        token: '0x000000000000000000000000000000000000EEEe',
        decimals: 18,
        currency: 1,
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
      expect(screen.getByText('Ethereum')).toBeInTheDocument()
      expect(screen.getByText('Optimism')).toBeInTheDocument()
      expect(screen.getByText('Base')).toBeInTheDocument()
      expect(screen.getByText('Arbitrum')).toBeInTheDocument()
      expect(screen.getAllByText('Waiting...')).toHaveLength(4)
    })

    it('shows gas sponsored notice', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Gas Sponsored')).toBeInTheDocument()
      expect(screen.getByText(/Project creation on all 4 chains is free/)).toBeInTheDocument()
    })

    it('shows project owner', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Project Owner')).toBeInTheDocument()
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
      await user.click(createButton)

      expect(mockLaunch).toHaveBeenCalledWith({
        chainIds: defaultProps.chainIds,
        owner: defaultProps.owner,
        projectUri: defaultProps.projectUri,
        rulesetConfigurations: [defaultProps.rulesetConfig],
        terminalConfigurations: defaultProps.terminalConfigurations,
        memo: defaultProps.memo,
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
      await user.click(createButton)

      expect(screen.getByText('Creating projects...')).toBeInTheDocument()
      expect(screen.getByText('Do not close this window')).toBeInTheDocument()
    })

    it('hides cancel button after launch starts', async () => {
      render(<LaunchProjectModal {...defaultProps} />)

      const createButton = screen.getByRole('button', { name: 'Create Projects' })
      await user.click(createButton)

      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })
  })

  describe('chain status updates', () => {
    it('shows pending status', () => {
      mockHookState.bundleState.chainStates = [
        { chainId: 1, status: 'pending' },
      ]

      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Pending')).toBeInTheDocument()
    })

    it('shows submitted/creating status', () => {
      mockHookState.bundleState.chainStates = [
        { chainId: 1, status: 'submitted' },
      ]

      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Creating...')).toBeInTheDocument()
    })

    it('shows confirmed status with checkmark', () => {
      mockHookState.bundleState.chainStates = [
        { chainId: 1, status: 'confirmed', txHash: '0xtxhash123' },
      ]

      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('✓')).toBeInTheDocument()
    })

    it('shows view link for confirmed transactions', () => {
      mockHookState.bundleState.chainStates = [
        { chainId: 1, status: 'confirmed', txHash: '0xtxhash123' },
      ]

      render(<LaunchProjectModal {...defaultProps} />)

      const viewLink = screen.getByText('View')
      expect(viewLink).toHaveAttribute('href', expect.stringContaining('0xtxhash123'))
    })

    it('shows failed status', () => {
      mockHookState.bundleState.chainStates = [
        { chainId: 1, status: 'failed' },
      ]

      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Failed')).toBeInTheDocument()
    })

    it('shows project ID when available', () => {
      mockHookState.createdProjectIds = { 1: 100 }

      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('#100')).toBeInTheDocument()
    })
  })

  describe('complete state', () => {
    beforeEach(() => {
      mockHookState.isComplete = true
      mockHookState.bundleState.status = 'completed'
      mockHookState.createdProjectIds = { 1: 100, 10: 101, 8453: 102, 42161: 103 }
      mockHookState.bundleState.chainStates = [
        { chainId: 1, status: 'confirmed', txHash: '0xtx1' },
        { chainId: 10, status: 'confirmed', txHash: '0xtx10' },
        { chainId: 8453, status: 'confirmed', txHash: '0xtx8453' },
        { chainId: 42161, status: 'confirmed', txHash: '0xtx42161' },
      ]
    })

    it('shows Projects Created title', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Projects Created')).toBeInTheDocument()
    })

    it('shows created project IDs summary', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText('Created Project IDs')).toBeInTheDocument()
      expect(screen.getByText(/ETH: #100/)).toBeInTheDocument()
      expect(screen.getByText(/OP: #101/)).toBeInTheDocument()
      expect(screen.getByText(/BASE: #102/)).toBeInTheDocument()
      expect(screen.getByText(/ARB: #103/)).toBeInTheDocument()
    })

    it('shows sucker deployment hint for multi-chain', () => {
      render(<LaunchProjectModal {...defaultProps} />)

      expect(screen.getByText(/Deploy suckers to link these projects/)).toBeInTheDocument()
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

      const backdrop = document.querySelector('.bg-black\\/80')
      if (backdrop) {
        await user.click(backdrop)
      }

      expect(defaultProps.onClose).toHaveBeenCalled()
    })

    it('does not close modal when launch has started and not complete', async () => {
      render(<LaunchProjectModal {...defaultProps} />)

      // Click create to start the launch (sets hasStarted = true)
      const createButton = screen.getByRole('button', { name: 'Create Projects' })
      await user.click(createButton)

      // Reset the onClose mock to track only backdrop clicks
      defaultProps.onClose.mockClear()

      // Try clicking backdrop - should not close because hasStarted is true and not complete
      const backdrop = document.querySelector('.bg-black\\/80')
      if (backdrop) {
        await user.click(backdrop)
      }

      expect(defaultProps.onClose).not.toHaveBeenCalled()
    })

    it('allows closing modal when complete', async () => {
      mockHookState.isComplete = true
      mockHookState.bundleState.status = 'completed'
      mockHookState.createdProjectIds = { 1: 100 }

      render(<LaunchProjectModal {...defaultProps} />)

      const backdrop = document.querySelector('.bg-black\\/80')
      if (backdrop) {
        await user.click(backdrop)
      }

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
    it('shows singular text for single chain', () => {
      render(<LaunchProjectModal {...defaultProps} chainIds={[1]} />)

      expect(screen.getByText(/Project creation on all 1 chain is free/)).toBeInTheDocument()
    })

    it('shows Create Project (singular) button', () => {
      render(<LaunchProjectModal {...defaultProps} chainIds={[1]} />)

      expect(screen.getByRole('button', { name: 'Create Project' })).toBeInTheDocument()
    })

    it('does not show sucker hint for single chain when complete', () => {
      mockHookState.isComplete = true
      mockHookState.createdProjectIds = { 1: 100 }

      render(<LaunchProjectModal {...defaultProps} chainIds={[1]} />)

      expect(screen.queryByText(/Deploy suckers/)).not.toBeInTheDocument()
    })

    it('hides synchronized start subtitle for single chain', () => {
      render(<LaunchProjectModal {...defaultProps} chainIds={[1]} />)

      // Still shows the start time, but not the "all chains" subtitle
      expect(screen.getByText('Synchronized Start Time')).toBeInTheDocument()
      expect(screen.queryByText('All chains will activate at the same time')).not.toBeInTheDocument()
    })
  })
})
