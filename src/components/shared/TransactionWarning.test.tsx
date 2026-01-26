import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TransactionWarning from './TransactionWarning'
import type { TransactionDoubt } from '../../utils/transactionVerification'

describe('TransactionWarning', () => {
  const user = userEvent.setup()

  const defaultProps = {
    doubts: [] as TransactionDoubt[],
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    isDark: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('returns null when doubts array is empty', () => {
      const { container } = render(<TransactionWarning {...defaultProps} doubts={[]} />)
      expect(container.firstChild).toBeNull()
    })

    it('renders when there are doubts', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'warning', message: 'Test warning' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} />)
      expect(screen.getByText('Test warning')).toBeInTheDocument()
    })

    it('shows "Please Review" header for warnings only', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'warning', message: 'Test warning' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} />)
      expect(screen.getByText('Please Review')).toBeInTheDocument()
    })

    it('shows "Review Required" header when there are critical doubts', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'critical', message: 'Test critical' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} />)
      expect(screen.getByText('Review Required')).toBeInTheDocument()
    })

    it('displays critical doubts with Critical badge', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'critical', message: 'Critical error message' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} />)
      expect(screen.getByText('Critical')).toBeInTheDocument()
      expect(screen.getByText('Critical error message')).toBeInTheDocument()
    })

    it('displays warning doubts with Warning badge', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'warning', message: 'Warning message' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} />)
      expect(screen.getByText('Warning')).toBeInTheDocument()
      expect(screen.getByText('Warning message')).toBeInTheDocument()
    })

    it('displays technical notes when provided', () => {
      const doubts: TransactionDoubt[] = [
        {
          severity: 'warning',
          message: 'Test message',
          technicalNote: 'Technical explanation here',
        },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} />)
      expect(screen.getByText(/Technical: Technical explanation here/)).toBeInTheDocument()
    })

    it('displays critical doubts before warnings', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'warning', message: 'Warning first' },
        { severity: 'critical', message: 'Critical second' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} />)

      const criticalBadge = screen.getByText('Critical')
      const warningBadge = screen.getByText('Warning')

      // Critical should appear before Warning in the DOM
      expect(criticalBadge.compareDocumentPosition(warningBadge)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      )
    })

    it('shows multiple doubts', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'critical', message: 'Critical one' },
        { severity: 'critical', message: 'Critical two' },
        { severity: 'warning', message: 'Warning one' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} />)

      expect(screen.getByText('Critical one')).toBeInTheDocument()
      expect(screen.getByText('Critical two')).toBeInTheDocument()
      expect(screen.getByText('Warning one')).toBeInTheDocument()
    })
  })

  describe('checkbox and acknowledgment', () => {
    it('shows risk acknowledgment text for critical doubts', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'critical', message: 'Critical issue' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} />)
      expect(
        screen.getByText('I understand the risks and want to proceed anyway')
      ).toBeInTheDocument()
    })

    it('shows review acknowledgment text for warning-only doubts', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'warning', message: 'Warning issue' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} />)
      expect(
        screen.getByText('I have reviewed the warnings and want to proceed')
      ).toBeInTheDocument()
    })

    it('checkbox is unchecked by default', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'warning', message: 'Warning' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} />)
      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).not.toBeChecked()
    })

    it('checkbox can be toggled', async () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'warning', message: 'Warning' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} />)
      const checkbox = screen.getByRole('checkbox')

      await user.click(checkbox)
      expect(checkbox).toBeChecked()

      await user.click(checkbox)
      expect(checkbox).not.toBeChecked()
    })
  })

  describe('button behavior', () => {
    it('shows Cancel and Proceed Anyway buttons', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'warning', message: 'Warning' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} />)
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Proceed Anyway' })).toBeInTheDocument()
    })

    it('Proceed Anyway button is disabled by default', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'warning', message: 'Warning' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} />)
      const proceedButton = screen.getByRole('button', { name: 'Proceed Anyway' })
      expect(proceedButton).toBeDisabled()
    })

    it('Proceed Anyway button is enabled after checkbox is checked', async () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'warning', message: 'Warning' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} />)

      const checkbox = screen.getByRole('checkbox')
      const proceedButton = screen.getByRole('button', { name: 'Proceed Anyway' })

      expect(proceedButton).toBeDisabled()

      await user.click(checkbox)
      expect(proceedButton).toBeEnabled()
    })

    it('Cancel button calls onCancel', async () => {
      const onCancel = vi.fn()
      const doubts: TransactionDoubt[] = [
        { severity: 'warning', message: 'Warning' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} onCancel={onCancel} />)

      const cancelButton = screen.getByRole('button', { name: 'Cancel' })
      await user.click(cancelButton)

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('Proceed Anyway button calls onConfirm when enabled and clicked', async () => {
      const onConfirm = vi.fn()
      const doubts: TransactionDoubt[] = [
        { severity: 'warning', message: 'Warning' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} onConfirm={onConfirm} />)

      const checkbox = screen.getByRole('checkbox')
      const proceedButton = screen.getByRole('button', { name: 'Proceed Anyway' })

      await user.click(checkbox)
      await user.click(proceedButton)

      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('Proceed Anyway button does not call onConfirm when disabled', async () => {
      const onConfirm = vi.fn()
      const doubts: TransactionDoubt[] = [
        { severity: 'warning', message: 'Warning' },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} onConfirm={onConfirm} />)

      const proceedButton = screen.getByRole('button', { name: 'Proceed Anyway' })

      // Try to click disabled button
      await user.click(proceedButton)

      expect(onConfirm).not.toHaveBeenCalled()
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles for critical doubts', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'critical', message: 'Critical' },
      ]
      const { container } = render(
        <TransactionWarning {...defaultProps} doubts={doubts} isDark={true} />
      )
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('bg-red-500/10')
      expect(wrapper.className).toContain('border-red-500/30')
    })

    it('applies light theme styles for critical doubts', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'critical', message: 'Critical' },
      ]
      const { container } = render(
        <TransactionWarning {...defaultProps} doubts={doubts} isDark={false} />
      )
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('bg-red-50')
      expect(wrapper.className).toContain('border-red-200')
    })

    it('applies dark theme styles for warning doubts', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'warning', message: 'Warning' },
      ]
      const { container } = render(
        <TransactionWarning {...defaultProps} doubts={doubts} isDark={true} />
      )
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('bg-yellow-500/10')
      expect(wrapper.className).toContain('border-yellow-500/30')
    })

    it('applies light theme styles for warning doubts', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'warning', message: 'Warning' },
      ]
      const { container } = render(
        <TransactionWarning {...defaultProps} doubts={doubts} isDark={false} />
      )
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('bg-yellow-50')
      expect(wrapper.className).toContain('border-yellow-200')
    })
  })

  describe('field display', () => {
    it('displays doubt with field information', () => {
      const doubts: TransactionDoubt[] = [
        {
          severity: 'critical',
          field: 'amount',
          message: 'Amount is invalid',
        },
      ]
      render(<TransactionWarning {...defaultProps} doubts={doubts} />)
      expect(screen.getByText('Amount is invalid')).toBeInTheDocument()
    })
  })

  describe('mixed severity', () => {
    it('shows critical styling when both critical and warning doubts exist', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'critical', message: 'Critical issue' },
        { severity: 'warning', message: 'Warning issue' },
      ]
      const { container } = render(
        <TransactionWarning {...defaultProps} doubts={doubts} isDark={false} />
      )

      // Should use red styling (critical) not yellow (warning)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('bg-red-50')
      expect(screen.getByText('Review Required')).toBeInTheDocument()
    })

    it('shows warning styling when only warning doubts exist', () => {
      const doubts: TransactionDoubt[] = [
        { severity: 'warning', message: 'Warning one' },
        { severity: 'warning', message: 'Warning two' },
      ]
      const { container } = render(
        <TransactionWarning {...defaultProps} doubts={doubts} isDark={false} />
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('bg-yellow-50')
      expect(screen.getByText('Please Review')).toBeInTheDocument()
    })
  })
})
