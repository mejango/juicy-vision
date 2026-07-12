import { useCallback, useEffect, useState } from 'react'
import { isAddress } from 'viem'

export type TransactionAccountMode = 'self_custody' | 'managed'

interface ReviewedAccount {
  address: `0x${string}`
  mode: TransactionAccountMode
}

export function assertTransactionAccountUnchanged(
  reviewedAddress: string,
  currentAddress: string | null | undefined,
): void {
  if (!isAddress(reviewedAddress) || !currentAddress || !isAddress(currentAddress) ||
      reviewedAddress.toLowerCase() !== currentAddress.toLowerCase()) {
    throw new Error('The active account changed after review opened. Close this review and try again.')
  }
}

export function assertReviewedTransactionAccount({
  reviewed,
  currentAddress,
  currentMode,
  walletClientAddress,
}: {
  reviewed: ReviewedAccount | null
  currentAddress: string | null | undefined
  currentMode: TransactionAccountMode
  walletClientAddress?: string | null
}): void {
  if (!reviewed) throw new Error('The reviewed account is not available. Close this review and try again.')
  if (!currentAddress || !isAddress(currentAddress)) {
    throw new Error('The active account is unavailable. Close this review and reconnect.')
  }
  if (reviewed.mode !== currentMode) {
    throw new Error('The active account changed after review opened. Close this review and try again.')
  }
  assertTransactionAccountUnchanged(reviewed.address, currentAddress)
  if (currentMode === 'self_custody') {
    if (!walletClientAddress || !isAddress(walletClientAddress)) {
      throw new Error('The wallet account could not be verified. Close this review and reconnect.')
    }
    if (walletClientAddress.toLowerCase() !== reviewed.address.toLowerCase()) {
      throw new Error('The wallet account changed after review opened. Close this review and try again.')
    }
  }
}

export function useReviewedTransactionAccount(
  isOpen: boolean,
  currentAddress: string | null | undefined,
  currentMode: TransactionAccountMode,
) {
  const [reviewed, setReviewed] = useState<ReviewedAccount | null>(null)

  useEffect(() => {
    if (!isOpen) {
      setReviewed(null)
      return
    }
    if (!currentAddress || !isAddress(currentAddress)) return
    setReviewed(existing => existing ?? {
      address: currentAddress as `0x${string}`,
      mode: currentMode,
    })
  }, [currentAddress, currentMode, isOpen])

  const assertCurrentAccount = useCallback((walletClientAddress?: string | null) => {
    assertReviewedTransactionAccount({
      reviewed,
      currentAddress,
      currentMode,
      walletClientAddress,
    })
  }, [currentAddress, currentMode, reviewed])

  return {
    reviewedAddress: reviewed?.address ?? null,
    reviewReady: reviewed !== null,
    assertCurrentAccount,
  }
}
