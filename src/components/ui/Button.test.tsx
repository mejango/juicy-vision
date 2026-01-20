import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Button from './Button'
import { useThemeStore } from '../../stores'

describe('Button', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
  })

  describe('rendering', () => {
    it('renders children text', () => {
      render(<Button>Click me</Button>)
      expect(screen.getByRole('button')).toHaveTextContent('Click me')
    })

    it('renders with icon', () => {
      const icon = <span data-testid="icon">★</span>
      render(<Button icon={icon}>With Icon</Button>)
      expect(screen.getByTestId('icon')).toBeInTheDocument()
    })

    it('renders without children (icon-only)', () => {
      const icon = <span data-testid="icon">★</span>
      render(<Button icon={icon} aria-label="star button" />)
      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByTestId('icon')).toBeInTheDocument()
    })
  })

  describe('variants', () => {
    it('applies primary variant styles by default', () => {
      render(<Button>Primary</Button>)
      const button = screen.getByRole('button')
      expect(button.className).toContain('bg-juice-cyan')
    })

    it('applies secondary variant styles', () => {
      render(<Button variant="secondary">Secondary</Button>)
      const button = screen.getByRole('button')
      expect(button.className).toContain('bg-juice-dark-lighter')
    })

    it('applies outline variant styles', () => {
      render(<Button variant="outline">Outline</Button>)
      const button = screen.getByRole('button')
      expect(button.className).toContain('bg-transparent')
      expect(button.className).toContain('border-white')
    })

    it('applies ghost variant styles', () => {
      render(<Button variant="ghost">Ghost</Button>)
      const button = screen.getByRole('button')
      expect(button.className).toContain('bg-transparent')
      expect(button.className).toContain('text-gray-300')
    })

    it('applies danger variant styles', () => {
      render(<Button variant="danger">Danger</Button>)
      const button = screen.getByRole('button')
      expect(button.className).toContain('bg-red-600')
    })
  })

  describe('sizes', () => {
    it('applies small size styles', () => {
      render(<Button size="sm">Small</Button>)
      const button = screen.getByRole('button')
      expect(button.className).toContain('px-3')
      expect(button.className).toContain('py-1.5')
    })

    it('applies medium size styles by default', () => {
      render(<Button>Medium</Button>)
      const button = screen.getByRole('button')
      expect(button.className).toContain('px-4')
      expect(button.className).toContain('py-2')
    })

    it('applies large size styles', () => {
      render(<Button size="lg">Large</Button>)
      const button = screen.getByRole('button')
      expect(button.className).toContain('px-6')
      expect(button.className).toContain('py-3')
    })
  })

  describe('states', () => {
    it('is disabled when disabled prop is true', () => {
      render(<Button disabled>Disabled</Button>)
      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('is disabled when loading', () => {
      render(<Button loading>Loading</Button>)
      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('shows spinner when loading', () => {
      render(<Button loading>Loading</Button>)
      const spinner = screen.getByRole('button').querySelector('svg')
      expect(spinner).toBeInTheDocument()
      expect(spinner?.classList.contains('animate-spin')).toBe(true)
    })

    it('hides icon when loading', () => {
      const icon = <span data-testid="icon">★</span>
      render(<Button loading icon={icon}>Loading</Button>)
      expect(screen.queryByTestId('icon')).not.toBeInTheDocument()
    })
  })

  describe('interactions', () => {
    it('calls onClick when clicked', () => {
      const handleClick = vi.fn()
      render(<Button onClick={handleClick}>Click me</Button>)

      fireEvent.click(screen.getByRole('button'))

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('does not call onClick when disabled', () => {
      const handleClick = vi.fn()
      render(<Button onClick={handleClick} disabled>Click me</Button>)

      fireEvent.click(screen.getByRole('button'))

      expect(handleClick).not.toHaveBeenCalled()
    })

    it('does not call onClick when loading', () => {
      const handleClick = vi.fn()
      render(<Button onClick={handleClick} loading>Click me</Button>)

      fireEvent.click(screen.getByRole('button'))

      expect(handleClick).not.toHaveBeenCalled()
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles when theme is dark', () => {
      useThemeStore.setState({ theme: 'dark' })
      render(<Button variant="secondary">Secondary</Button>)
      const button = screen.getByRole('button')
      expect(button.className).toContain('bg-juice-dark-lighter')
    })

    it('applies light theme styles when theme is light', () => {
      useThemeStore.setState({ theme: 'light' })
      render(<Button variant="secondary">Secondary</Button>)
      const button = screen.getByRole('button')
      expect(button.className).toContain('bg-gray-100')
    })
  })

  describe('custom className', () => {
    it('allows custom className to be added', () => {
      render(<Button className="custom-class">Custom</Button>)
      expect(screen.getByRole('button').className).toContain('custom-class')
    })
  })

  describe('ref forwarding', () => {
    it('forwards ref to button element', () => {
      const ref = vi.fn()
      render(<Button ref={ref}>With Ref</Button>)
      expect(ref).toHaveBeenCalledWith(expect.any(HTMLButtonElement))
    })
  })

  describe('HTML button attributes', () => {
    it('passes through type attribute', () => {
      render(<Button type="submit">Submit</Button>)
      expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
    })

    it('passes through aria attributes', () => {
      render(<Button aria-label="accessible button">Accessible</Button>)
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'accessible button')
    })
  })
})
