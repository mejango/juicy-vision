import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DeployRevnetModal from './DeployRevnetModal'
import { useThemeStore, useAuthStore } from '../../stores'
import { ALL_CHAIN_IDS, CHAINS } from '../../constants'

// Derive chain IDs and labels from the same constants the component renders and
// the verification util validates against, so these tests are env-independent
// (testnet Sepolia vs mainnet) and don't trip the "Unsupported chain ID"
// verification warning that would disable Deploy and add a second Cancel button.
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
    persistedTxHashes: null,
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

describe('DeployRevnetModal', () => {
  const user = userEvent.setup()

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    name: 'Test Revnet',
    ticker: 'TEST',
    tagline: 'A test revenue network',
    projectUri: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3gq2t5lz2wqzzx4m6w6v7s7qm',
    splitOperator: '0xabcdef1234567890abcdef1234567890abcdef12',
    chainIds: CHAIN_IDS,
    stageConfigurations: [{
      startsAtOrAfter: Math.floor(Date.now() / 1000) + 300,
      splitPercent: 2000, // 20% (out of 10,000)
      initialIssuance: '1000000000000000000000000',
      issuanceCutFrequency: 604800, // 7 days
      issuanceCutPercent: 50000000, // 5%
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
    useAuthStore.setState({
      mode: 'managed',
      token: 'test-token',
      user: {
        id: 'test-user',
        email: 'test@juicy.vision',
        privacyMode: 'open_book',
        hasCustodialWallet: true,
      },
    })
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
      expect(screen.getByText(NAME0)).toBeInTheDocument()
      expect(screen.getByText(NAME1)).toBeInTheDocument()
      expect(screen.getByText(NAME2)).toBeInTheDocument()
      expect(screen.getByText(NAME3)).toBeInTheDocument()
      expect(screen.getAllByText('Waiting...')).toHaveLength(4)
    })

    it('shows stages summary', () => {
      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('1 Stage Configured')).toBeInTheDocument()
      expect(screen.getByText(/20.0% operator split/)).toBeInTheDocument()
      expect(screen.getByText(/5.0% issuance cut every 7 days/)).toBeInTheDocument()
    })

    it('shows split operator', () => {
      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('Project operator')).toBeInTheDocument()
      expect(screen.getByText('0xabcdef...cdef12')).toBeInTheDocument()
    })

    it('shows auto-deploy suckers notice when enabled', () => {
      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('Auto-Deploy Suckers')).toBeInTheDocument()
      expect(screen.getByText(/Cross-chain bridges will be deployed atomically/)).toBeInTheDocument()
    })

    it('hides auto-deploy notice when disabled', () => {
      render(<DeployRevnetModal {...defaultProps} autoDeploySuckers={false} />)

      expect(screen.queryByText('Auto-Deploy Suckers')).not.toBeInTheDocument()
    })

    it('shows gas sponsorship separately from the protocol creation fee', async () => {
      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('Gas Sponsored')).toBeInTheDocument()
      expect(await screen.findByText(/Protocol creation fee included:/)).toHaveTextContent(
        /0.004 ETH total across 4 chains/,
      )
    })
  })

  describe('multiple stages', () => {
    it('shows multiple stages count', () => {
      render(<DeployRevnetModal {...defaultProps} stageConfigurations={[
        { ...defaultProps.stageConfigurations[0] },
        {
          startsAtOrAfter: Math.floor(Date.now() / 1000) + 2592000,
          splitPercent: 1000, // 10% (out of 10,000)
          initialIssuance: '500000000000000000000000',
          issuanceCutFrequency: 604800,
          issuanceCutPercent: 30000000,
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
        ticker: defaultProps.ticker,
        tagline: defaultProps.tagline,
        projectUri: defaultProps.projectUri,
        configureSuckers: true,
      })
    })

    it('calls onClose when Cancel is clicked', async () => {
      render(<DeployRevnetModal {...defaultProps} />)

      const cancelButton = screen.getByRole('button', { name: 'Cancel' })
      await user.click(cancelButton)

      expect(defaultProps.onClose).toHaveBeenCalled()
      expect(mockResetRevnet).toHaveBeenCalled()
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

      expect(screen.getByText('Revnet and cross-chain bridges')).toBeInTheDocument()
    })

    it('shows processing indicator when deploying', async () => {
      mockRevnetHookState.isDeploying = true
      mockRevnetHookState.bundleState.status = 'processing'

      render(<DeployRevnetModal {...defaultProps} />)

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

  describe('atomic bridge deployment', () => {
    beforeEach(() => {
      mockRevnetHookState.isComplete = true
      mockRevnetHookState.createdProjectIds = { [C0]: 100, [C1]: 101, [C2]: 102, [C3]: 103 }
      mockSuckerHookState.isDeploying = true
      mockSuckerHookState.bundleState.status = 'processing'
    })

    it('does not expose a separate post-deploy sucker transaction', async () => {
      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.queryByText('Deploying Suckers')).not.toBeInTheDocument()
      expect(screen.getByText('Revnet and cross-chain bridges')).toBeInTheDocument()
    })

    it('keeps bridge execution within the reviewed Revnet bundle', async () => {
      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.queryByText('Suckers')).not.toBeInTheDocument()
      expect(mockDeploySuckers).not.toHaveBeenCalled()
    })
  })

  describe('chain status updates', () => {
    it('shows pending status', () => {
      mockRevnetHookState.bundleState.chainStates = [
        { chainId: C0, status: 'pending' },
      ]

      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('Pending')).toBeInTheDocument()
    })

    it('shows submitted status', () => {
      mockRevnetHookState.bundleState.chainStates = [
        { chainId: C0, status: 'submitted' },
      ]

      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('Creating...')).toBeInTheDocument()
    })

    it('shows confirmed status with checkmark', () => {
      mockRevnetHookState.bundleState.chainStates = [
        { chainId: C0, status: 'confirmed', txHash: '0xtxhash123' },
      ]

      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('✓')).toBeInTheDocument()
    })

    it('shows view link for confirmed transactions', () => {
      mockRevnetHookState.bundleState.chainStates = [
        { chainId: C0, status: 'confirmed', txHash: '0xtxhash123' },
      ]

      render(<DeployRevnetModal {...defaultProps} />)

      const viewLink = screen.getByText('View')
      expect(viewLink).toHaveAttribute('href', expect.stringContaining('0xtxhash123'))
    })

    it('shows failed status', () => {
      mockRevnetHookState.bundleState.chainStates = [
        { chainId: C0, status: 'failed' },
      ]

      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('Failed')).toBeInTheDocument()
    })

    it('shows project ID when available', () => {
      mockRevnetHookState.createdProjectIds = { [C0]: 100 }

      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.getByText('#100')).toBeInTheDocument()
    })
  })

  describe('complete state', () => {
    beforeEach(() => {
      mockRevnetHookState.isComplete = true
      mockRevnetHookState.bundleState.status = 'completed'
      mockRevnetHookState.createdProjectIds = { [C0]: 100, [C1]: 101, [C2]: 102, [C3]: 103 }
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

      expect(screen.getByText(new RegExp(`${SHORT0}: #100`))).toBeInTheDocument()
      expect(screen.getByText(new RegExp(`${SHORT1}: #101`))).toBeInTheDocument()
      expect(screen.getByText(new RegExp(`${SHORT2}: #102`))).toBeInTheDocument()
      expect(screen.getByText(new RegExp(`${SHORT3}: #103`))).toBeInTheDocument()
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
      mockRevnetHookState.createdProjectIds = { [C0]: 100, [C1]: 101, [C2]: 102, [C3]: 103 }
      mockRevnetHookState.predictedTokenAddress = '0xtoken123456789012345678901234567890'
      mockSuckerHookState.isComplete = true
      mockSuckerHookState.suckerAddresses = { 1: '0xsucker1', 10: '0xsucker10' }
    })

    it('shows Suckers Deployed notice when suckers are complete', () => {
      render(<DeployRevnetModal {...defaultProps} />)

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

  describe('detached sucker state', () => {
    beforeEach(() => {
      mockRevnetHookState.isComplete = true
      mockSuckerHookState.hasError = true
      mockSuckerHookState.bundleState.error = 'Sucker deployment failed'
    })

    it('does not surface an unrelated detached sucker error', () => {
      render(<DeployRevnetModal {...defaultProps} />)

      expect(screen.queryByText('Sucker deployment failed')).not.toBeInTheDocument()
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

      await clickBackdrop(user)

      expect(defaultProps.onClose).toHaveBeenCalled()
    })

    it('does not close modal when deploy has started and not complete', async () => {
      render(<DeployRevnetModal {...defaultProps} />)

      // Click deploy to start
      const deployButton = screen.getByRole('button', { name: 'Deploy Revnet' })
      await user.click(deployButton)

      // Reset onClose to track only backdrop clicks
      defaultProps.onClose.mockClear()

      await clickBackdrop(user)

      expect(defaultProps.onClose).not.toHaveBeenCalled()
    })

    it('allows closing modal when complete', async () => {
      mockRevnetHookState.isComplete = true
      mockSuckerHookState.isComplete = true
      mockRevnetHookState.createdProjectIds = { [C0]: 100 }

      render(<DeployRevnetModal {...defaultProps} />)

      await clickBackdrop(user)

      expect(defaultProps.onClose).toHaveBeenCalled()
    })
  })

  describe('reset behavior', () => {
    it('resets state when modal opens', () => {
      const { rerender } = render(<DeployRevnetModal {...defaultProps} isOpen={false} />)

      rerender(<DeployRevnetModal {...defaultProps} isOpen={true} />)

      expect(mockResetRevnet).toHaveBeenCalled()
    })
  })

  describe('single chain', () => {
    it('shows the exact single-chain protocol fee', async () => {
      render(<DeployRevnetModal {...defaultProps} chainIds={[C0]} />)

      expect(await screen.findByText(/Protocol creation fee included:/)).toHaveTextContent(
        /0.001 ETH total across 1 chain/,
      )
    })

    it('does not show sucker notice for single chain', () => {
      render(<DeployRevnetModal {...defaultProps} chainIds={[C0]} />)

      expect(screen.queryByText('Auto-Deploy Suckers')).not.toBeInTheDocument()
    })
  })

  describe('without auto-deploy suckers', () => {
    it('completes after revnet deployment when suckers disabled', () => {
      mockRevnetHookState.isComplete = true
      mockRevnetHookState.createdProjectIds = { [C0]: 100 }

      render(<DeployRevnetModal {...defaultProps} autoDeploySuckers={false} />)

      // Should show Done button without suckers phase
      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    })
  })
})
