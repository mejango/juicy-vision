import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CreateProjectForm from './CreateProjectForm'
import { useThemeStore, useAuthStore } from '../../stores'
import { ALL_CHAIN_IDS, CHAINS } from '../../constants'

// Chain toggle labels come from the same constants the component renders, so
// these tests pass in either mainnet or testnet build mode without drifting.
const [ETH_LABEL, OP_LABEL, BASE_LABEL, ARB_LABEL] = ALL_CHAIN_IDS.map(
  id => CHAINS[id].shortName
)

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

// Mock relayr services
vi.mock('../../services/relayr', () => ({
  calculateSynchronizedStartTime: vi.fn(() => Math.floor(Date.now() / 1000) + 300),
}))

vi.mock('../../services/ipfsPinning', () => ({
  pinMetadata: vi.fn().mockResolvedValue('ipfs://QmProjectMetadata'),
}))

// Mock LaunchProjectModal
vi.mock('../payment', () => ({
  LaunchProjectModal: vi.fn(({ isOpen, onClose, projectName, chainIds }) =>
    isOpen ? (
      <div data-testid="launch-modal">
        <div>Project: {projectName}</div>
        <div>Chains: {chainIds?.length || 0}</div>
        <button onClick={onClose}>Close</button>
      </div>
    ) : null
  ),
}))

// Get mocked wagmi
import { useAccount } from 'wagmi'
const mockedUseAccount = useAccount as Mock

