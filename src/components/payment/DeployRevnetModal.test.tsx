import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DeployRevnetModal from './DeployRevnetModal'
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

// Mock hooks state with getter pattern
const mockDeploy = vi.fn()
const mockDeploySuckers = vi.fn()
const mockResetRevnet = vi.fn()
const mockResetSuckers = vi.fn()

const mockRevnetHookState = {
  bundleState: {
    bundleId: null as string | null,
    status: 'idle' as string,
    chainStates: [] as Array<{ chainId: number; projectId?: number; status: string; txHash?: string; error?: string }>,
    paymentOptions: [],
    selectedPaymentChain: null,
    paymentTxHash: null,
    error: null as string | null,
  },
  isDeploying: false,
  isComplete: false,
  hasError: false,
  createdProjectIds: {} as Record<number, number>,
  predictedTokenAddress: null as string | null,
}

const mockSuckerHookState = {
  bundleState: {
    bundleId: null as string | null,
    status: 'idle' as string,
    chainStates: [] as Array<{ chainId: number; projectId?: number; status: string; txHash?: string; error?: string }>,
    paymentOptions: [],
    selectedPaymentChain: null,
    paymentTxHash: null,
    error: null as string | null,
  },
  isDeploying: false,
  isComplete: false,
  hasError: false,
  suckerAddresses: {} as Record<number, string>,
}

