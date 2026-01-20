import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Modal from './Modal'
import { useThemeStore } from '../../stores'

describe('Modal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    children: <div>Modal content</div>,
  }

  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    // Reset body overflow
    document.body.style.overflow = ''
  })

  afterEach(() => {
    document.body.style.overflow = ''
  })

  describe('rendering', () => {
    it('renders nothing when isOpen is false', () => {
      render(<Modal {...defaultProps} isOpen={false} />)
      expect(screen.queryByText('Modal content')).not.toBeInTheDocument()
    })

    it('renders content when isOpen is true', () => {
      render(<Modal {...defaultProps} />)
      expect(screen.getByText('Modal content')).toBeInTheDocument()
    })

    it('renders title when provided', () => {
      render(<Modal {...defaultProps} title="My Modal" />)
      expect(screen.getByText('My Modal')).toBeInTheDocument()
    })

    it('does not render title header when title is not provided', () => {
      render(<Modal {...defaultProps} />)
      // The header section only exists when title is provided
      expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    })

    it('renders close button when title is provided', () => {
      render(<Modal {...defaultProps} title="My Modal" />)
      const closeButton = screen.getByRole('button')
      expect(closeButton).toBeInTheDocument()
    })
  })

  describe('sizes', () => {
    it('applies small size styles', () => {
      render(<Modal {...defaultProps} size="sm" />)
      const modalContent = screen.getByText('Modal content').closest('div[class*="max-w"]')
      expect(modalContent?.className).toContain('max-w-sm')
    })

    it('applies medium size styles by default', () => {
      render(<Modal {...defaultProps} />)
      const modalContent = screen.getByText('Modal content').closest('div[class*="max-w"]')
      expect(modalContent?.className).toContain('max-w-md')
    })

    it('applies large size styles', () => {
      render(<Modal {...defaultProps} size="lg" />)
      const modalContent = screen.getByText('Modal content').closest('div[class*="max-w"]')
      expect(modalContent?.className).toContain('max-w-lg')
    })

    it('applies extra large size styles', () => {
      render(<Modal {...defaultProps} size="xl" />)
      const modalContent = screen.getByText('Modal content').closest('div[class*="max-w"]')
      expect(modalContent?.className).toContain('max-w-xl')
    })
  })

  describe('closing behavior', () => {
    it('calls onClose when clicking backdrop', () => {
      const onClose = vi.fn()
      render(<Modal {...defaultProps} onClose={onClose} />)

      // Find the backdrop (element with bg-black/70)
      const backdrop = document.querySelector('.bg-black\\/70')
      expect(backdrop).toBeInTheDocument()

      fireEvent.click(backdrop!)

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when clicking close button', () => {
      const onClose = vi.fn()
      render(<Modal {...defaultProps} onClose={onClose} title="My Modal" />)

      fireEvent.click(screen.getByRole('button'))

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when pressing Escape key', () => {
      const onClose = vi.fn()
      render(<Modal {...defaultProps} onClose={onClose} />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does not call onClose when pressing other keys', () => {
      const onClose = vi.fn()
      render(<Modal {...defaultProps} onClose={onClose} />)

      fireEvent.keyDown(document, { key: 'Enter' })
      fireEvent.keyDown(document, { key: ' ' })
      fireEvent.keyDown(document, { key: 'a' })

      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('body scroll lock', () => {
    it('sets body overflow to hidden when opened', () => {
      render(<Modal {...defaultProps} />)
      expect(document.body.style.overflow).toBe('hidden')
    })

    it('restores body overflow when closed', () => {
      const { rerender } = render(<Modal {...defaultProps} />)
      expect(document.body.style.overflow).toBe('hidden')

      rerender(<Modal {...defaultProps} isOpen={false} />)
      expect(document.body.style.overflow).toBe('')
    })

    it('restores body overflow when unmounted', () => {
      const { unmount } = render(<Modal {...defaultProps} />)
      expect(document.body.style.overflow).toBe('hidden')

      unmount()
      expect(document.body.style.overflow).toBe('')
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles when theme is dark', () => {
      useThemeStore.setState({ theme: 'dark' })
      render(<Modal {...defaultProps} title="My Modal" />)

      const modalContent = screen.getByText('Modal content').closest('div[class*="max-w"]')
      expect(modalContent?.className).toContain('bg-juice-dark-lighter')
      expect(modalContent?.className).toContain('border-white/10')
    })

    it('applies light theme styles when theme is light', () => {
      useThemeStore.setState({ theme: 'light' })
      render(<Modal {...defaultProps} title="My Modal" />)

      const modalContent = screen.getByText('Modal content').closest('div[class*="max-w"]')
      expect(modalContent?.className).toContain('bg-white')
      expect(modalContent?.className).toContain('border-gray-200')
    })

    it('applies correct title color in dark theme', () => {
      useThemeStore.setState({ theme: 'dark' })
      render(<Modal {...defaultProps} title="My Modal" />)

      const title = screen.getByText('My Modal')
      expect(title.className).toContain('text-white')
    })

    it('applies correct title color in light theme', () => {
      useThemeStore.setState({ theme: 'light' })
      render(<Modal {...defaultProps} title="My Modal" />)

      const title = screen.getByText('My Modal')
      expect(title.className).toContain('text-gray-900')
    })
  })

  describe('portal behavior', () => {
    it('renders into document.body via portal', () => {
      render(<Modal {...defaultProps} />)

      // The modal should be a direct child of body
      const modalOverlay = document.querySelector('.fixed.inset-0.z-50')
      expect(modalOverlay?.parentElement).toBe(document.body)
    })
  })

  describe('event cleanup', () => {
    it('removes keydown listener when modal closes', () => {
      const onClose = vi.fn()
      const { rerender } = render(<Modal {...defaultProps} onClose={onClose} />)

      rerender(<Modal {...defaultProps} isOpen={false} onClose={onClose} />)

      // After closing, pressing Escape should not call onClose
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('accessibility', () => {
    it('modal content is scrollable for long content', () => {
      render(<Modal {...defaultProps} />)
      const scrollableArea = screen.getByText('Modal content').closest('.overflow-y-auto')
      expect(scrollableArea).toBeInTheDocument()
    })

    it('modal has max height constraint', () => {
      render(<Modal {...defaultProps} />)
      const modalContent = screen.getByText('Modal content').closest('div[class*="max-h"]')
      expect(modalContent?.className).toContain('max-h-[90vh]')
    })
  })

  describe('complex children', () => {
    it('renders form elements as children', () => {
      render(
        <Modal {...defaultProps}>
          <form data-testid="modal-form">
            <input type="text" placeholder="Enter name" />
            <button type="submit">Submit</button>
          </form>
        </Modal>
      )

      expect(screen.getByTestId('modal-form')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Enter name')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
    })
  })
})
