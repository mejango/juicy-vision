import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { useViewAsStore } from '../stores/viewAsStore'
import { getPasskeyWallet } from '../services/passkeyWallet'

export interface ViewedAccount {
  /** The address the site should display data for (view-as wins over the connection). */
  address: string | undefined
  /** The genuinely connected account (wagmi, or the local passkey wallet). Writes must use this. */
  connectedAddress: string | undefined
  /** True when view-as mode is overriding the connected account. */
  isViewAs: boolean
}

/**
 * The account the site is currently VIEWED as. Display and data-read surfaces
 * ("your balances", "your projects", "you own this") key off `address`;
 * anything that signs, sends, or proposes must keep using `connectedAddress`
 * (or its own wallet context) — the review seams refuse writes while view-as
 * is active.
 *
 * Mirrors WalletInfo's connected-address priority: wagmi self-custody first,
 * then the local passkey wallet.
 */
export function useViewedAccount(): ViewedAccount {
  const { address: wagmiAddress } = useAccount()
  const viewAs = useViewAsStore(s => s.viewAs)
  const [passkeyAddress, setPasskeyAddress] = useState<string | undefined>(
    () => getPasskeyWallet()?.address
  )

  useEffect(() => {
    const sync = () => setPasskeyAddress(getPasskeyWallet()?.address)
    window.addEventListener('juice:passkey-connected', sync)
    window.addEventListener('juice:passkey-disconnected', sync)
    return () => {
      window.removeEventListener('juice:passkey-connected', sync)
      window.removeEventListener('juice:passkey-disconnected', sync)
    }
  }, [])

  const connectedAddress = wagmiAddress ?? passkeyAddress
  return {
    address: viewAs ?? connectedAddress,
    connectedAddress,
    isViewAs: viewAs !== null,
  }
}
