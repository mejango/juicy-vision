import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CreateRevnetForm from './CreateRevnetForm'
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
  pinMetadata: vi.fn().mockResolvedValue('ipfs://QmRevnetMetadata'),
}))

// Mock DeployRevnetModal
vi.mock('../payment', () => ({
  DeployRevnetModal: vi.fn(({ isOpen, onClose, name, chainIds, stageConfigurations, autoDeploySuckers }) =>
    isOpen ? (
      <div data-testid="deploy-modal">
        <div>Name: {name}</div>
        <div>Chains: {chainIds?.length || 0}</div>
        <div>Stages: {stageConfigurations?.length || 0}</div>
        <div>Auto Suckers: {autoDeploySuckers ? 'yes' : 'no'}</div>
        <button onClick={onClose}>Close</button>
      </div>
    ) : null
  ),
}))

// Get mocked wagmi
import { useAccount } from 'wagmi'
const mockedUseAccount = useAccount as Mock

describe('CreateRevnetForm', () => {
  const user = userEvent.setup()

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
    localStorage.clear()
    vi.clearAllMocks()

    mockedUseAccount.mockReturnValue({
      address: '0x1234567890123456789012345678901234567890',
      isConnected: true,
    })
  })

  describe('initial render', () => {
    it('renders the form with header', () => {
      render(<CreateRevnetForm />)

      expect(screen.getByRole('heading', { name: 'Deploy Revnet' })).toBeInTheDocument()
    })

    it('renders every chain option with a single-chain default', () => {
      render(<CreateRevnetForm />)

      expect(screen.getByText(ETH_LABEL)).toBeInTheDocument()
      expect(screen.getByText(OP_LABEL)).toBeInTheDocument()
      expect(screen.getByText(BASE_LABEL)).toBeInTheDocument()
      expect(screen.getByText(ARB_LABEL)).toBeInTheDocument()
      expect(screen.getByText(/on 1 chain/)).toBeInTheDocument()
    })

    it('renders revnet info fields', () => {
      render(<CreateRevnetForm />)

      expect(screen.getByPlaceholderText('My Revnet')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('A revenue network for...')).toBeInTheDocument()
    })

    it('renders one stage by default', () => {
      render(<CreateRevnetForm />)

      expect(screen.getByText('Stages (1)')).toBeInTheDocument()
      expect(screen.getByText('Stage 1')).toBeInTheDocument()
    })

    it('renders gas sponsored notice', () => {
      render(<CreateRevnetForm />)

      expect(screen.getByText('Gas Sponsored')).toBeInTheDocument()
      expect(screen.getByText(/exact protocol creation fee is shown before deployment/i)).toBeInTheDocument()
    })

    it('renders deploy button disabled initially', () => {
      render(<CreateRevnetForm />)

      const button = screen.getByRole('button', { name: /Deploy Revnet/i })
      expect(button).toBeDisabled()
    })

    it('renders auto-deploy suckers checkbox checked by default', () => {
      render(<CreateRevnetForm />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeChecked()
    })
  })

  describe('form validation', () => {
    it('enables deploy button when name and ticker are filled', async () => {
      render(<CreateRevnetForm />)

      const nameInput = screen.getByPlaceholderText('My Revnet')
      await user.type(nameInput, 'Test Revnet')
      await user.type(screen.getByPlaceholderText('TOKEN'), 'TEST')

      const button = screen.getByRole('button', { name: /Deploy Revnet/i })
      expect(button).not.toBeDisabled()
    })

    it('disables deploy button when no chains selected', async () => {
      render(<CreateRevnetForm defaultChainIds={ALL_CHAIN_IDS} />)

      // Fill name
      const nameInput = screen.getByPlaceholderText('My Revnet')
      await user.type(nameInput, 'Test Revnet')
      await user.type(screen.getByPlaceholderText('TOKEN'), 'TEST')

      // Deselect all chains
      const ethButton = screen.getByText(ETH_LABEL)
      const opButton = screen.getByText(OP_LABEL)
      const baseButton = screen.getByText(BASE_LABEL)
      const arbButton = screen.getByText(ARB_LABEL)

      await user.click(ethButton)
      await user.click(opButton)
      await user.click(baseButton)
      await user.click(arbButton)

      const deployButton = screen.getByRole('button', { name: /Deploy Revnet/i })
      expect(deployButton).toBeDisabled()
    })
  })

  describe('chain selection', () => {
    it('toggles chain selection on click', async () => {
      render(<CreateRevnetForm defaultChainIds={[ALL_CHAIN_IDS[0]]} />)

      const ethButton = screen.getByText(ETH_LABEL)

      // Initially selected (has purple styling)
      expect(ethButton.className).toContain('bg-purple-')

      // Click to deselect
      await user.click(ethButton)

      // Should no longer have purple styling
      expect(ethButton.className).not.toContain('border-purple-')

      // Click to reselect
      await user.click(ethButton)
      expect(ethButton.className).toContain('bg-purple-')
    })

    it('shows synchronized start time when multiple chains selected', () => {
      render(<CreateRevnetForm defaultChainIds={ALL_CHAIN_IDS} />)

      expect(screen.getByText('Synchronized Start Time')).toBeInTheDocument()
      expect(screen.getByText('All chains activate at the same time')).toBeInTheDocument()
    })

    it('hides synchronized start time for single chain', async () => {
      render(<CreateRevnetForm defaultChainIds={[ALL_CHAIN_IDS[0]]} />)

      expect(screen.queryByText('Synchronized Start Time')).not.toBeInTheDocument()
    })
  })

  describe('stage management', () => {
    it('adds a new stage when clicking add stage button', async () => {
      render(<CreateRevnetForm />)

      const addButton = screen.getByText('+ Add Stage')
      await user.click(addButton)

      expect(screen.getByText('Stages (2)')).toBeInTheDocument()
      expect(screen.getByText('Stage 1')).toBeInTheDocument()
      expect(screen.getByText('Stage 2')).toBeInTheDocument()
    })

    it('removes a stage when clicking remove button', async () => {
      render(<CreateRevnetForm />)

      // Add a second stage first
      const addButton = screen.getByText('+ Add Stage')
      await user.click(addButton)

      expect(screen.getByText('Stages (2)')).toBeInTheDocument()

      // Remove the second stage
      const removeButtons = screen.getAllByText('Remove')
      await user.click(removeButtons[1])

      expect(screen.getByText('Stages (1)')).toBeInTheDocument()
    })

    it('does not allow removing the last stage', async () => {
      render(<CreateRevnetForm />)

      // With only one stage, there should be no remove button
      expect(screen.queryByText('Remove')).not.toBeInTheDocument()
    })

    it('updates stage fields', async () => {
      render(<CreateRevnetForm />)

      // Find the split percent input (one of the stage inputs)
      const splitInputs = screen.getAllByRole('spinbutton')
      const splitPercentInput = splitInputs.find(input =>
        input.getAttribute('max') === '100' &&
        input.getAttribute('step') === '0.1' &&
        (input as HTMLInputElement).value === '20'
      ) as HTMLInputElement

      if (splitPercentInput) {
        await user.clear(splitPercentInput)
        await user.type(splitPercentInput, '30')
        expect(splitPercentInput.value).toBe('30')
      }
    })
  })

  describe('modal interaction', () => {
    it('opens modal when deploy button clicked', async () => {
      render(<CreateRevnetForm />)

      const nameInput = screen.getByPlaceholderText('My Revnet')
      await user.type(nameInput, 'My Test Revnet')
      await user.type(screen.getByPlaceholderText('TOKEN'), 'TEST')

      const deployButton = screen.getByRole('button', { name: /Deploy Revnet/i })
      await user.click(deployButton)

      expect(screen.getByTestId('deploy-modal')).toBeInTheDocument()
      expect(screen.getByText('Name: My Test Revnet')).toBeInTheDocument()
    })

    it('passes stage count to modal', async () => {
      render(<CreateRevnetForm />)

      // Add stages
      const addButton = screen.getByText('+ Add Stage')
      await user.click(addButton)
      await user.click(addButton)

      const nameInput = screen.getByPlaceholderText('My Revnet')
      await user.type(nameInput, 'Test')
      await user.type(screen.getByPlaceholderText('TOKEN'), 'TEST')

      const deployButton = screen.getByRole('button', { name: /Deploy Revnet/i })
      await user.click(deployButton)

      expect(screen.getByText('Stages: 3')).toBeInTheDocument()
    })

    it('passes auto suckers config to modal', async () => {
      render(<CreateRevnetForm />)

      const nameInput = screen.getByPlaceholderText('My Revnet')
      await user.type(nameInput, 'Test')
      await user.type(screen.getByPlaceholderText('TOKEN'), 'TEST')

      const deployButton = screen.getByRole('button', { name: /Deploy Revnet/i })
      await user.click(deployButton)

      expect(screen.getByText('Auto Suckers: yes')).toBeInTheDocument()
    })

    it('passes disabled auto suckers to modal when unchecked', async () => {
      render(<CreateRevnetForm />)

      // Uncheck auto suckers
      const checkbox = screen.getByRole('checkbox')
      await user.click(checkbox)

      const nameInput = screen.getByPlaceholderText('My Revnet')
      await user.type(nameInput, 'Test')
      await user.type(screen.getByPlaceholderText('TOKEN'), 'TEST')

      const deployButton = screen.getByRole('button', { name: /Deploy Revnet/i })
      await user.click(deployButton)

      expect(screen.getByText('Auto Suckers: no')).toBeInTheDocument()
    })

    it('shows chain count on button for multi-chain', () => {
      render(<CreateRevnetForm defaultChainIds={ALL_CHAIN_IDS} />)

      const button = screen.getByRole('button', { name: /Deploy Revnet on 4 Chains/i })
      expect(button).toBeInTheDocument()
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles', () => {
      useThemeStore.setState({ theme: 'dark' })
      render(<CreateRevnetForm />)

      const container = document.querySelector('.bg-juice-dark-lighter')
      expect(container).toBeInTheDocument()
    })

    it('applies light theme styles', () => {
      useThemeStore.setState({ theme: 'light' })
      render(<CreateRevnetForm />)

      const container = document.querySelector('.bg-white')
      expect(container).toBeInTheDocument()
    })
  })

  describe('default props', () => {
    it('does not expose an editable operator address', () => {
      render(<CreateRevnetForm />)

      expect(document.querySelector('input[placeholder*="0x"]')).not.toBeInTheDocument()
    })

    it('uses default chain IDs from prop', () => {
      render(<CreateRevnetForm defaultChainIds={ALL_CHAIN_IDS.slice(0, 2)} />)

      // Should only show 2 chains as selected - button text shows plural form
      const button = screen.getByRole('button', { name: /Deploy Revnet on 2 Chains/i })
      expect(button).toBeInTheDocument()
    })
  })

  describe('input fields', () => {
    it('updates name field', async () => {
      render(<CreateRevnetForm />)

      const nameInput = screen.getByPlaceholderText('My Revnet') as HTMLInputElement
      await user.type(nameInput, 'New Revnet Name')

      expect(nameInput.value).toBe('New Revnet Name')
    })

    it('updates tagline field', async () => {
      render(<CreateRevnetForm />)

      const taglineInput = screen.getByPlaceholderText('A revenue network for...') as HTMLInputElement
      await user.type(taglineInput, 'This is a test tagline')

      expect(taglineInput.value).toBe('This is a test tagline')
    })

    it('does not render a split operator input', () => {
      render(<CreateRevnetForm />)

      expect(document.querySelector('input[placeholder*="0x"]')).not.toBeInTheDocument()
    })

    it('toggles auto-deploy suckers checkbox', async () => {
      render(<CreateRevnetForm />)

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeChecked()

      await user.click(checkbox)
      expect(checkbox).not.toBeChecked()

      await user.click(checkbox)
      expect(checkbox).toBeChecked()
    })
  })

  describe('wallet connection handling', () => {
    it('opens managed sign-in before revnet deployment', async () => {
      useAuthStore.setState({ mode: 'self_custody', token: null, user: null })
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

      render(<CreateRevnetForm />)

      const nameInput = screen.getByPlaceholderText('My Revnet')
      await user.type(nameInput, 'Test')
      await user.type(screen.getByPlaceholderText('TOKEN'), 'TEST')

      const button = screen.getByRole('button', { name: /Sign in to deploy/i })
      await user.click(button)

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'juice:open-auth-modal',
        })
      )

      dispatchSpy.mockRestore()
    })
  })

  describe('stage configuration details', () => {
    it('renders all stage configuration fields', () => {
      render(<CreateRevnetForm />)

      // Check for stage field labels
      expect(screen.getByText('Delay (days)')).toBeInTheDocument()
      expect(screen.getByText('Project operator split (%)')).toBeInTheDocument()
      expect(screen.getByText('Issuance Rate')).toBeInTheDocument()
      expect(screen.getByText('Decay Every (days)')).toBeInTheDocument()
      expect(screen.getByText('Decay (%)')).toBeInTheDocument()
      expect(screen.getByText('Cash-out curve rate (%)')).toBeInTheDocument()
    })

    it('shows "Days after prev" label for non-first stages', async () => {
      render(<CreateRevnetForm />)

      const addButton = screen.getByText('+ Add Stage')
      await user.click(addButton)

      expect(screen.getByText('Delay (days)')).toBeInTheDocument()
      expect(screen.getByText('Days after prev')).toBeInTheDocument()
    })

    it('renders tokens/ETH hint under issuance rate', () => {
      render(<CreateRevnetForm />)

      expect(screen.getByText('Tokens/ETH')).toBeInTheDocument()
    })
  })

  describe('sucker configuration', () => {
    it('shows sucker description text', () => {
      render(<CreateRevnetForm />)

      expect(screen.getByText(/Auto-deploy suckers for cross-chain token bridging/)).toBeInTheDocument()
      expect(screen.getByText(/Suckers enable \$TOKEN bridging between chains/)).toBeInTheDocument()
    })
  })

  describe('info text', () => {
    it('shows revnet immutability warning', () => {
      render(<CreateRevnetForm />)

      expect(screen.getByText(/Once deployed, stage configurations cannot be changed/)).toBeInTheDocument()
    })
  })
})
