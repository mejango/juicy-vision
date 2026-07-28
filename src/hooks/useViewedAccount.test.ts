import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useViewedAccount } from './useViewedAccount'
import { useViewAsStore } from '../stores/viewAsStore'

const CONNECTED = '0x1111111111111111111111111111111111111111'
const PASSKEY = '0x2222222222222222222222222222222222222222'
const VIEWED = '0x3333333333333333333333333333333333333333'

const { accountState, passkeyState } = vi.hoisted(() => ({
  accountState: { address: undefined as string | undefined },
  passkeyState: { wallet: null as { address: string } | null },
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: accountState.address }),
}))

vi.mock('../services/passkeyWallet', () => ({
  getPasskeyWallet: () => passkeyState.wallet,
}))

describe('useViewedAccount', () => {
  beforeEach(() => {
    accountState.address = undefined
    passkeyState.wallet = null
    useViewAsStore.setState({ viewAs: null })
  })

  it('mirrors the connected wagmi account when view-as is off', () => {
    accountState.address = CONNECTED
    const { result } = renderHook(() => useViewedAccount())
    expect(result.current).toEqual({
      address: CONNECTED,
      connectedAddress: CONNECTED,
      isViewAs: false,
    })
  })

  it('falls back to the local passkey wallet when wagmi is disconnected', () => {
    passkeyState.wallet = { address: PASSKEY }
    const { result } = renderHook(() => useViewedAccount())
    expect(result.current.connectedAddress).toBe(PASSKEY)
    expect(result.current.address).toBe(PASSKEY)
  })

  it('overrides the displayed address while keeping connectedAddress intact', () => {
    accountState.address = CONNECTED
    const { result } = renderHook(() => useViewedAccount())

    act(() => {
      useViewAsStore.getState().setViewAs(VIEWED)
    })
    expect(result.current).toEqual({
      address: VIEWED,
      connectedAddress: CONNECTED,
      isViewAs: true,
    })

    act(() => {
      useViewAsStore.getState().clearViewAs()
    })
    expect(result.current).toEqual({
      address: CONNECTED,
      connectedAddress: CONNECTED,
      isViewAs: false,
    })
  })

  it('works fully disconnected: view-as still provides the display address', () => {
    act(() => {
      useViewAsStore.getState().setViewAs(VIEWED)
    })
    const { result } = renderHook(() => useViewedAccount())
    expect(result.current).toEqual({
      address: VIEWED,
      connectedAddress: undefined,
      isViewAs: true,
    })
  })

  it('re-reads the passkey wallet on connect/disconnect events', () => {
    const { result } = renderHook(() => useViewedAccount())
    expect(result.current.connectedAddress).toBeUndefined()

    act(() => {
      passkeyState.wallet = { address: PASSKEY }
      window.dispatchEvent(new CustomEvent('juice:passkey-connected'))
    })
    expect(result.current.connectedAddress).toBe(PASSKEY)

    act(() => {
      passkeyState.wallet = null
      window.dispatchEvent(new CustomEvent('juice:passkey-disconnected'))
    })
    expect(result.current.connectedAddress).toBeUndefined()
  })
})
