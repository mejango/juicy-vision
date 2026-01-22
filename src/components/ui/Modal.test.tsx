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
  })

  afterEach(() => {
    vi.clearAllMocks()
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
      // Find the modal container by looking for the flex flex-col div which contains the width class
      const modalContainer = document.querySelector('.fixed.z-50 > div[class*="flex-col"]')
      expect(modalContainer?.className).toContain('w-80')
    })

    it('applies medium size styles by default', () => {
      render(<Modal {...defaultProps} />)
      const modalContainer = document.querySelector('.fixed.z-50 > div[class*="flex-col"]')
      expect(modalContainer?.className).toContain('w-96')
    })

    it('applies large size styles', () => {
      render(<Modal {...defaultProps} size="lg" />)
      const modalContainer = document.querySelector('.fixed.z-50 > div[class*="flex-col"]')
      expect(modalContainer?.className).toContain('w-[28rem]')
    })

    it('applies extra large size styles', () => {
      render(<Modal {...defaultProps} size="xl" />)
      const modalContainer = document.querySelector('.fixed.z-50 > div[class*="flex-col"]')
      expect(modalContainer?.className).toContain('w-[32rem]')
    })
  })

  describe('closing behavior', () => {
    it('calls onClose when clicking backdrop', () => {
      const onClose = vi.fn()
      render(<Modal {...defaultProps} onClose={onClose} />)

      // Find the backdrop (element with fixed inset-0 z-[49])
      const backdrop = document.querySelector('.fixed.inset-0.z-\\[49\\]')
      expect(backdrop).toBeInTheDocument()

      fireEvent.mouseDown(backdrop!)

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

    it('does not close when clicking inside modal content', () => {
      const onClose = vi.fn()
      render(<Modal {...defaultProps} onClose={onClose} />)

      // Click inside the modal content
      fireEvent.mouseDown(screen.getByText('Modal content'))

      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles when theme is dark', () => {
      useThemeStore.setState({ theme: 'dark' })
      render(<Modal {...defaultProps} title="My Modal" />)

      const modalContainer = document.querySelector('.fixed.z-50 > div[class*="flex-col"]')
      expect(modalContainer?.className).toContain('bg-juice-dark')
      expect(modalContainer?.className).toContain('border-white/20')
    })

    it('applies light theme styles when theme is light', () => {
      useThemeStore.setState({ theme: 'light' })
      render(<Modal {...defaultProps} title="My Modal" />)

      const modalContainer = document.querySelector('.fixed.z-50 > div[class*="flex-col"]')
      expect(modalContainer?.className).toContain('bg-white')
      expect(modalContainer?.className).toContain('border-gray-200')
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

      // The backdrop should be a direct child of body (the modal renders backdrop + content as siblings)
      const backdrop = document.querySelector('.fixed.inset-0.z-\\[49\\]')
      expect(backdrop?.parentElement).toBe(document.body)
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
      expect(modalContent?.className).toContain('max-h-[85vh]')
    })
  })

  describe('anchor positioning', () => {
    it('uses default top-right positioning when no anchor provided', () => {
      render(<Modal {...defaultProps} />)
      const positionedDiv = document.querySelector('.fixed.z-50')
      // Default fallback position is top: 16, right: 16
      expect(positionedDiv).toBeInTheDocument()
    })

    it('accepts anchorPosition prop', () => {
      const anchor = { top: 100, left: 200, width: 80, height: 30 }
      render(<Modal {...defaultProps} anchorPosition={anchor} />)
      expect(screen.getByText('Modal content')).toBeInTheDocument()
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
