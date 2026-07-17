/**
 * Hook wiring the ambient wallet context (managed smart account or wagmi
 * self-custody) into the shared guarded transaction runner. Project-page
 * actions call `run(request)` and render phases from the callback.
 */

import { useCallback } from 'react'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { useManagedWallet } from './useManagedWallet'
import { runGuardedTx, type GuardedTxRequest, type GuardedWalletContext } from '../services/projectTx'

export interface UseGuardedTx {
  /** Address transactions will execute from, or null when nothing is connected. */
  activeAddress: `0x${string}` | null
  isManagedMode: boolean
  run: (req: GuardedTxRequest) => Promise<`0x${string}`>
}

export function useGuardedTx(): UseGuardedTx {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
  const managed = useManagedWallet()

  const isManagedMode = managed.isManagedMode
  const activeAddress = ((isManagedMode ? managed.address : address) ?? null) as `0x${string}` | null

  const run = useCallback(
    async (req: GuardedTxRequest) => {
      if (!activeAddress) throw new Error('Connect a wallet first')
      const ctx: GuardedWalletContext = {
        isManagedMode,
        activeAddress,
        walletClient,
        switchChain: (chainId: number) => switchChainAsync({ chainId }),
      }
      return runGuardedTx(ctx, req)
    },
    [activeAddress, isManagedMode, walletClient, switchChainAsync],
  )

  return { activeAddress, isManagedMode, run }
}
