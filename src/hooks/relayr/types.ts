import type { BundleTransactionStatus, PaymentOption } from '../../services/relayr'

// ============================================================================
// Bundle State Types
// ============================================================================

export type BundleStatus = 'idle' | 'creating' | 'awaiting_payment' | 'processing' | 'completed' | 'partial' | 'failed' | 'expired'

export interface ChainState {
  chainId: number
  projectId?: number
  status: 'pending' | 'submitted' | 'confirmed' | 'failed'
  txHash?: string
  error?: string
  gasUsed?: string
}

export interface BundleState {
  bundleId: string | null
  status: BundleStatus
  chainStates: ChainState[]
  paymentOptions: PaymentOption[]
  selectedPaymentChain: number | null
  paymentTxHash: string | null
  error: string | null
  synchronizedStartTime?: number
  expiresAt?: number  // Unix timestamp when payment quote expires
}

// ============================================================================
// Hook Return Types
// ============================================================================

export interface UseRelayrStatusReturn {
  data: {
    status: string
    transactions: BundleTransactionStatus[]
    paymentReceived: boolean
  } | null
  isPolling: boolean
  error: Error | null
  startPolling: () => void
  stopPolling: () => void
  refetch: () => Promise<void>
}

export interface UseRelayrBundleReturn {
  bundleState: BundleState
  isCreating: boolean
  isProcessing: boolean
  isComplete: boolean
  isExpired: boolean
  hasError: boolean
  timeRemainingSeconds: number | null  // Seconds until quote expires, null if not applicable
  reset: () => void
  setPaymentChain: (chainId: number) => void
  updateFromStatus: (status: {
    status: string
    transactions: BundleTransactionStatus[]
    paymentReceived: boolean
  }) => void
}

export interface UseOmnichainTransactionReturn {
  execute: (params: OmnichainExecuteParams) => Promise<void>
  submitPayment: (signedTx: string) => Promise<void>
  bundleState: BundleState
  isExecuting: boolean
  isComplete: boolean
  isExpired: boolean
  hasError: boolean
  reset: () => void
  setPaymentChain: (chainId: number) => void
}

// ============================================================================
// Execute Parameters
// ============================================================================

export interface OmnichainExecuteParams {
  chainIds: number[]
  projectIds: Record<number, number>  // chainId -> projectId
  // One of these must be provided
  rulesetConfig?: {
    rulesetConfigurations: unknown[]  // JBRulesetConfig[]
    memo: string
    mustStartAtOrAfter?: number
  }
  distributeConfig?: {
    type: 'payouts' | 'reserves'
  }
  deployERC20Config?: {
    tokenName: string
    tokenSymbol: string
    salt: string  // bytes32 - SAME salt for all chains to get same address
  }
}

export interface ChainProjectMapping {
  chainId: number
  projectId: number
}

// ============================================================================
// Hook Options
// ============================================================================

export interface UseRelayrStatusOptions {
  bundleId: string | null
  enabled?: boolean
  pollingInterval?: number  // Default: 2000ms
  stopOnComplete?: boolean  // Default: true
}

export interface UseOmnichainTransactionOptions {
  onSuccess?: (bundleId: string, txHashes: Record<number, string>) => void
  onError?: (error: Error) => void
  onPaymentRequired?: (paymentOptions: PaymentOption[]) => void
}