describe('CreateProjectForm', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    useAuthStore.setState({ mode: 'self_custody' })
    localStorage.clear()
    vi.clearAllMocks()

    mockedUseAccount.mockReturnValue({
      address: '0x1234567890123456789012345678901234567890',
      isConnected: true,
    })
  })

  describe('initial render', () => {
    it('renders the form with header', () => {
      render(<CreateProjectForm defaultChainIds={[ALL_CHAIN_IDS[0]]} />)

      expect(screen.getByText('Create New Project')).toBeInTheDocument()
    })

    it('renders every chain option with a single-chain default', () => {
      render(<CreateProjectForm />)

      expect(screen.getByText(ETH_LABEL)).toBeInTheDocument()
      expect(screen.getByText(OP_LABEL)).toBeInTheDocument()
      expect(screen.getByText(BASE_LABEL)).toBeInTheDocument()
      expect(screen.getByText(ARB_LABEL)).toBeInTheDocument()
      expect(screen.getByText(/Launch on 1 chain/)).toBeInTheDocument()
    })

    it('renders project info fields', () => {
      render(<CreateProjectForm defaultChainIds={ALL_CHAIN_IDS} />)

      expect(screen.getByPlaceholderText('My Project')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('What is this project about?')).toBeInTheDocument()
    })

    it('renders token settings fields', () => {
      render(<CreateProjectForm />)

      expect(screen.getByPlaceholderText('1000000')).toBeInTheDocument()
    })

    it('renders gas sponsored notice', () => {
      render(<CreateProjectForm />)

      expect(screen.getByText('Gas Sponsored')).toBeInTheDocument()
      expect(screen.getByText(/exact protocol creation fee is shown before deployment/i)).toBeInTheDocument()
    })

    it('renders create button disabled initially', () => {
      render(<CreateProjectForm defaultChainIds={ALL_CHAIN_IDS} />)

      const button = screen.getByRole('button', { name: /Create Project/i })
      expect(button).toBeDisabled()
    })
  })

  describe('form validation', () => {
    it('enables create button when project name is filled', async () => {
      render(<CreateProjectForm defaultChainIds={[ALL_CHAIN_IDS[0]]} />)

      const nameInput = screen.getByPlaceholderText('My Project')
      await user.type(nameInput, 'Test Project')

      const button = screen.getByRole('button', { name: /Create Project/i })
      expect(button).not.toBeDisabled()
    })

    it('disables create button when no chains selected', async () => {
      render(<CreateProjectForm defaultChainIds={ALL_CHAIN_IDS} />)

      // Fill name
      const nameInput = screen.getByPlaceholderText('My Project')
      await user.type(nameInput, 'Test Project')

      // Deselect all chains
      const ethButton = screen.getByText(ETH_LABEL)
      const opButton = screen.getByText(OP_LABEL)
      const baseButton = screen.getByText(BASE_LABEL)
      const arbButton = screen.getByText(ARB_LABEL)

      await user.click(ethButton)
      await user.click(opButton)
      await user.click(baseButton)
      await user.click(arbButton)

      const createButton = screen.getByRole('button', { name: /Create Project/i })
      expect(createButton).toBeDisabled()
    })
  })

  describe('chain selection', () => {
    it('toggles chain selection on click', async () => {
      render(<CreateProjectForm defaultChainIds={[ALL_CHAIN_IDS[0]]} />)

      const ethButton = screen.getByText(ETH_LABEL)

      // Initially selected (has orange styling)
      expect(ethButton.className).toContain('bg-juice-orange')

      // Click to deselect
      await user.click(ethButton)

      // Should no longer have orange styling
      expect(ethButton.className).not.toContain('bg-juice-orange')

      // Click to reselect
      await user.click(ethButton)
      expect(ethButton.className).toContain('bg-juice-orange')
    })

    it('shows synchronized start time when multiple chains selected', () => {
      render(<CreateProjectForm defaultChainIds={ALL_CHAIN_IDS} />)

      expect(screen.getByText('Synchronized Start Time')).toBeInTheDocument()
      expect(screen.getByText('All chains activate at the same time')).toBeInTheDocument()
    })

    it('hides synchronized start time for single chain', async () => {
      render(<CreateProjectForm defaultChainIds={[ALL_CHAIN_IDS[0]]} />)

      expect(screen.queryByText('Synchronized Start Time')).not.toBeInTheDocument()
    })
  })

  describe('advanced settings', () => {
    it('toggles advanced settings visibility', async () => {
      render(<CreateProjectForm defaultChainIds={ALL_CHAIN_IDS} />)

      // Initially hidden
      expect(screen.queryByText('Payout Limit')).not.toBeInTheDocument()

      // Show advanced
      await user.click(screen.getByText(/Show Advanced Settings/))

      expect(screen.getByText('Payout Limit')).toBeInTheDocument()
      expect(screen.getByText('Surplus Allowance')).toBeInTheDocument()
      expect(screen.getByText('Permissions')).toBeInTheDocument()

      // Hide advanced
      await user.click(screen.getByText(/Hide Advanced Settings/))

      expect(screen.queryByText('Payout Limit')).not.toBeInTheDocument()
    })

    it('updates payout limit type', async () => {
      render(<CreateProjectForm />)

      await user.click(screen.getByText(/Show Advanced Settings/))

      // Find all "Limited" buttons - first one is payout limit, second is surplus
      const limitedButtons = screen.getAllByRole('button', { name: 'Limited' })
      await user.click(limitedButtons[0]) // Click payout limit "Limited" button

      // Should show amount input (there are multiple spinbuttons, check for placeholder)
      const amountInputs = screen.getAllByPlaceholderText('0')
      expect(amountInputs.length).toBeGreaterThan(0)
    })

    it('updates permission checkboxes', async () => {
      render(<CreateProjectForm />)

      await user.click(screen.getByText(/Show Advanced Settings/))

      const pausePayCheckbox = screen.getByLabelText(/Start with payments paused/)
      expect(pausePayCheckbox).not.toBeChecked()

      await user.click(pausePayCheckbox)
      expect(pausePayCheckbox).toBeChecked()
    })
  })

  describe('modal interaction', () => {
    it('opens modal when create button clicked', async () => {
      render(<CreateProjectForm />)

      const nameInput = screen.getByPlaceholderText('My Project')
      await user.type(nameInput, 'My Test Project')

      const createButton = screen.getByRole('button', { name: /Create Project/i })
      await user.click(createButton)

      expect(screen.getByTestId('launch-modal')).toBeInTheDocument()
      expect(screen.getByText('Project: My Test Project')).toBeInTheDocument()
    })

    it('shows chain count on button for multi-chain', () => {
      render(<CreateProjectForm defaultChainIds={ALL_CHAIN_IDS} />)

      const button = screen.getByRole('button', { name: /Create Project on 4 Chains/i })
      expect(button).toBeInTheDocument()
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles', () => {
      useThemeStore.setState({ theme: 'dark' })
      render(<CreateProjectForm />)

      const container = document.querySelector('.bg-juice-dark-lighter')
      expect(container).toBeInTheDocument()
    })

    it('applies light theme styles', () => {
      useThemeStore.setState({ theme: 'light' })
      render(<CreateProjectForm />)

      const container = document.querySelector('.bg-white')
      expect(container).toBeInTheDocument()
    })
  })

  describe('default props', () => {
    it('does not accept an owner override', () => {
      render(<CreateProjectForm />)

      expect(screen.queryByPlaceholderText(/owner/i)).not.toBeInTheDocument()
    })

    it('uses default chain IDs from prop', () => {
      render(<CreateProjectForm defaultChainIds={ALL_CHAIN_IDS.slice(0, 2)} />)

      // Should only show 2 chains as selected
      expect(screen.getByText(/Launch on 2 chain/)).toBeInTheDocument()
    })
  })

  describe('input fields', () => {
    it('updates name field', async () => {
      render(<CreateProjectForm />)

      const nameInput = screen.getByPlaceholderText('My Project') as HTMLInputElement
      await user.type(nameInput, 'New Project Name')

      expect(nameInput.value).toBe('New Project Name')
    })

    it('updates description field', async () => {
      render(<CreateProjectForm />)

      const descInput = screen.getByPlaceholderText('What is this project about?') as HTMLTextAreaElement
      await user.type(descInput, 'This is a test description')

      expect(descInput.value).toBe('This is a test description')
    })

    it('updates issuance rate field', async () => {
      render(<CreateProjectForm />)

      const rateInput = screen.getByPlaceholderText('1000000') as HTMLInputElement
      await user.clear(rateInput)
      await user.type(rateInput, '500000')

      expect(rateInput.value).toBe('500000')
    })

    it('updates reserved percent field', async () => {
      render(<CreateProjectForm />)

      const reservedInputs = screen.getAllByRole('spinbutton')
      const reservedInput = reservedInputs.find(input =>
        input.getAttribute('placeholder') === '0' &&
        input.getAttribute('max') === '100'
      ) as HTMLInputElement

      if (reservedInput) {
        await user.clear(reservedInput)
        await user.type(reservedInput, '25')
        expect(reservedInput.value).toBe('25')
      }
    })

    it('updates memo field', async () => {
      render(<CreateProjectForm />)

      const memoInput = screen.getByPlaceholderText('Launching my project...') as HTMLInputElement
      await user.type(memoInput, 'Test memo message')

      expect(memoInput.value).toBe('Test memo message')
    })
  })

  describe('wallet connection handling', () => {
    it('opens wallet panel when not connected', async () => {
      mockedUseAccount.mockReturnValue({
        address: undefined,
        isConnected: false,
      })

      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

      render(<CreateProjectForm />)

      const nameInput = screen.getByPlaceholderText('My Project')
      await user.type(nameInput, 'Test')

      const button = screen.getByRole('button', { name: /Connect wallet to create/i })
      await user.click(button)

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'juice:open-wallet-panel',
        })
      )

      dispatchSpy.mockRestore()
    })
  })
})
