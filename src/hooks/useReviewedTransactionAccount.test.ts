import { describe, expect, it } from 'vitest'
import {
  assertReviewedTransactionAccount,
  assertTransactionAccountUnchanged,
} from './useReviewedTransactionAccount'

const ACCOUNT_A = '0x1111111111111111111111111111111111111111' as const
const ACCOUNT_B = '0x2222222222222222222222222222222222222222' as const

describe('reviewed transaction account', () => {
  it('accepts the unchanged self-custody account', () => {
    expect(() => assertReviewedTransactionAccount({
      reviewed: { address: ACCOUNT_A, mode: 'self_custody' },
      currentAddress: ACCOUNT_A,
      currentMode: 'self_custody',
      walletClientAddress: ACCOUNT_A,
    })).not.toThrow()
  })

  it('blocks active account, wallet account, and custody-mode changes', () => {
    expect(() => assertReviewedTransactionAccount({
      reviewed: { address: ACCOUNT_A, mode: 'self_custody' },
      currentAddress: ACCOUNT_B,
      currentMode: 'self_custody',
      walletClientAddress: ACCOUNT_B,
    })).toThrow(/active account changed/i)

    expect(() => assertReviewedTransactionAccount({
      reviewed: { address: ACCOUNT_A, mode: 'self_custody' },
      currentAddress: ACCOUNT_A,
      currentMode: 'self_custody',
      walletClientAddress: ACCOUNT_B,
    })).toThrow(/wallet account changed/i)

    expect(() => assertReviewedTransactionAccount({
      reviewed: { address: ACCOUNT_A, mode: 'managed' },
      currentAddress: ACCOUNT_A,
      currentMode: 'self_custody',
      walletClientAddress: ACCOUNT_A,
    })).toThrow(/active account changed/i)
  })

  it('does not require an external wallet for the unchanged managed account', () => {
    expect(() => assertReviewedTransactionAccount({
      reviewed: { address: ACCOUNT_A, mode: 'managed' },
      currentAddress: ACCOUNT_A,
      currentMode: 'managed',
    })).not.toThrow()
  })

  it('provides the same invariant for asynchronous transaction hooks', () => {
    expect(() => assertTransactionAccountUnchanged(ACCOUNT_A, ACCOUNT_A)).not.toThrow()
    expect(() => assertTransactionAccountUnchanged(ACCOUNT_A, ACCOUNT_B)).toThrow(/active account changed/i)
  })
})
