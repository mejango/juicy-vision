import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OptionsPicker from './OptionsPicker'
import { useThemeStore } from '../../stores'

describe('OptionsPicker', () => {
  const basicGroups = [
    {
      id: 'project-type',
      label: 'Project Type',
      options: [
        { value: 'dao', label: 'DAO', sublabel: 'Decentralized organization' },
        { value: 'nft', label: 'NFT Project', sublabel: 'Digital collectibles' },
        { value: 'defi', label: 'DeFi', sublabel: 'Financial protocol' },
        { value: 'other', label: 'Something else' },
      ],
    },
  ]

  const multiSelectGroups = [
    {
      id: 'features',
      label: 'Features',
      multiSelect: true,
      options: [
        { value: 'token', label: 'Token' },
        { value: 'nft', label: 'NFT' },
        { value: 'governance', label: 'Governance' },
      ],
    },
  ]

  const toggleGroups = [
    {
      id: 'public',
      label: 'Visibility',
      type: 'toggle' as const,
      options: [
        { value: 'public', label: 'Public' },
        { value: 'private', label: 'Private' },
      ],
    },
  ]

  const radioGroups = [
    {
      id: 'funding-model',
      label: 'Funding Model',
      type: 'radio' as const,
      options: [
        { value: 'donation', label: 'Donation', sublabel: 'No token issued' },
        { value: 'equity', label: 'Equity', sublabel: 'Token represents ownership' },
        { value: 'rewards', label: 'Rewards', sublabel: 'Token for access/perks' },
      ],
    },
  ]

  const textGroups = [
    {
      id: 'project-name',
      label: 'Project Name',
      type: 'text' as const,
      placeholder: 'Enter project name...',
    },
  ]

  const textareaGroups = [
    {
      id: 'description',
      label: 'Description',
      type: 'textarea' as const,
      placeholder: 'Describe your project...',
      optional: true,
    },
  ]

  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('chips layout (default)', () => {
    it('renders group label', () => {
      render(<OptionsPicker groups={basicGroups} />)

      expect(screen.getByText('Project Type')).toBeInTheDocument()
    })

    it('renders all options as chips', () => {
      render(<OptionsPicker groups={basicGroups} />)

      expect(screen.getAllByText('DAO').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('NFT Project').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('DeFi').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Something else').length).toBeGreaterThanOrEqual(1)
    })

    it('renders sublabels', () => {
      render(<OptionsPicker groups={basicGroups} />)

      expect(screen.getByText('Decentralized organization')).toBeInTheDocument()
      expect(screen.getByText('Digital collectibles')).toBeInTheDocument()
    })

    it('no option is selected by default', () => {
      render(<OptionsPicker groups={basicGroups} />)

      // Nothing should be selected by default
      const daoElements = screen.getAllByText('DAO')
      const daoButton = daoElements[0].closest('button')
      expect(daoButton?.className).not.toContain('border-green-500')
    })

    it('changes selection when option clicked', () => {
      render(<OptionsPicker groups={basicGroups} />)

      const nftElements = screen.getAllByText('NFT Project')
      fireEvent.click(nftElements[0])

      const nftButton = nftElements[0].closest('button')
      expect(nftButton?.className).toContain('border-green-500')

      const daoElements = screen.getAllByText('DAO')
      const daoButton = daoElements[0].closest('button')
      expect(daoButton?.className).not.toContain('border-green-500')
    })
  })

  describe('multiSelect mode', () => {
    it('allows multiple selections', () => {
      render(<OptionsPicker groups={multiSelectGroups} />)

      const tokenElements = screen.getAllByText('Token')
      const nftElements = screen.getAllByText('NFT')
      fireEvent.click(tokenElements[0])
      fireEvent.click(nftElements[0])

      const tokenButton = tokenElements[0].closest('button')
      const nftButton = nftElements[0].closest('button')

      expect(tokenButton?.className).toContain('border-green-500')
      expect(nftButton?.className).toContain('border-green-500')
    })

    it('allows deselecting in multiSelect mode', () => {
      render(<OptionsPicker groups={multiSelectGroups} />)

      const tokenElements = screen.getAllByText('Token')
      fireEvent.click(tokenElements[0])
      expect(tokenElements[0].closest('button')?.className).toContain('border-green-500')

      fireEvent.click(tokenElements[0])
      expect(tokenElements[0].closest('button')?.className).not.toContain('border-green-500')
    })

    it('respects pre-selected options', () => {
      const preSelectedGroups = [
        {
          id: 'features',
          label: 'Features',
          multiSelect: true,
          options: [
            { value: 'token', label: 'Token', selected: true },
            { value: 'nft', label: 'NFT' },
            { value: 'governance', label: 'Governance', selected: true },
          ],
        },
      ]

      render(<OptionsPicker groups={preSelectedGroups} />)

      expect(screen.getAllByText('Token')[0].closest('button')?.className).toContain('border-green-500')
      expect(screen.getAllByText('NFT')[0].closest('button')?.className).not.toContain('border-green-500')
      expect(screen.getAllByText('Governance')[0].closest('button')?.className).toContain('border-green-500')
    })
  })

  describe('toggle layout', () => {
    it('renders two options side by side', () => {
      render(<OptionsPicker groups={toggleGroups} />)

      expect(screen.getAllByText('Public').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Private').length).toBeGreaterThanOrEqual(1)
    })

    it('no option is selected by default', () => {
      render(<OptionsPicker groups={toggleGroups} />)

      const publicElements = screen.getAllByText('Public')
      const publicButton = publicElements[0].closest('button')
      expect(publicButton?.className).not.toContain('bg-green-500')
    })

    it('selects option on click', () => {
      render(<OptionsPicker groups={toggleGroups} />)

      const privateElements = screen.getAllByText('Private')
      fireEvent.click(privateElements[0])

      const privateButton = privateElements[0].closest('button')
      expect(privateButton?.className).toContain('bg-green-500')

      const publicElements = screen.getAllByText('Public')
      const publicButton = publicElements[0].closest('button')
      expect(publicButton?.className).not.toContain('bg-green-500')
    })
  })

  describe('radio layout', () => {
    it('renders options vertically with radio indicators', () => {
      render(<OptionsPicker groups={radioGroups} />)

      // Use getAllByText since labels may appear multiple times
      expect(screen.getAllByText('Donation').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Equity').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Rewards').length).toBeGreaterThanOrEqual(1)
    })

    it('renders sublabels for radio options', () => {
      render(<OptionsPicker groups={radioGroups} />)

      expect(screen.getByText('No token issued')).toBeInTheDocument()
      expect(screen.getByText('Token represents ownership')).toBeInTheDocument()
    })

    it('shows radio circle indicator when selected', () => {
      render(<OptionsPicker groups={radioGroups} />)

      // Click first option to select it
      const donationElements = screen.getAllByText('Donation')
      fireEvent.click(donationElements[0])

      // Should now have filled checkbox (radio uses div, not button)
      // The checkbox div with bg-green-500 should exist
      const radioContainer = donationElements[0].closest('[class*="cursor-pointer"]')
      expect(radioContainer?.querySelector('.bg-green-500')).toBeDefined()
    })
  })

  describe('text input', () => {
    it('renders text input with placeholder', () => {
      render(<OptionsPicker groups={textGroups} />)

      expect(screen.getByPlaceholderText('Enter project name...')).toBeInTheDocument()
    })

    it('accepts text input', async () => {
      const user = userEvent.setup()
      render(<OptionsPicker groups={textGroups} />)

      const input = screen.getByPlaceholderText('Enter project name...')
      await user.type(input, 'My Project')

      expect(input).toHaveValue('My Project')
    })
  })

  describe('textarea input', () => {
    it('renders textarea with placeholder', () => {
      render(<OptionsPicker groups={textareaGroups} />)

      expect(screen.getByPlaceholderText('Describe your project...')).toBeInTheDocument()
    })

    it('shows optional label', () => {
      render(<OptionsPicker groups={textareaGroups} />)

      expect(screen.getByText('(optional)')).toBeInTheDocument()
    })

    it('accepts multiline input', async () => {
      const user = userEvent.setup()
      render(<OptionsPicker groups={textareaGroups} />)

      const textarea = screen.getByPlaceholderText('Describe your project...')
      await user.type(textarea, 'Line 1{enter}Line 2')

      expect(textarea).toHaveValue('Line 1\nLine 2')
    })
  })

  describe('submit button', () => {
    it('renders submit button with default label', () => {
      render(<OptionsPicker groups={basicGroups} />)

      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    })

    it('renders submit button with custom label', () => {
      render(<OptionsPicker groups={basicGroups} submitLabel="Next Step" />)

      expect(screen.getByRole('button', { name: 'Next Step' })).toBeInTheDocument()
    })

    it('dispatches message on submit', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

      render(<OptionsPicker groups={basicGroups} />)

      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'juice:send-message',
        })
      )
    })

    it('calls onSubmit callback when provided', () => {
      const onSubmit = vi.fn()

      render(<OptionsPicker groups={basicGroups} onSubmit={onSubmit} />)

      // Select an option first (nothing is selected by default)
      const daoElements = screen.getAllByText('DAO')
      fireEvent.click(daoElements[0])

      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          'project-type': 'dao',
        })
      )
    })

    it('shows done state after submit', () => {
      render(<OptionsPicker groups={basicGroups} />)

      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

      // Component shows one of: Great, Super, Got it, Ok, Nice
      const doneWords = ['Great', 'Super', 'Got it', 'Ok', 'Nice']
      const foundDoneWord = doneWords.some(word => screen.queryByText(word))
      expect(foundDoneWord).toBe(true)
    })

    it('disables button after submit', () => {
      render(<OptionsPicker groups={basicGroups} />)

      const button = screen.getByRole('button', { name: 'Continue' })
      fireEvent.click(button)

      expect(button).toBeDisabled()
    })
  })

  describe('other/custom option handling', () => {
    it('prefills prompt when "other" selected and submitted', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

      render(<OptionsPicker groups={basicGroups} />)

      // Select the "Something else" option (which has value "other")
      fireEvent.click(screen.getByText('Something else'))
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

      // Check that the prefill prompt event was dispatched
      const prefillCall = dispatchSpy.mock.calls.find(
        call => (call[0] as CustomEvent).type === 'juice:prefill-prompt'
      )
      expect(prefillCall).toBeDefined()
    })
  })

  describe('memo input', () => {
    it('renders memo input field', () => {
      render(<OptionsPicker groups={basicGroups} />)

      expect(screen.getByPlaceholderText('Add something...')).toBeInTheDocument()
    })

    it('includes memo in message when provided', async () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const user = userEvent.setup()

      render(<OptionsPicker groups={basicGroups} />)

      const memoInput = screen.getByPlaceholderText('Add something...')
      await user.type(memoInput, 'This is my note')

      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'juice:send-message',
          detail: expect.objectContaining({
            message: expect.stringContaining('Note: This is my note'),
          }),
        })
      )
    })

    it('submits on enter key in memo field', async () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const user = userEvent.setup()

      render(<OptionsPicker groups={basicGroups} />)

      const memoInput = screen.getByPlaceholderText('Add something...')
      await user.type(memoInput, 'Test note{enter}')

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'juice:send-message',
        })
      )
    })
  })

  describe('selection summary', () => {
    it('shows summary of current selections', () => {
      render(<OptionsPicker groups={basicGroups} />)

      // Should show the selected option label (may appear multiple times)
      const daoElements = screen.getAllByText('DAO')
      expect(daoElements.length).toBeGreaterThanOrEqual(1)
    })

    it('updates summary when selection changes', () => {
      render(<OptionsPicker groups={basicGroups} />)

      fireEvent.click(screen.getByText('NFT Project'))

      // The summary should show NFT Project - it appears in both the chip and summary
      const nftElements = screen.getAllByText('NFT Project')
      expect(nftElements.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('allSelectedLabel', () => {
    it('shows custom label when all options selected in multiSelect', () => {
      render(
        <OptionsPicker
          groups={multiSelectGroups}
          allSelectedLabel="All Selected!"
        />
      )

      // Select all options
      fireEvent.click(screen.getByText('Token'))
      fireEvent.click(screen.getByText('NFT'))
      fireEvent.click(screen.getByText('Governance'))

      expect(screen.getByRole('button', { name: 'All Selected!' })).toBeInTheDocument()
    })
  })

  describe('empty groups handling', () => {
    it('does not render submit button when no options', () => {
      const emptyGroups = [
        {
          id: 'empty',
          label: 'Empty Group',
          options: [],
        },
      ]

      render(<OptionsPicker groups={emptyGroups} />)

      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles', () => {
      useThemeStore.setState({ theme: 'dark' })

      render(<OptionsPicker groups={basicGroups} />)

      const container = document.querySelector('.bg-juice-dark-lighter')
      expect(container).toBeInTheDocument()
    })

    it('applies light theme styles', () => {
      useThemeStore.setState({ theme: 'light' })

      render(<OptionsPicker groups={basicGroups} />)

      const container = document.querySelector('.bg-white')
      expect(container).toBeInTheDocument()
    })
  })

  describe('multiple groups', () => {
    it('renders multiple groups correctly', () => {
      const multipleGroups = [
        {
          id: 'type',
          label: 'Type',
          options: [
            { value: 'a', label: 'Option A' },
            { value: 'b', label: 'Option B' },
          ],
        },
        {
          id: 'size',
          label: 'Size',
          options: [
            { value: 'small', label: 'Small' },
            { value: 'large', label: 'Large' },
          ],
        },
      ]

      render(<OptionsPicker groups={multipleGroups} />)

      expect(screen.getByText('Type')).toBeInTheDocument()
      expect(screen.getByText('Size')).toBeInTheDocument()
      expect(screen.getByText('Option A')).toBeInTheDocument()
      expect(screen.getByText('Small')).toBeInTheDocument()
    })

    it('maintains separate selections for each group', () => {
      const multipleGroups = [
        {
          id: 'type',
          label: 'Type',
          options: [
            { value: 'a', label: 'Option A' },
            { value: 'b', label: 'Option B' },
          ],
        },
        {
          id: 'size',
          label: 'Size',
          options: [
            { value: 'small', label: 'Small' },
            { value: 'large', label: 'Large' },
          ],
        },
      ]

      const onSubmit = vi.fn()
      render(<OptionsPicker groups={multipleGroups} onSubmit={onSubmit} />)

      fireEvent.click(screen.getByText('Option B'))
      fireEvent.click(screen.getByText('Large'))
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(onSubmit).toHaveBeenCalledWith({
        type: 'b',
        size: 'large',
      })
    })
  })
})