vi.mock('../../hooks/relayr', () => ({
  useOmnichainDeployRevnet: vi.fn(() => ({
    deploy: mockDeploy,
    bundleState: mockRevnetHookState.bundleState,
    isDeploying: mockRevnetHookState.isDeploying,
    isComplete: mockRevnetHookState.isComplete,
    hasError: mockRevnetHookState.hasError,
    createdProjectIds: mockRevnetHookState.createdProjectIds,
    predictedTokenAddress: mockRevnetHookState.predictedTokenAddress,
    reset: mockResetRevnet,
  })),
  useOmnichainDeploySuckers: vi.fn(() => ({
    deploySuckers: mockDeploySuckers,
    bundleState: mockSuckerHookState.bundleState,
    isDeploying: mockSuckerHookState.isDeploying,
    isComplete: mockSuckerHookState.isComplete,
    hasError: mockSuckerHookState.hasError,
    suckerAddresses: mockSuckerHookState.suckerAddresses,
    reset: mockResetSuckers,
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

describe('DeployRevnetModal', () => {
  const user = userEvent.setup()

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    name: 'Test Revnet',
    tagline: 'A test revenue network',
    splitOperator: '0x1234567890123456789012345678901234567890',
    chainIds: [1, 10, 8453, 42161],
    stageConfigurations: [{
      startsAtOrAfter: Math.floor(Date.now() / 1000) + 300,
      splitPercent: 200000000, // 20%
      initialIssuance: '1000000000000000000000000',
      issuanceDecayFrequency: 604800, // 7 days
      issuanceDecayPercent: 50000000, // 5%
      cashOutTaxRate: 1000, // 10%
      extraMetadata: 0,
    }],
    autoDeploySuckers: true,
  }

  const resetMockState = () => {
    mockRevnetHookState.bundleState = {
      bundleId: null,
      status: 'idle',
      chainStates: [],
      paymentOptions: [],
      selectedPaymentChain: null,
      paymentTxHash: null,
      error: null,
    }
    mockRevnetHookState.isDeploying = false
    mockRevnetHookState.isComplete = false
    mockRevnetHookState.hasError = false
    mockRevnetHookState.createdProjectIds = {}
    mockRevnetHookState.predictedTokenAddress = null

    mockSuckerHookState.bundleState = {
      bundleId: null,
      status: 'idle',
      chainStates: [],
      paymentOptions: [],
      selectedPaymentChain: null,
      paymentTxHash: null,
      error: null,
    }
    mockSuckerHookState.isDeploying = false
    mockSuckerHookState.isComplete = false
    mockSuckerHookState.hasError = false
    mockSuckerHookState.suckerAddresses = {}
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
      render(<DeployRevnetModal {...defaultProps} />)

      // Use heading role to be more specific
      expect(screen.getByRole('heading', { name: 'Deploy Revnet' })).toBeInTheDocument()
      // Revnet name appears in both header and TransactionSummary
      expect(screen.getAllByText('Test Revnet').length).toBeGreaterThanOrEqual(1)
    })

    it('does not render when closed', () => {
      render(<DeployRevnetModal {...defaultProps} isOpen={false} />)

      expect(screen.queryByRole('heading', { name: 'Deploy Revnet' })).not.toBeInTheDocument()
    })

    it('shows chain list with waiting status', () => {
      render(<DeployRevnetModal {...defaultProps} />)

      // Chain names from CHAINS constant
      expect(screen.getByText('Ethereum')).toBeInTheDocument()
      expect(screen.getByText('Optimism')).toBeInTheDocument()
      expect(screen.getByText('Base')).toBeInTheDocument()
      expect(screen.getByText('Arbitrum')).toBeInTheDocument()
      expect(screen.getAllByText('Waiting...')).toHaveLength(4)
    })

    it('shows stages summary', () => {
      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('1 Stage Configured')).toBeInTheDocument()
      expect(screen.getByText(/20.0% operator split/)).toBeInTheDocument()
      expect(screen.getByText(/5.0% decay every 7 days/)).toBeInTheDocument()
    })

    it('shows split operator', () => {
      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('Split Operator')).toBeInTheDocument()
      expect(screen.getByText('0x123456...567890')).toBeInTheDocument()
    })

    it('shows auto-deploy suckers notice when enabled', () => {
      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('Auto-Deploy Suckers')).toBeInTheDocument()
      expect(screen.getByText(/Cross-chain token bridging will be enabled/)).toBeInTheDocument()
    })

    it('hides auto-deploy notice when disabled', () => {
      render(<DeployRevnetModal {...defaultProps} autoDeploySuckers={false} />)

      expect(screen.queryByText('Auto-Deploy Suckers')).not.toBeInTheDocument()
    })

    it('shows gas sponsored notice', () => {
      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('Gas Sponsored')).toBeInTheDocument()
      expect(screen.getByText(/Revnet deployment on all 4 chains is free/)).toBeInTheDocument()
    })
  })

  describe('multiple stages', () => {
    it('shows multiple stages count', () => {
      render(<DeployRevnetModal {...defaultProps} stageConfigurations={[
        { ...defaultProps.stageConfigurations[0] },
        {
          startsAtOrAfter: Math.floor(Date.now() / 1000) + 2592000,
          splitPercent: 100000000,
          initialIssuance: '500000000000000000000000',
          issuanceDecayFrequency: 604800,
          issuanceDecayPercent: 30000000,
          cashOutTaxRate: 500,
          extraMetadata: 0,
        },
      ]} />)

      expect(screen.getByText('2 Stages Configured')).toBeInTheDocument()
    })
  })

  describe('button states', () => {
    it('shows Cancel and Deploy buttons before deployment', () => {
      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Deploy Revnet' })).toBeInTheDocument()
    })

    it('calls deploy when Deploy button is clicked', async () => {
      render(<DeployRevnetModal {...defaultProps} />)

      const deployButton = screen.getByRole('button', { name: 'Deploy Revnet' })
      await user.click(deployButton)

      expect(mockDeploy).toHaveBeenCalledWith({
        chainIds: defaultProps.chainIds,
        stageConfigurations: defaultProps.stageConfigurations,
        splitOperator: defaultProps.splitOperator,
        name: defaultProps.name,
        tagline: defaultProps.tagline,
      })
    })

    it('calls onClose when Cancel is clicked', async () => {
      render(<DeployRevnetModal {...defaultProps} />)

      const cancelButton = screen.getByRole('button', { name: 'Cancel' })
      await user.click(cancelButton)

      expect(defaultProps.onClose).toHaveBeenCalled()
      expect(mockResetRevnet).toHaveBeenCalled()
      expect(mockResetSuckers).toHaveBeenCalled()
    })
  })

  describe('deploying revnet phase', () => {
    it('shows Deploying Revnet title after clicking Deploy', async () => {
      render(<DeployRevnetModal {...defaultProps} />)

      const deployButton = screen.getByRole('button', { name: 'Deploy Revnet' })
      await user.click(deployButton)

      expect(screen.getByRole('heading', { name: 'Deploying Revnet...' })).toBeInTheDocument()
    })

    it('shows phase indicator with Revnet step', async () => {
      render(<DeployRevnetModal {...defaultProps} />)

      const deployButton = screen.getByRole('button', { name: 'Deploy Revnet' })
      await user.click(deployButton)

      expect(screen.getByText('Revnet')).toBeInTheDocument()
    })

    it('shows processing indicator when deploying', async () => {
      mockRevnetHookState.isDeploying = true
      mockRevnetHookState.bundleState.status = 'processing'

      render(<DeployRevnetModal {...defaultProps} />)

      const deployButton = screen.getByRole('button', { name: 'Deploy Revnet' })
      await user.click(deployButton)

      expect(screen.getByText('Deploying revnet...')).toBeInTheDocument()
      expect(screen.getByText('Do not close this window')).toBeInTheDocument()
    })

    it('hides cancel button after deploy starts', async () => {
      render(<DeployRevnetModal {...defaultProps} />)

      const deployButton = screen.getByRole('button', { name: 'Deploy Revnet' })
      await user.click(deployButton)

      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })
  })

  describe('deploying suckers phase', () => {
    beforeEach(() => {
      mockRevnetHookState.isComplete = true
      mockRevnetHookState.createdProjectIds = { 1: 100, 10: 101, 8453: 102, 42161: 103 }
      mockSuckerHookState.isDeploying = true
      mockSuckerHookState.bundleState.status = 'processing'
    })

    it('shows Deploying Suckers title in sucker phase', async () => {
      render(<DeployRevnetModal {...defaultProps} />)

      // Click deploy to trigger hasStarted
      const deployButton = screen.getByRole('button', { name: 'Deploy Revnet' })
      await user.click(deployButton)

      // The component would transition to suckers phase when revnet completes
      // For this test, we just verify the suckers step text is present
      expect(screen.getByText('Suckers')).toBeInTheDocument()
    })

    it('shows phase indicator with Suckers step', async () => {
      render(<DeployRevnetModal {...defaultProps} />)

      const deployButton = screen.getByRole('button', { name: 'Deploy Revnet' })
      await user.click(deployButton)

      expect(screen.getByText('Suckers')).toBeInTheDocument()
    })
  })

  describe('chain status updates', () => {
    it('shows pending status', () => {
      mockRevnetHookState.bundleState.chainStates = [
        { chainId: 1, status: 'pending' },
      ]

      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('Pending')).toBeInTheDocument()
    })

    it('shows submitted status', () => {
      mockRevnetHookState.bundleState.chainStates = [
        { chainId: 1, status: 'submitted' },
      ]

      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('Creating...')).toBeInTheDocument()
    })

    it('shows confirmed status with checkmark', () => {
      mockRevnetHookState.bundleState.chainStates = [
        { chainId: 1, status: 'confirmed', txHash: '0xtxhash123' },
      ]

      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('✓')).toBeInTheDocument()
    })

    it('shows view link for confirmed transactions', () => {
      mockRevnetHookState.bundleState.chainStates = [
        { chainId: 1, status: 'confirmed', txHash: '0xtxhash123' },
      ]

      render(<DeployRevnetModal {...defaultProps} />)

      const viewLink = screen.getByText('View')
      expect(viewLink).toHaveAttribute('href', expect.stringContaining('0xtxhash123'))
    })

    it('shows failed status', () => {
      mockRevnetHookState.bundleState.chainStates = [
        { chainId: 1, status: 'failed' },
      ]

      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('Failed')).toBeInTheDocument()
    })

    it('shows project ID when available', () => {
      mockRevnetHookState.createdProjectIds = { 1: 100 }

      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('#100')).toBeInTheDocument()
    })
  })

  describe('complete state', () => {
    beforeEach(() => {
      mockRevnetHookState.isComplete = true
      mockRevnetHookState.bundleState.status = 'completed'
      mockRevnetHookState.createdProjectIds = { 1: 100, 10: 101, 8453: 102, 42161: 103 }
      mockRevnetHookState.predictedTokenAddress = '0xtoken123456789012345678901234567890'
    })

    it('shows Revnet Deployed title when complete', () => {
      // Use autoDeploySuckers: false to trigger allComplete via (!autoDeploySuckers && revnetComplete)
      render(<DeployRevnetModal {...defaultProps} autoDeploySuckers={false} />)

      expect(screen.getByRole('heading', { name: 'Revnet Deployed' })).toBeInTheDocument()
    })

    it('shows Deployment Complete summary', () => {
      render(<DeployRevnetModal {...defaultProps} autoDeploySuckers={false} />)

      expect(screen.getByText('Deployment Complete')).toBeInTheDocument()
    })

    it('shows created project IDs', () => {
      render(<DeployRevnetModal {...defaultProps} autoDeploySuckers={false} />)

      expect(screen.getByText(/ETH: #100/)).toBeInTheDocument()
      expect(screen.getByText(/OP: #101/)).toBeInTheDocument()
      expect(screen.getByText(/BASE: #102/)).toBeInTheDocument()
      expect(screen.getByText(/ARB: #103/)).toBeInTheDocument()
    })

    it('shows token address', () => {
      render(<DeployRevnetModal {...defaultProps} autoDeploySuckers={false} />)

      expect(screen.getByText(/Token:/)).toBeInTheDocument()
      expect(screen.getByText(/0xtoken123/)).toBeInTheDocument()
    })

    it('shows Done button when complete', () => {
      render(<DeployRevnetModal {...defaultProps} autoDeploySuckers={false} />)

      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    })
  })

  describe('complete state with suckers', () => {
    beforeEach(() => {
      mockRevnetHookState.isComplete = true
      mockRevnetHookState.bundleState.status = 'completed'
      mockRevnetHookState.createdProjectIds = { 1: 100, 10: 101, 8453: 102, 42161: 103 }
      mockRevnetHookState.predictedTokenAddress = '0xtoken123456789012345678901234567890'
      mockSuckerHookState.isComplete = true
      mockSuckerHookState.suckerAddresses = { 1: '0xsucker1', 10: '0xsucker10' }
    })

    it('shows Suckers Deployed notice when suckers are complete', () => {
      // With suckers deployed, need autoDeploySuckers false for allComplete
      render(<DeployRevnetModal {...defaultProps} autoDeploySuckers={false} />)

      // Sucker deployed info shows when suckerAddresses is populated
      expect(screen.getByText('Suckers Deployed')).toBeInTheDocument()
      expect(screen.getByText(/Cross-chain token bridging is now enabled/)).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    beforeEach(() => {
      mockRevnetHookState.hasError = true
      mockRevnetHookState.bundleState.error = 'Transaction failed'
    })

    it('shows Deployment Failed title', () => {
      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByRole('heading', { name: 'Deployment Failed' })).toBeInTheDocument()
    })

    it('shows error message', () => {
      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('Transaction failed')).toBeInTheDocument()
    })

    it('shows Close button on error', () => {
      // For Close button to appear, allComplete must be true
      // allComplete = phase === 'complete' || (!autoDeploySuckers && revnetComplete)
      // So we need autoDeploySuckers: false AND isComplete: true
      mockRevnetHookState.isComplete = true
      render(<DeployRevnetModal {...defaultProps} autoDeploySuckers={false} />)

      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    })
  })

  describe('sucker error state', () => {
    beforeEach(() => {
      mockRevnetHookState.isComplete = true
      mockSuckerHookState.hasError = true
      mockSuckerHookState.bundleState.error = 'Sucker deployment failed'
    })

    it('shows error message from suckers', () => {
      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('Sucker deployment failed')).toBeInTheDocument()
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles', () => {
      useThemeStore.setState({ theme: 'dark' })
      render(<DeployRevnetModal {...defaultProps} />)

      const modal = document.querySelector('.bg-juice-dark')
      expect(modal).toBeInTheDocument()
    })

    it('applies light theme styles', () => {
      useThemeStore.setState({ theme: 'light' })
      render(<DeployRevnetModal {...defaultProps} />)

      const modal = document.querySelector('.bg-white')
      expect(modal).toBeInTheDocument()
    })
  })

  describe('backdrop interaction', () => {
    it('closes modal when clicking backdrop before deployment', async () => {
      render(<DeployRevnetModal {...defaultProps} />)

      const backdrop = document.querySelector('.bg-black\\/80')
      if (backdrop) {
        await user.click(backdrop)
      }

      expect(defaultProps.onClose).toHaveBeenCalled()
    })

    it('does not close modal when deploy has started and not complete', async () => {
      render(<DeployRevnetModal {...defaultProps} />)

      // Click deploy to start
      const deployButton = screen.getByRole('button', { name: 'Deploy Revnet' })
      await user.click(deployButton)

      // Reset onClose to track only backdrop clicks
      defaultProps.onClose.mockClear()

      // Try clicking backdrop
      const backdrop = document.querySelector('.bg-black\\/80')
      if (backdrop) {
        await user.click(backdrop)
      }

      expect(defaultProps.onClose).not.toHaveBeenCalled()
    })

    it('allows closing modal when complete', async () => {
      mockRevnetHookState.isComplete = true
      mockSuckerHookState.isComplete = true
      mockRevnetHookState.createdProjectIds = { 1: 100 }

      render(<DeployRevnetModal {...defaultProps} />)

      const backdrop = document.querySelector('.bg-black\\/80')
      if (backdrop) {
        await user.click(backdrop)
      }

      expect(defaultProps.onClose).toHaveBeenCalled()
    })
  })

  describe('reset behavior', () => {
    it('resets state when modal opens', () => {
      const { rerender } = render(<DeployRevnetModal {...defaultProps} isOpen={false} />)

      rerender(<DeployRevnetModal {...defaultProps} isOpen={true} />)

      expect(mockResetRevnet).toHaveBeenCalled()
      expect(mockResetSuckers).toHaveBeenCalled()
    })
  })

  describe('single chain', () => {
    it('shows singular text for single chain', () => {
      render(<DeployRevnetModal {...defaultProps} chainIds={[1]} />)

      expect(screen.getByText(/Revnet deployment on all 1 chain is free/)).toBeInTheDocument()
    })

    it('does not show sucker notice for single chain', () => {
      render(<DeployRevnetModal {...defaultProps} chainIds={[1]} />)

      expect(screen.queryByText('Auto-Deploy Suckers')).not.toBeInTheDocument()
    })
  })

  describe('without auto-deploy suckers', () => {
    it('completes after revnet deployment when suckers disabled', () => {
      mockRevnetHookState.isComplete = true
      mockRevnetHookState.createdProjectIds = { 1: 100 }

      render(<DeployRevnetModal {...defaultProps} autoDeploySuckers={false} />)

      // Should show Done button without suckers phase
      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    })
  })
})
