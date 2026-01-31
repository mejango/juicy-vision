import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Granular payment stages for user feedback
export type PaymentStage =
  | 'checking'      // Checking balances and chain
  | 'switching'     // Switching chains
  | 'approving'     // Waiting for USDC→Permit2 approval tx
  | 'signing'       // Waiting for Permit2 signature
  | 'submitting'    // Sending the pay transaction
  | 'confirming'    // Waiting for transaction to be mined
  | 'queueing'      // Queuing Pay Credits payment for admin processing

export type TransactionStatus = 'pending' | 'submitted' | 'confirmed' | 'failed' | 'cancelled' | 'queued'

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
  | 'mint-nft'

export interface Transaction {
  id: string
  type: TransactionType
  projectId?: string
  chainId: number
  amount?: string
  token?: string
  hash?: string
  status: TransactionStatus
  stage?: PaymentStage  // Current stage for granular progress display
  error?: string
  createdAt: number
  updatedAt: number
  confirmedAt?: number
  // NFT minting fields
  tierId?: number
  quantity?: number
  // Pay Credits spend ID (for queued payments)
  spendId?: string
  // Receipt data from blockchain
  receipt?: {
    blockNumber: number
    blockHash: string
    gasUsed: string
    effectiveGasPrice: string
    status: 'success' | 'reverted'
  }
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
