/**
 * Transactions API Service
 *
 * Communicates with the backend transactions endpoints for persistent
 * transaction tracking and history.
 */

import { apiRequest as sharedApiRequest } from '../services/apiClient'

// =============================================================================
// Types
// =============================================================================

export type TransactionStatus = 'pending' | 'submitted' | 'confirmed' | 'failed' | 'cancelled'

export interface TransactionReceipt {
  blockNumber: number
  blockHash: string
  gasUsed: string
  effectiveGasPrice: string
  status: 'success' | 'reverted'
}

export interface Transaction {
  id: string
  userId: string | null
  sessionId: string | null
  txHash: string | null
  chainId: number
  fromAddress: string
  toAddress: string
  tokenAddress: string | null
  amount: string
  projectId: string | null
  status: TransactionStatus
  errorMessage: string | null
  createdAt: string
  submittedAt: string | null
  confirmedAt: string | null
  receipt: TransactionReceipt | null
}

// =============================================================================
// API Client
// =============================================================================

function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  // These endpoints historically only sent the managed auth token.
  return sharedApiRequest<T>(endpoint, options, { includeSiweAuth: false })
}

// =============================================================================
// Transaction API Functions
// =============================================================================

export interface CreateTransactionParams {
  chainId: number
  fromAddress: string
  toAddress: string
  tokenAddress?: string
  amount: string
  projectId?: string
}

/**
 * Create a new transaction record in the database.
 * Called when a user initiates a payment.
 */
export async function createTransactionRecord(
  params: CreateTransactionParams
): Promise<Transaction> {
  return apiRequest<Transaction>('/transactions', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export interface UpdateTransactionParams {
  status?: TransactionStatus
  txHash?: string
  errorMessage?: string
  receipt?: TransactionReceipt
}

/**
 * Update a transaction's status, hash, or receipt.
 * Called when transaction is submitted, confirmed, or fails.
 */
export async function updateTransactionRecord(
  id: string,
  params: UpdateTransactionParams
): Promise<Transaction> {
  return apiRequest<Transaction>(`/transactions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(params),
  })
}

/**
 * Get a specific transaction by ID.
 */
export async function getTransaction(id: string): Promise<Transaction> {
  return apiRequest<Transaction>(`/transactions/${id}`)
}

/**
 * Get all transactions for the current session.
 * Works for both authenticated and anonymous users.
 */
export async function getSessionTransactions(
  sessionId: string,
  limit = 50
): Promise<Transaction[]> {
  return apiRequest<Transaction[]>(`/transactions/session/${sessionId}?limit=${limit}`)
}

/**
 * Get all transactions for the authenticated user.
 * Requires authentication.
 */
export async function getUserTransactions(
  limit = 50,
  offset = 0
): Promise<Transaction[]> {
  return apiRequest<Transaction[]>(`/transactions?limit=${limit}&offset=${offset}`)
}
