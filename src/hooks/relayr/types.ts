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
  processingStartedAt?: number  // Date.now() when status first became 'processing'
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
  bundleState: BundleState
  isExecuting: boolean
  isComplete: boolean
  isExpired: boolean
  hasError: boolean
  reset: () => void
}

// ============================================================================
// Execute Parameters
// ============================================================================

export interface OmnichainExecuteParams {
  chainIds: number[]
  projectIds: Record<number, number>  // chainId -> projectId
  // One of these must be provided
  rulesetConfig?: {
    rulesetConfigurations?: unknown[]  // JBRulesetConfig[]
    rulesetConfigurationsByChain?: Record<number, unknown[]>
    queueTargets?: Record<number, string>
    memo: string
    mustStartAtOrAfter?: number
  }
  distributeConfig?: {
    type: 'reserves'
    controllerAddresses?: Record<number, string>
  }
  deployERC20Config?: {
    tokenName: string
    tokenSymbol: string
    salt: string  // bytes32 - SAME salt for all chains to get same address
    controllerAddresses?: Record<number, string>
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
  /** Unique key to scope persisted deployment state. Each unique key gets its own cache. */
  deploymentKey?: string
  /** Chat ID for scoping deployment results to prevent cross-chat contamination. */
  chatId?: string
}
