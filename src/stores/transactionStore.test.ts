import { describe, it, expect, beforeEach } from 'vitest'
import { useTransactionStore, type Transaction, type TransactionType } from './transactionStore'

describe('transactionStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useTransactionStore.setState({ transactions: [] })
    localStorage.clear()
  })

  describe('addTransaction', () => {
    it('adds a new transaction with generated id and timestamps', () => {
      const store = useTransactionStore.getState()

      const txId = store.addTransaction({
        type: 'pay',
        chainId: 1,
        amount: '0.1',
        token: 'ETH',
        status: 'pending',
      })

      expect(txId).toBeDefined()
      expect(typeof txId).toBe('string')
      expect(txId.length).toBeGreaterThan(0)

      const tx = store.getTransaction(txId)
      expect(tx).toBeDefined()
      expect(tx?.type).toBe('pay')
      expect(tx?.chainId).toBe(1)
      expect(tx?.amount).toBe('0.1')
      expect(tx?.token).toBe('ETH')
      expect(tx?.status).toBe('pending')
      expect(tx?.createdAt).toBeDefined()
      expect(tx?.updatedAt).toBeDefined()
      expect(tx?.createdAt).toBe(tx?.updatedAt)
    })

    it('prepends new transactions to the list (newest first)', () => {
      const store = useTransactionStore.getState()

      const id1 = store.addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'pending',
      })

      const id2 = store.addTransaction({
        type: 'cashout',
        chainId: 10,
        status: 'pending',
      })

      const state = useTransactionStore.getState()
      expect(state.transactions.length).toBe(2)
      expect(state.transactions[0].id).toBe(id2) // newest first
      expect(state.transactions[1].id).toBe(id1)
    })

    it('handles all transaction types', () => {
      const store = useTransactionStore.getState()
      const types: TransactionType[] = [
        'pay', 'cashout', 'deploy', 'sendPayouts', 'useAllowance',
        'mintTokens', 'burnTokens', 'launchProject', 'queueRuleset',
        'deployERC20', 'mint-nft'
      ]

      types.forEach(type => {
        const id = store.addTransaction({
          type,
          chainId: 1,
          status: 'pending',
        })
        const tx = useTransactionStore.getState().getTransaction(id)
        expect(tx?.type).toBe(type)
      })
    })

    it('stores optional NFT minting fields', () => {
      const store = useTransactionStore.getState()

      const txId = store.addTransaction({
        type: 'mint-nft',
        chainId: 1,
        status: 'pending',
        tierId: 3,
        quantity: 5,
      })

      const tx = store.getTransaction(txId)
      expect(tx?.tierId).toBe(3)
      expect(tx?.quantity).toBe(5)
    })

    it('stores projectId when provided', () => {
      const store = useTransactionStore.getState()

      const txId = store.addTransaction({
        type: 'pay',
        chainId: 1,
        projectId: '42',
        status: 'pending',
      })

      const tx = store.getTransaction(txId)
      expect(tx?.projectId).toBe('42')
    })
  })

  describe('updateTransaction', () => {
    it('updates transaction fields and updatedAt timestamp', async () => {
      const store = useTransactionStore.getState()

      const txId = store.addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'pending',
      })

      const originalTx = store.getTransaction(txId)
      const originalUpdatedAt = originalTx?.updatedAt

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10))

      store.updateTransaction(txId, {
        status: 'submitted',
        hash: '0x123abc',
      })

      const updatedTx = useTransactionStore.getState().getTransaction(txId)
      expect(updatedTx?.status).toBe('submitted')
      expect(updatedTx?.hash).toBe('0x123abc')
      expect(updatedTx?.updatedAt).toBeGreaterThan(originalUpdatedAt!)
    })

    it('only updates the specified transaction', () => {
      const store = useTransactionStore.getState()

      const id1 = store.addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'pending',
      })

      const id2 = store.addTransaction({
        type: 'cashout',
        chainId: 10,
        status: 'pending',
      })

      store.updateTransaction(id1, { status: 'confirmed' })

      const tx1 = useTransactionStore.getState().getTransaction(id1)
      const tx2 = useTransactionStore.getState().getTransaction(id2)

      expect(tx1?.status).toBe('confirmed')
      expect(tx2?.status).toBe('pending')
    })

    it('handles updating non-existent transaction gracefully', () => {
      const store = useTransactionStore.getState()
      // Should not throw
      expect(() => {
        store.updateTransaction('non-existent-id', { status: 'confirmed' })
      }).not.toThrow()
    })

    it('can update error field on failed transactions', () => {
      const store = useTransactionStore.getState()

      const txId = store.addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'pending',
      })

      store.updateTransaction(txId, {
        status: 'failed',
        error: 'User rejected the transaction',
      })

      const tx = useTransactionStore.getState().getTransaction(txId)
      expect(tx?.status).toBe('failed')
      expect(tx?.error).toBe('User rejected the transaction')
    })
  })

  describe('getTransaction', () => {
    it('returns undefined for non-existent id', () => {
      const store = useTransactionStore.getState()
      const tx = store.getTransaction('non-existent-id')
      expect(tx).toBeUndefined()
    })

    it('returns the correct transaction by id', () => {
      const store = useTransactionStore.getState()

      store.addTransaction({ type: 'pay', chainId: 1, status: 'pending' })
      const targetId = store.addTransaction({ type: 'cashout', chainId: 10, status: 'submitted' })
      store.addTransaction({ type: 'deploy', chainId: 8453, status: 'pending' })

      const tx = store.getTransaction(targetId)
      expect(tx?.type).toBe('cashout')
      expect(tx?.chainId).toBe(10)
    })
  })

  describe('getPendingTransactions', () => {
    it('returns empty array when no transactions exist', () => {
      const store = useTransactionStore.getState()
      const pending = store.getPendingTransactions()
      expect(pending).toEqual([])
    })

    it('returns only pending and submitted transactions', () => {
      const store = useTransactionStore.getState()

      store.addTransaction({ type: 'pay', chainId: 1, status: 'pending' })
      store.addTransaction({ type: 'pay', chainId: 1, status: 'submitted' })
      store.addTransaction({ type: 'pay', chainId: 1, status: 'confirmed' })
      store.addTransaction({ type: 'pay', chainId: 1, status: 'failed' })

      const pending = useTransactionStore.getState().getPendingTransactions()

      expect(pending.length).toBe(2)
      expect(pending.every(tx => tx.status === 'pending' || tx.status === 'submitted')).toBe(true)
    })

    it('excludes confirmed transactions', () => {
      const store = useTransactionStore.getState()

      const id = store.addTransaction({ type: 'pay', chainId: 1, status: 'pending' })
      store.updateTransaction(id, { status: 'confirmed' })

      const pending = useTransactionStore.getState().getPendingTransactions()
      expect(pending.length).toBe(0)
    })
  })

  describe('clearTransactions', () => {
    it('removes all transactions', () => {
      const store = useTransactionStore.getState()

      store.addTransaction({ type: 'pay', chainId: 1, status: 'pending' })
      store.addTransaction({ type: 'cashout', chainId: 10, status: 'submitted' })
      store.addTransaction({ type: 'deploy', chainId: 8453, status: 'confirmed' })

      expect(useTransactionStore.getState().transactions.length).toBe(3)

      store.clearTransactions()

      expect(useTransactionStore.getState().transactions.length).toBe(0)
    })
  })

  describe('transaction state transitions', () => {
    it('follows valid state flow: pending -> submitted -> confirmed', () => {
      const store = useTransactionStore.getState()

      const txId = store.addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'pending',
      })

      let tx = store.getTransaction(txId)
      expect(tx?.status).toBe('pending')

      store.updateTransaction(txId, { status: 'submitted', hash: '0xabc' })
      tx = useTransactionStore.getState().getTransaction(txId)
      expect(tx?.status).toBe('submitted')
      expect(tx?.hash).toBe('0xabc')

      store.updateTransaction(txId, { status: 'confirmed' })
      tx = useTransactionStore.getState().getTransaction(txId)
      expect(tx?.status).toBe('confirmed')
    })

    it('follows valid state flow: pending -> failed', () => {
      const store = useTransactionStore.getState()

      const txId = store.addTransaction({
        type: 'pay',
        chainId: 1,
        status: 'pending',
      })

      store.updateTransaction(txId, {
        status: 'failed',
        error: 'Insufficient funds',
      })

      const tx = useTransactionStore.getState().getTransaction(txId)
      expect(tx?.status).toBe('failed')
      expect(tx?.error).toBe('Insufficient funds')
    })
  })

  describe('chain support', () => {
    it('accepts all supported chain IDs', () => {
      const store = useTransactionStore.getState()
      const chainIds = [1, 10, 8453, 42161] // Ethereum, Optimism, Base, Arbitrum

      chainIds.forEach(chainId => {
        const id = store.addTransaction({
          type: 'pay',
          chainId,
          status: 'pending',
        })
        const tx = useTransactionStore.getState().getTransaction(id)
        expect(tx?.chainId).toBe(chainId)
      })
    })
  })
})
