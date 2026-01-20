import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Input from './Input'
import { useThemeStore } from '../../stores'

describe('Input', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
  })

  describe('rendering', () => {
    it('renders an input element', () => {
      render(<Input />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('renders with placeholder', () => {
      render(<Input placeholder="Enter text..." />)
      expect(screen.getByPlaceholderText('Enter text...')).toBeInTheDocument()
    })

    it('renders with label', () => {
      render(<Input label="Email Address" />)
      expect(screen.getByText('Email Address')).toBeInTheDocument()
    })

    it('renders with icon', () => {
      const icon = <span data-testid="search-icon">🔍</span>
      render(<Input icon={icon} />)
      expect(screen.getByTestId('search-icon')).toBeInTheDocument()
    })

    it('renders with right element', () => {
      const rightElement = <button data-testid="clear-btn">Clear</button>
      render(<Input rightElement={rightElement} />)
      expect(screen.getByTestId('clear-btn')).toBeInTheDocument()
    })

    it('renders error message when provided', () => {
      render(<Input error="This field is required" />)
      expect(screen.getByText('This field is required')).toBeInTheDocument()
    })
  })

  describe('styling', () => {
    it('applies dark theme styles when theme is dark', () => {
      useThemeStore.setState({ theme: 'dark' })
      render(<Input />)
      const input = screen.getByRole('textbox')
      expect(input.className).toContain('bg-juice-dark-lighter')
      expect(input.className).toContain('text-white')
    })

    it('applies light theme styles when theme is light', () => {
      useThemeStore.setState({ theme: 'light' })
      render(<Input />)
      const input = screen.getByRole('textbox')
      expect(input.className).toContain('bg-white')
      expect(input.className).toContain('text-gray-900')
    })

    it('adds left padding when icon is present', () => {
      const icon = <span>🔍</span>
      render(<Input icon={icon} />)
      const input = screen.getByRole('textbox')
      expect(input.className).toContain('pl-10')
    })

    it('adds right padding when rightElement is present', () => {
      const rightElement = <span>✓</span>
      render(<Input rightElement={rightElement} />)
      const input = screen.getByRole('textbox')
      expect(input.className).toContain('pr-10')
    })

    it('applies error styles when error is present', () => {
      render(<Input error="Invalid input" />)
      const input = screen.getByRole('textbox')
      expect(input.className).toContain('border-red-500')
    })

    it('allows custom className', () => {
      render(<Input className="custom-class" />)
      const input = screen.getByRole('textbox')
      expect(input.className).toContain('custom-class')
    })
  })

  describe('states', () => {
    it('is disabled when disabled prop is true', () => {
      render(<Input disabled />)
      expect(screen.getByRole('textbox')).toBeDisabled()
    })

    it('applies disabled styles when disabled', () => {
      render(<Input disabled />)
      const input = screen.getByRole('textbox')
      expect(input.className).toContain('disabled:opacity-50')
    })
  })

  describe('interactions', () => {
    it('handles value changes', async () => {
      const handleChange = vi.fn()
      render(<Input onChange={handleChange} />)

      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'hello')

      expect(handleChange).toHaveBeenCalled()
    })

    it('updates value when typing', async () => {
      render(<Input />)

      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'test value')

      expect(input).toHaveValue('test value')
    })

    it('handles controlled value', () => {
      const { rerender } = render(<Input value="initial" onChange={() => {}} />)
      expect(screen.getByRole('textbox')).toHaveValue('initial')

      rerender(<Input value="updated" onChange={() => {}} />)
      expect(screen.getByRole('textbox')).toHaveValue('updated')
    })

    it('calls onFocus when focused', () => {
      const handleFocus = vi.fn()
      render(<Input onFocus={handleFocus} />)

      fireEvent.focus(screen.getByRole('textbox'))

      expect(handleFocus).toHaveBeenCalled()
    })

    it('calls onBlur when blurred', () => {
      const handleBlur = vi.fn()
      render(<Input onBlur={handleBlur} />)

      const input = screen.getByRole('textbox')
      fireEvent.focus(input)
      fireEvent.blur(input)

      expect(handleBlur).toHaveBeenCalled()
    })
  })

  describe('HTML input attributes', () => {
    it('passes through type attribute', () => {
      render(<Input type="email" />)
      expect(screen.getByRole('textbox')).toHaveAttribute('type', 'email')
    })

    it('passes through name attribute', () => {
      render(<Input name="email-input" />)
      expect(screen.getByRole('textbox')).toHaveAttribute('name', 'email-input')
    })

    it('passes through required attribute', () => {
      render(<Input required />)
      expect(screen.getByRole('textbox')).toBeRequired()
    })

    it('passes through maxLength attribute', () => {
      render(<Input maxLength={100} />)
      expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', '100')
    })

    it('passes through aria-describedby', () => {
      render(<Input aria-describedby="help-text" />)
      expect(screen.getByRole('textbox')).toHaveAttribute('aria-describedby', 'help-text')
    })
  })

  describe('ref forwarding', () => {
    it('forwards ref to input element', () => {
      const ref = vi.fn()
      render(<Input ref={ref} />)
      expect(ref).toHaveBeenCalledWith(expect.any(HTMLInputElement))
    })
  })

  describe('label association', () => {
    it('renders label with correct styling based on theme', () => {
      useThemeStore.setState({ theme: 'dark' })
      render(<Input label="Username" />)
      const label = screen.getByText('Username')
      expect(label.className).toContain('text-gray-300')
    })

    it('renders label with light theme styling', () => {
      useThemeStore.setState({ theme: 'light' })
      render(<Input label="Username" />)
      const label = screen.getByText('Username')
      expect(label.className).toContain('text-gray-700')
    })
  })
})
