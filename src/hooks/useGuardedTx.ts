/**
 * Hook wiring the ambient wallet context (managed smart account or wagmi
 * self-custody) into the shared guarded transaction runner. Project-page
 * actions call `run(request)` and render phases from the callback.
 */

import { useCallback } from "react";
import { useAccount, useWalletClient, useSwitchChain } from "wagmi";
import { useManagedWallet } from "./useManagedWallet";
import { useSafeApp } from "./useSafeApp";
import {
  runGuardedTx,
  type GuardedTxRequest,
  type GuardedWalletContext,
} from "../services/projectTx";

export interface UseGuardedTx {
  /** Address transactions will execute from, or null when nothing is connected. */
  activeAddress: `0x${string}` | null;
  isManagedMode: boolean;
  /** True when connected via Safe{Wallet} (transactions are proposed to the Safe queue). */
  isSafeMode: boolean;
  run: (req: GuardedTxRequest) => Promise<`0x${string}`>;
}

export function useGuardedTx(): UseGuardedTx {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const managed = useManagedWallet();
  const { isSafeApp, safeInfo, detecting } = useSafeApp();

  const isManagedMode = managed.isManagedMode;
  // A detected Safe takes precedence: the app is running inside Safe{Wallet},
  // so the Safe is the active account and every action must route to its queue.
  const activeAddress = (
    detecting
      ? null
      : ((isSafeApp
          ? safeInfo?.safeAddress
          : isManagedMode
            ? managed.address
            : address) ?? null)
  ) as `0x${string}` | null;

  const run = useCallback(
    async (req: GuardedTxRequest) => {
      if (detecting) {
        throw new Error(
          "Connecting to Safe{Wallet}. Wait for the Safe context to finish loading.",
        );
      }
      if (!activeAddress) throw new Error("Connect a wallet first");
      const ctx: GuardedWalletContext = {
        isManagedMode,
        isSafeMode: isSafeApp,
        safeChainId: safeInfo?.chainId,
        activeAddress,
        walletClient,
        switchChain: (chainId: number) => switchChainAsync({ chainId }),
      };
      return runGuardedTx(ctx, req);
    },
    [
      activeAddress,
      detecting,
      isManagedMode,
      isSafeApp,
      safeInfo?.chainId,
      walletClient,
      switchChainAsync,
    ],
  );

  return { activeAddress, isManagedMode, isSafeMode: isSafeApp, run };
}
