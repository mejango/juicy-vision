import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import TransactionStatus from './TransactionStatus'
import { useTransactionStore } from '../../stores'

describe('TransactionStatus', () => {
  beforeEach(() => {
    // Reset store state before each test
    useTransactionStore.setState({ transactions: [] })
    localStorage.clear()
  })

  describe('when transaction does not exist', () => {
    it('shows "Transaction not found" message', () => {
      render(<TransactionStatus txId="non-existent-id" />)
      expect(screen.getByText('Transaction not found')).toBeInTheDocument()
    })
  })

  describe('when transaction exists', () => {
    it('displays pending status correctly', () => {
      const txId = useTransactionStore.getState().addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'pending',
      })

      render(<TransactionStatus txId={txId} />)

      expect(screen.getByText('Pending')).toBeInTheDocument()
      expect(screen.getByText('pay')).toBeInTheDocument()
    })

    it('displays submitted status correctly', () => {
      const txId = useTransactionStore.getState().addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'submitted',
        hash: '0xabc123def456',
      })

      render(<TransactionStatus txId={txId} />)

      expect(screen.getByText('Submitted')).toBeInTheDocument()
    })

    it('displays confirmed status correctly', () => {
      const txId = useTransactionStore.getState().addTransaction({
        type: 'cashout',
        chainId: 10,
        status: 'confirmed',
        hash: '0xfedcba987654',
      })

      render(<TransactionStatus txId={txId} />)

      expect(screen.getByText('Confirmed')).toBeInTheDocument()
      expect(screen.getByText('cashout')).toBeInTheDocument()
    })

    it('displays failed status correctly', () => {
      const txId = useTransactionStore.getState().addTransaction({
        type: 'deploy',
        chainId: 8453,
        status: 'failed',
        error: 'Insufficient funds',
      })

      render(<TransactionStatus txId={txId} />)

      expect(screen.getByText('Failed')).toBeInTheDocument()
      expect(screen.getByText('Insufficient funds')).toBeInTheDocument()
    })
  })

  describe('transaction hash display', () => {
    it('shows truncated hash with link when hash exists', () => {
      const txId = useTransactionStore.getState().addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'submitted',
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      })

      render(<TransactionStatus txId={txId} />)

      // Should show truncated hash
      const link = screen.getByRole('link')
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute(
        'href',
        'https://etherscan.io/tx/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      )
      expect(link.textContent).toContain('0x12345678')
      expect(link.textContent).toContain('90abcdef')
    })

    it('does not show hash link when hash is not present', () => {
      const txId = useTransactionStore.getState().addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'pending',
      })

      render(<TransactionStatus txId={txId} />)

      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })
  })

  describe('amount display', () => {
    it('shows amount when present', () => {
      const txId = useTransactionStore.getState().addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'submitted',
        amount: '0.5',
      })

      render(<TransactionStatus txId={txId} />)

      expect(screen.getByText('0.5 ETH')).toBeInTheDocument()
    })

    it('does not show amount section when amount is not present', () => {
      const txId = useTransactionStore.getState().addTransaction({
        type: 'deploy',
        chainId: 1,
        status: 'submitted',
      })

      render(<TransactionStatus txId={txId} />)

      expect(screen.queryByText(/ETH$/)).not.toBeInTheDocument()
    })
  })

  describe('status colors', () => {
    it('applies yellow color for pending status', () => {
      const txId = useTransactionStore.getState().addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'pending',
      })

      render(<TransactionStatus txId={txId} />)

      const statusText = screen.getByText('Pending')
      expect(statusText.className).toContain('text-yellow-400')
    })

    it('applies cyan color for submitted status', () => {
      const txId = useTransactionStore.getState().addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'submitted',
      })

      render(<TransactionStatus txId={txId} />)

      const statusText = screen.getByText('Submitted')
      expect(statusText.className).toContain('text-juice-cyan')
    })

    it('applies green color for confirmed status', () => {
      const txId = useTransactionStore.getState().addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'confirmed',
      })

      render(<TransactionStatus txId={txId} />)

      const statusText = screen.getByText('Confirmed')
      expect(statusText.className).toContain('text-green-400')
    })

    it('applies red color for failed status', () => {
      const txId = useTransactionStore.getState().addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'failed',
      })

      render(<TransactionStatus txId={txId} />)

      const statusText = screen.getByText('Failed')
      expect(statusText.className).toContain('text-red-400')
    })
  })

  describe('transaction type display', () => {
    const transactionTypes = [
      'pay',
      'cashout',
      'deploy',
      'sendPayouts',
      'useAllowance',
      'mintTokens',
      'burnTokens',
      'launchProject',
      'queueRuleset',
      'deployERC20',
      'mint-nft',
    ] as const

    transactionTypes.forEach(type => {
      it(`displays ${type} transaction type`, () => {
        const txId = useTransactionStore.getState().addTransaction({
          type,
          chainId: 1,
          status: 'pending',
        })

        render(<TransactionStatus txId={txId} />)

        expect(screen.getByText(type)).toBeInTheDocument()
      })
    })
  })

  describe('error display', () => {
    it('shows error message when present', () => {
      const txId = useTransactionStore.getState().addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'failed',
        error: 'User rejected the transaction',
      })

      render(<TransactionStatus txId={txId} />)

      expect(screen.getByText('User rejected the transaction')).toBeInTheDocument()
    })

    it('applies error text styling', () => {
      const txId = useTransactionStore.getState().addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'failed',
        error: 'Transaction reverted',
      })

      render(<TransactionStatus txId={txId} />)

      const errorText = screen.getByText('Transaction reverted')
      expect(errorText.className).toContain('text-red-400')
    })
  })

  describe('reactivity', () => {
    it('updates when transaction status changes', async () => {
      const txId = useTransactionStore.getState().addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'pending',
      })

      const { rerender } = render(<TransactionStatus txId={txId} />)

      expect(screen.getByText('Pending')).toBeInTheDocument()

      // Update transaction status wrapped in act
      await act(async () => {
        useTransactionStore.getState().updateTransaction(txId, {
          status: 'confirmed',
          hash: '0xabc123',
        })
      })

      rerender(<TransactionStatus txId={txId} />)

      expect(screen.getByText('Confirmed')).toBeInTheDocument()
    })
  })
})
