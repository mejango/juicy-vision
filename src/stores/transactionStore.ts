import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TransactionStatus = 'pending' | 'submitted' | 'confirmed' | 'failed'

export type TransactionType =
  | 'pay'
  | 'cashout'
  | 'deploy'
  | 'sendPayouts'
  | 'useAllowance'
  | 'mintTokens'
  | 'burnTokens'
  | 'launchProject'
  | 'queueRuleset'
  | 'deployERC20'

export interface Transaction {
  id: string
  type: TransactionType
  projectId?: string
  chainId: number
  amount?: string
  token?: string
  hash?: string
  status: TransactionStatus
  error?: string
  createdAt: number
  updatedAt: number
}

interface TransactionState {
  transactions: Transaction[]

  addTransaction: (tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateTransaction: (id: string, updates: Partial<Transaction>) => void
  getTransaction: (id: string) => Transaction | undefined
  getPendingTransactions: () => Transaction[]
  clearTransactions: () => void
}

const generateId = () => Math.random().toString(36).substring(2, 15)

export const useTransactionStore = create<TransactionState>()(
  persist(
    (set, get) => ({
      transactions: [],

      addTransaction: (tx) => {
        const id = generateId()
        const now = Date.now()
        const newTx: Transaction = {
          ...tx,
          id,
          createdAt: now,
          updatedAt: now,
        }
        set((state) => ({
          transactions: [newTx, ...state.transactions],
        }))
        return id
      },

      updateTransaction: (id, updates) => {
        set((state) => ({
          transactions: state.transactions.map((tx) =>
            tx.id === id ? { ...tx, ...updates, updatedAt: Date.now() } : tx
          ),
        }))
      },

      getTransaction: (id) => {
        return get().transactions.find((tx) => tx.id === id)
      },

      getPendingTransactions: () => {
        return get().transactions.filter(
          (tx) => tx.status === 'pending' || tx.status === 'submitted'
        )
      },

      clearTransactions: () => set({ transactions: [] }),
    }),
    {
      name: 'juice-transactions',
    }
  )
)
