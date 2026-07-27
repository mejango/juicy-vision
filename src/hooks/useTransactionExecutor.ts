import { useEffect, useCallback } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import {
  createPublicClient,
  http,
  parseEther,
  parseUnits,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  type Address,
  type Chain,
} from "viem";
import {
  NATIVE_TOKEN,
  jbMultiTerminalAbi,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import {
  buildPayTx,
  buildPermit2ApproveTx,
  buildUniswapV4ExactInputSwapTx,
  chooseBestPayRoute,
  uniswapV4Deployment,
} from "@bananapus/nana-sdk-core/v6";
import { useTransactionStore, useAuthStore } from "../stores";
import { wagmiConfig } from "../config/wagmi";
import {
  ALL_VIEM_CHAINS,
  RPC_ENDPOINTS,
  USDC_ADDRESSES,
  type SupportedChainId,
} from "../constants";
import { getPaymentTerminal } from "../utils";
import {
  fetchNFTTiers,
  getProjectDataHook,
  requireRecognized721HookIdentity,
} from "../services/nft";
import {
  assertSafeNftPaymentSelection,
  type VerifiedNFTPaymentSelection,
} from "../utils/tierSafety";
import {
  requestPaymentReview,
  type PaymentReview,
} from "../utils/paymentReview";
import {
  assertCurrentProjectPayConfigurationTrusted,
  requireRecognizedRuntimeHook,
} from "../utils/projectTrust";
import {
  createTransactionRecord,
  updateTransactionRecord,
  type TransactionReceipt,
} from "../api/transactions";
import {
  resolvePayPreviewOutcome,
  TERMINAL_PREVIEW_PAY_ABI,
} from "../utils/terminalPreview";
import {
  executeManagedTransaction,
  useManagedWallet,
} from "./useManagedWallet";
import { buildNftPayMetadata } from "../utils/nftPayMetadata";
import { friendlyTransactionError } from "../utils/txErrors";
import {
  encodeApprovalTx,
  getActiveSafeInfo,
  proposeSafeTransactions,
  waitForSafeExecution,
  type SafeTx,
} from "../services/safeApp";
import { useSafeApp } from "./useSafeApp";
import { submitTrackedTokenApproval } from "../services/trackedTokenApproval";
import { quoteDirectBuy } from "../services/ammMarket";

const API_BASE = import.meta.env.VITE_API_URL || "";

// Chain configs
const CHAINS: Record<number, Chain> = ALL_VIEM_CHAINS;

interface PayEventDetail {
  txId: string;
  projectId: string;
  chainId: number;
  amount: string;
  memo: string;
  action?: "pay" | "addToBalance";
  token?: string;
  /** The on-chain token address for the selected currency (advisory; the executor still validates). */
  tokenAddress?: string;
  tierIds?: number[];
  tierSelections?: Array<{ tierId: number; quantity: number; name: string }>;
  /** Legacy single-tier event shape. */
  tierId?: number | null;
  hookAddress?: `0x${string}` | null;
  /** The card selected a direct V4 swap because its guaranteed output beat pay. */
  directSwapRequested?: boolean;
}

export function useTransactionExecutor() {
  const { address, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { updateTransaction } = useTransactionStore();
  const { token: authToken } = useAuthStore();
  const { address: managedAddress, isManagedMode } = useManagedWallet();
  const { safeInfo, detecting: detectingSafe } = useSafeApp();

  const buildPayCallData = useCallback(
    (
      chainId: number,
      terminal: Address,
      projectId: number,
      tokenAddress: Address,
      amount: bigint,
      beneficiary: Address,
      memo: string,
      metadata: Hex,
      minReturnedTokens: bigint,
    ): Hex => {
      if (minReturnedTokens < 0n)
        throw new Error("Payment minimum cannot be negative");
      const payTx = buildPayTx({
        chainId: chainId as JBChainId,
        terminal,
        projectId: BigInt(projectId),
        token: tokenAddress,
        amount,
        beneficiary,
        minReturnedTokens,
        memo,
        metadata,
      });
      return encodeFunctionData({
        abi: payTx.abi,
        functionName: payTx.functionName,
        args: payTx.args,
      });
    },
    [],
  );

  const executeAddToBalanceTransaction = useCallback(
    async (detail: PayEventDetail) => {
      const { txId, projectId, chainId, amount, memo } = detail;
      const token = detail.token === "USDC" ? "USDC" : "ETH";
      const isUsdc = token === "USDC";
      updateTransaction(txId, { stage: "checking" });

      let backendTxId: string | null = null;
      try {
        if (detectingSafe) {
          throw new Error(
            "Connecting to Safe{Wallet}. Wait for the Safe context to finish loading.",
          );
        }
        if ((detail.tierIds?.length ?? 0) > 0 || detail.tierId) {
          throw new Error("Balance contributions cannot mint shop items");
        }
        if (detail.token === "PAY_CREDITS") {
          throw new Error(
            "Pay Credits cannot be added directly to an onchain project balance",
          );
        }
        if (!safeInfo && isManagedMode && isUsdc) {
          throw new Error(
            "Managed balance contributions currently support ETH only",
          );
        }
        const chain = CHAINS[chainId];
        if (!chain) throw new Error("Unsupported chain");
        const tokenAddress = isUsdc
          ? USDC_ADDRESSES[chainId as SupportedChainId]
          : NATIVE_TOKEN;
        if (!tokenAddress)
          throw new Error("USDC is not supported on this chain");
        const rawAmount = isUsdc ? parseUnits(amount, 6) : parseEther(amount);
        if (rawAmount <= 0n)
          throw new Error("Contribution amount must be greater than zero");

        const publicClient = createPublicClient({
          chain,
          transport: http(
            RPC_ENDPOINTS[chainId]?.[0] ?? chain.rpcUrls.default.http[0],
          ),
        });
        const resolveTerminal = async () => {
          const terminal = await getPaymentTerminal(
            publicClient,
            chainId,
            BigInt(projectId),
            tokenAddress,
            "accounting",
          );
          if (terminal.type !== "multi") {
            throw new Error(
              "Add to balance requires a directly accepted accounting token",
            );
          }
          return terminal.address;
        };
        const terminalAddress = await resolveTerminal();

        let walletClient;
        let account: Address;
        if (safeInfo) {
          if (safeInfo.chainId !== chainId) {
            throw new Error(
              `This Safe is on chain ${safeInfo.chainId}, but the contribution targets chain ${chainId}.`,
            );
          }
          account = safeInfo.safeAddress;
        } else if (isManagedMode) {
          if (!managedAddress) throw new Error("Managed wallet not ready");
          account = managedAddress as Address;
        } else {
          walletClient = await getWalletClient(wagmiConfig);
          if (!walletClient?.account) throw new Error("Wallet not connected");
          account = walletClient.account.address;
        }

        const nativeBalance = await publicClient.getBalance({
          address: account,
        });
        let reviewedAllowance = 0n;
        if (isUsdc) {
          const [balance, allowance] = await Promise.all([
            publicClient.readContract({
              address: tokenAddress,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [account],
            }),
            publicClient.readContract({
              address: tokenAddress,
              abi: erc20Abi,
              functionName: "allowance",
              args: [account, terminalAddress],
            }),
          ]);
          if (balance < rawAmount)
            throw new Error("Insufficient USDC for this contribution");
          if (!safeInfo && nativeBalance === 0n)
            throw new Error("ETH is required for the network fee");
          reviewedAllowance = allowance;
        } else if (
          isManagedMode || safeInfo
            ? nativeBalance < rawAmount
            : nativeBalance <= rawAmount
        ) {
          throw new Error(
            isManagedMode || safeInfo
              ? "Insufficient ETH for this contribution"
              : "Insufficient ETH for this contribution and the network fee",
          );
        }

        const approvalRequired = isUsdc && reviewedAllowance < rawAmount;
        const approvalData = approvalRequired
          ? encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [terminalAddress, rawAmount],
            })
          : null;
        const callData = encodeFunctionData({
          abi: jbMultiTerminalAbi,
          functionName: "addToBalanceOf",
          args: [BigInt(projectId), tokenAddress, rawAmount, false, memo, "0x"],
        });
        const value = isUsdc ? 0n : rawAmount;
        const approved = await requestPaymentReview({
          action: "addToBalance",
          txId,
          account,
          chainId,
          chainName: chain.name,
          projectId,
          terminal: terminalAddress,
          route: "direct terminal payment",
          tokenSymbol: token,
          tokenAddress,
          amount,
          amountRaw: rawAmount.toString(),
          valueRaw: value.toString(),
          beneficiary: account,
          memo,
          rulesetId: "not applicable",
          expectedProjectTokens: "0",
          minimumProjectTokens: "0",
          metadata: "0x",
          callData,
          approval: approvalRequired
            ? {
                token: tokenAddress,
                spender: terminalAddress,
                amount: rawAmount.toString(),
                callData: approvalData!,
              }
            : null,
          nfts: [],
        });
        if (!approved) throw new Error("Payment review cancelled");
        const callKey = [
          account.toLowerCase(),
          chainId,
          terminalAddress.toLowerCase(),
          value.toString(),
          callData.toLowerCase(),
          approvalData?.toLowerCase() ?? "",
        ].join(":");
        const duplicate = useTransactionStore
          .getState()
          .transactions.find(
            (transaction) =>
              transaction.id !== txId &&
              transaction.callKey === callKey &&
              (transaction.status === "pending" ||
                transaction.status === "submitted" ||
                transaction.status === "safe-proposed"),
          );
        if (duplicate)
          throw new Error(
            "This exact contribution is already pending. Wait for it to settle before trying again.",
          );
        updateTransaction(txId, {
          account,
          callKey,
          label: `Add ${amount} ${token} to project #${projectId}`,
        });
        if (
          (await resolveTerminal()).toLowerCase() !==
          terminalAddress.toLowerCase()
        ) {
          throw new Error(
            "The project accounting terminal changed. Review the contribution again.",
          );
        }

        if (safeInfo) {
          const currentSafe = getActiveSafeInfo();
          if (
            !currentSafe ||
            currentSafe.chainId !== chainId ||
            currentSafe.safeAddress.toLowerCase() !== account.toLowerCase()
          ) {
            throw new Error(
              "The connected Safe changed. Review the contribution again.",
            );
          }
        } else if (isManagedMode) {
          const auth = useAuthStore.getState();
          if (
            !auth.isAuthenticated() ||
            auth.mode !== "managed" ||
            !auth.token
          ) {
            throw new Error(
              "Managed wallet session changed. Review the contribution again.",
            );
          }
        } else {
          walletClient = await getWalletClient(wagmiConfig);
          if (
            !walletClient?.account ||
            walletClient.account.address.toLowerCase() !== account.toLowerCase()
          ) {
            throw new Error(
              "Connected wallet changed. Review the contribution again.",
            );
          }
          if ((await walletClient.getChainId()) !== chainId) {
            updateTransaction(txId, { stage: "switching" });
            await switchChainAsync({ chainId });
            walletClient = await getWalletClient(wagmiConfig);
          }
          if (
            !walletClient?.account ||
            walletClient.account.address.toLowerCase() !==
              account.toLowerCase() ||
            (await walletClient.getChainId()) !== chainId
          ) {
            throw new Error(
              "Wallet account or network changed. Review the contribution again.",
            );
          }
          if (
            (await resolveTerminal()).toLowerCase() !==
            terminalAddress.toLowerCase()
          ) {
            throw new Error(
              "The project accounting terminal changed. Review the contribution again.",
            );
          }
          if (isUsdc) {
            const allowance = await publicClient.readContract({
              address: tokenAddress,
              abi: erc20Abi,
              functionName: "allowance",
              args: [account, terminalAddress],
            });
            if (allowance < rawAmount && !approvalRequired) {
              throw new Error(
                "The token allowance changed. Review the contribution again.",
              );
            }
            if (allowance < rawAmount) {
              updateTransaction(txId, { stage: "approving" });
              await submitTrackedTokenApproval({
                chainId,
                chain,
                account,
                token: tokenAddress,
                spender: terminalAddress,
                amount: rawAmount,
                data: approvalData!,
                walletClient,
                publicClient,
              });
            }
          }
        }

        updateTransaction(txId, { stage: "submitting" });
        if (safeInfo && approvalRequired) {
          await publicClient.call({
            account,
            to: tokenAddress,
            data: approvalData!,
            value: 0n,
          });
        } else {
          await publicClient.call({
            account,
            to: terminalAddress,
            data: callData,
            value,
          });
        }
        try {
          const record = await createTransactionRecord({
            chainId,
            fromAddress: account,
            toAddress: terminalAddress,
            tokenAddress: isUsdc ? tokenAddress : undefined,
            amount,
            projectId,
          });
          backendTxId = record.id;
        } catch {
          // Tracking is non-fatal; the exact transaction has already passed review and simulation.
        }

        let hash: Hex;
        if (safeInfo) {
          const txs: SafeTx[] = [];
          if (approvalRequired)
            txs.push(
              encodeApprovalTx(tokenAddress, terminalAddress, rawAmount),
            );
          txs.push({
            to: terminalAddress,
            data: callData,
            value: `0x${value.toString(16)}`,
          });
          const safeTxHash = await proposeSafeTransactions(txs);
          updateTransaction(txId, {
            safeTxHash,
            status: "safe-proposed",
            stage: undefined,
          });
          hash = await waitForSafeExecution(safeTxHash);
        } else if (isManagedMode) {
          hash = (await executeManagedTransaction(
            chainId,
            terminalAddress,
            callData,
            value.toString(),
          )) as Hex;
        } else {
          hash = await walletClient!.sendTransaction({
            to: terminalAddress,
            data: callData,
            value,
            chain,
            account,
          });
        }
        updateTransaction(txId, {
          hash,
          status: "submitted",
          stage: "confirming",
        });
        if (backendTxId) {
          updateTransactionRecord(backendTxId, {
            status: "submitted",
            txHash: hash,
          }).catch(() => {});
        }
        try {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash,
          });
          const receiptData: TransactionReceipt = {
            blockNumber: Number(receipt.blockNumber),
            blockHash: receipt.blockHash,
            gasUsed: receipt.gasUsed.toString(),
            effectiveGasPrice: receipt.effectiveGasPrice.toString(),
            status: receipt.status,
          };
          const status = receipt.status === "success" ? "confirmed" : "failed";
          updateTransaction(txId, {
            hash,
            status,
            stage: undefined,
            confirmedAt: Date.now(),
            receipt: receiptData,
            ...(receipt.status === "reverted" && {
              error: "Transaction reverted",
            }),
          });
          if (backendTxId) {
            updateTransactionRecord(backendTxId, {
              status,
              receipt: receiptData,
              ...(receipt.status === "reverted" && {
                errorMessage: "Transaction reverted",
              }),
            }).catch(() => {});
          }
        } catch {
          // The hash remains useful if this RPC cannot confirm it. Keep the
          // transaction submitted for explorer/history reconciliation.
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cancelled = /rejected|denied|cancelled/i.test(message);
        const status = cancelled ? "cancelled" : "failed";
        const failureMessage =
          friendlyTransactionError(error) ?? message.slice(0, 100);
        updateTransaction(txId, {
          status,
          stage: undefined,
          error: cancelled ? "Transaction cancelled" : failureMessage,
        });
        if (backendTxId) {
          updateTransactionRecord(backendTxId, {
            status,
            errorMessage: cancelled ? "Transaction cancelled" : failureMessage,
          }).catch(() => {});
        }
      }
    },
    [
      detectingSafe,
      isManagedMode,
      managedAddress,
      safeInfo,
      switchChainAsync,
      updateTransaction,
    ],
  );

  const executePayTransaction = useCallback(
    async (detail: PayEventDetail) => {
      if (detail.action === "addToBalance") {
        await executeAddToBalanceTransaction(detail);
        return;
      }
      const { txId, projectId, chainId, amount, memo, token, hookAddress } =
        detail;
      const tierIds = detail.tierIds ?? (detail.tierId ? [detail.tierId] : []);

      // Handle PAY_CREDITS payments via API
      if (token === "PAY_CREDITS") {
        if (tierIds.length > 0) {
          updateTransaction(txId, {
            status: "failed",
            error: "Shop purchases require an onchain ETH or USDC payment",
          });
          return;
        }
        updateTransaction(txId, { stage: "queueing" });

        if (!authToken) {
          updateTransaction(txId, {
            status: "failed",
            error: "Not authenticated",
          });
          return;
        }

        try {
          // Create spend for the main project payment
          const res = await fetch(`${API_BASE}/juice/spend`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({
              amount: parseFloat(amount),
              projectId: parseInt(projectId),
              chainId,
              memo: memo || undefined,
            }),
          });

          const data = await res.json();

          if (!data.success) {
            throw new Error(data.error || "Failed to queue payment");
          }

          // Payment successfully queued
          updateTransaction(txId, {
            status: "queued",
            stage: undefined,
            spendId: data.data.spendId,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          updateTransaction(txId, {
            status: "failed",
            error: errorMessage.slice(0, 100),
          });
        }
        return;
      }

      const isUsdc = token === "USDC";

      // Start with checking stage
      updateTransaction(txId, { stage: "checking" });

      const chain = CHAINS[chainId];
      if (!chain) {
        updateTransaction(txId, {
          status: "failed",
          error: "Unsupported chain",
        });
        return;
      }

      // For USDC, get the address for this chain
      const usdcAddress = isUsdc
        ? USDC_ADDRESSES[chainId as SupportedChainId]
        : null;
      if (isUsdc && !usdcAddress) {
        updateTransaction(txId, {
          status: "failed",
          error: "USDC not supported on this chain",
        });
        return;
      }

      const tokenAddress = isUsdc ? usdcAddress! : NATIVE_TOKEN;
      let projectAmount: bigint;
      try {
        if (detectingSafe) {
          throw new Error(
            "Connecting to Safe{Wallet}. Wait for the Safe context to finish loading.",
          );
        }
        projectAmount = isUsdc ? parseUnits(amount, 6) : parseEther(amount);
        if (projectAmount <= 0n)
          throw new Error("Payment amount must be greater than zero");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Payment amount is invalid";
        updateTransaction(txId, {
          status: "failed",
          error: message.slice(0, 100),
        });
        return;
      }

      // Create a public client for terminal detection
      const publicClient = createPublicClient({
        chain,
        transport: http(
          RPC_ENDPOINTS[chainId]?.[0] ?? chain.rpcUrls.default.http[0],
        ),
      });

      // Dynamically detect which terminal to use
      let terminalAddress: Address;
      let terminalType: "multi" | "router";
      try {
        const terminal = await getPaymentTerminal(
          publicClient,
          chainId,
          BigInt(projectId),
          tokenAddress,
        );
        terminalAddress = terminal.address;
        terminalType = terminal.type;
        if (terminal.type === "multi") {
          const accountingTerminal = await getPaymentTerminal(
            publicClient,
            chainId,
            BigInt(projectId),
            tokenAddress,
            "accounting",
          );
          if (
            accountingTerminal.address.toLowerCase() !==
            terminal.address.toLowerCase()
          ) {
            throw new Error(
              "The payment route does not match the live accounting context",
            );
          }
        } else if (isUsdc) {
          const decimals = await publicClient.readContract({
            address: usdcAddress!,
            abi: erc20Abi,
            functionName: "decimals",
          });
          if (Number(decimals) !== 6) {
            throw new Error(
              "The routed payment token decimals are not recognized",
            );
          }
        }
        await assertCurrentProjectPayConfigurationTrusted({
          client: publicClient,
          projectId: BigInt(projectId),
        });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to detect payment terminal";
        updateTransaction(txId, {
          status: "failed",
          error: message.slice(0, 100),
        });
        return;
      }

      let nftMetadata: Hex = "0x";
      let verifiedNFTSelection: VerifiedNFTPaymentSelection | null = null;
      if (tierIds.length > 0) {
        try {
          if (!hookAddress)
            throw new Error("NFT hook is unavailable for this project");
          const projectHook = await getProjectDataHook(projectId, chainId);
          if (
            !projectHook ||
            projectHook.toLowerCase() !== hookAddress.toLowerCase()
          ) {
            throw new Error("NFT hook does not match this project");
          }
          const identity = await requireRecognized721HookIdentity(
            publicClient,
            hookAddress,
            BigInt(projectId),
          );
          const liveTiers = await fetchNFTTiers(hookAddress, chainId);
          verifiedNFTSelection = assertSafeNftPaymentSelection({
            tiers: liveTiers,
            tierIds,
            paymentToken: isUsdc ? "USDC" : "ETH",
            paymentAmount: projectAmount,
            paymentDecimals: isUsdc ? 6 : 18,
          });
          nftMetadata = buildNftPayMetadata(identity.metadataIdTarget, tierIds);
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "NFT purchase configuration is unavailable";
          updateTransaction(txId, {
            status: "failed",
            error: message.slice(0, 100),
          });
          return;
        }
      }

      let client;
      let currentAddress: Address;
      if (safeInfo) {
        if (safeInfo.chainId !== chainId) {
          updateTransaction(txId, {
            status: "failed",
            error: `This Safe is on chain ${safeInfo.chainId}, but the payment targets chain ${chainId}`,
          });
          return;
        }
        currentAddress = safeInfo.safeAddress;
      } else if (isManagedMode) {
        if (isUsdc) {
          updateTransaction(txId, {
            status: "failed",
            error: "Managed onchain payments currently support ETH only",
          });
          return;
        }
        if (!managedAddress) {
          updateTransaction(txId, {
            status: "failed",
            error: "Managed wallet not ready",
          });
          return;
        }
        currentAddress = managedAddress as Address;
      } else {
        try {
          client = await getWalletClient(wagmiConfig);
        } catch {
          updateTransaction(txId, {
            status: "failed",
            error: "Wallet not connected",
          });
          return;
        }
        if (!client?.account) {
          updateTransaction(txId, {
            status: "failed",
            error: "Wallet not ready",
          });
          return;
        }
        currentAddress = client.account.address;
      }
      const beneficiary = currentAddress as Address;

      let backendTxId: string | null = null;

      try {
        const assertFreshPayConfiguration = async () => {
          const freshTerminal = await getPaymentTerminal(
            publicClient,
            chainId,
            BigInt(projectId),
            tokenAddress,
          );
          if (
            freshTerminal.address.toLowerCase() !==
            terminalAddress.toLowerCase()
          ) {
            throw new Error(
              "The project payment terminal changed. Review the payment again.",
            );
          }
          if (freshTerminal.type !== terminalType) {
            throw new Error(
              "The project payment route changed. Review the payment again.",
            );
          }
          if (freshTerminal.type === "multi") {
            const accountingTerminal = await getPaymentTerminal(
              publicClient,
              chainId,
              BigInt(projectId),
              tokenAddress,
              "accounting",
            );
            if (
              accountingTerminal.address.toLowerCase() !==
              terminalAddress.toLowerCase()
            ) {
              throw new Error(
                "The live accounting context changed. Review the payment again.",
              );
            }
          } else if (isUsdc) {
            const decimals = await publicClient.readContract({
              address: usdcAddress!,
              abi: erc20Abi,
              functionName: "decimals",
            });
            if (Number(decimals) !== 6) {
              throw new Error(
                "The routed payment token decimals changed. Review the payment again.",
              );
            }
          }
          await assertCurrentProjectPayConfigurationTrusted({
            client: publicClient,
            projectId: BigInt(projectId),
          });
        };

        const assertSufficientLiveBalances = async () => {
          const nativeBalance = await publicClient.getBalance({
            address: currentAddress,
          });
          if (
            !isUsdc &&
            (isManagedMode || safeInfo
              ? nativeBalance < projectAmount
              : nativeBalance <= projectAmount)
          ) {
            throw new Error(
              isManagedMode || safeInfo
                ? "Insufficient ETH for the payment"
                : "Insufficient ETH for the payment and network fee",
            );
          }
          if (isUsdc) {
            const tokenBalance = await publicClient.readContract({
              address: usdcAddress!,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [currentAddress],
            });
            if (tokenBalance < projectAmount) {
              throw new Error("Insufficient USDC for this payment");
            }
            if (!safeInfo && nativeBalance === 0n) {
              throw new Error("ETH is required for the network fee");
            }
          }
        };

        const previewAndValidate = async (metadata: Hex) => {
          await assertFreshPayConfiguration();
          const preview = await publicClient.readContract({
            account: currentAddress,
            address: terminalAddress,
            abi: TERMINAL_PREVIEW_PAY_ABI,
            functionName: "previewPayFor",
            args: [
              BigInt(projectId),
              tokenAddress,
              projectAmount,
              beneficiary,
              metadata,
            ],
          });
          for (const specification of preview[3]) {
            if (!specification.noop) {
              await requireRecognizedRuntimeHook({
                client: publicClient,
                projectId: BigInt(projectId),
                rulesetId: preview[0].id,
                hook: specification.hook,
              });
            }
          }
          return preview;
        };

        const selectionFingerprint = (selection: VerifiedNFTPaymentSelection) =>
          JSON.stringify({
            items: selection.items.map((item) => ({
              tierId: item.tierId,
              quantity: item.quantity,
              unitPrice: item.unitPrice.toString(),
            })),
            totalTierPrice: selection.totalTierPrice.toString(),
            minimumPaymentAmount: selection.minimumPaymentAmount.toString(),
            pricingCurrency: selection.pricingCurrency,
            pricingDecimals: selection.pricingDecimals,
          });
        const assertFreshNFTSelection = async () => {
          if (!verifiedNFTSelection || !hookAddress) return;
          const currentHook = await getProjectDataHook(projectId, chainId);
          if (
            !currentHook ||
            currentHook.toLowerCase() !== hookAddress.toLowerCase()
          ) {
            throw new Error(
              "The project NFT hook changed. Review the payment again.",
            );
          }
          const fresh = assertSafeNftPaymentSelection({
            tiers: await fetchNFTTiers(hookAddress, chainId),
            tierIds,
            paymentToken: isUsdc ? "USDC" : "ETH",
            paymentAmount: projectAmount,
            paymentDecimals: isUsdc ? 6 : 18,
          });
          if (
            selectionFingerprint(fresh) !==
            selectionFingerprint(verifiedNFTSelection)
          ) {
            throw new Error(
              "The selected NFT price or availability changed. Review the payment again.",
            );
          }
        };
        const hookSpecificationsFingerprint = (
          preview: Awaited<ReturnType<typeof previewAndValidate>>,
        ) =>
          preview[3]
            .map((specification) =>
              [
                specification.hook.toLowerCase(),
                specification.noop,
                specification.amount.toString(),
                specification.metadata.toLowerCase(),
              ].join(":"),
            )
            .join("|");

        // This is the fresh, hook-aware quote shown in the confirmation screen.
        const reviewedPreview = await previewAndValidate(nftMetadata);
        await assertFreshNFTSelection();
        const reviewedOutcome = resolvePayPreviewOutcome({
          beneficiaryTokenCount: reviewedPreview[1],
          reservedTokenCount: reviewedPreview[2],
          hookSpecifications: reviewedPreview[3],
        });
        // A verified zero quote is a legitimate payment (zero-issuance project or
        // NFT-only purchase); only an unavailable preview blocks submission.
        // resolvePayPreviewOutcome already yields minReturnedTokens = 0 for a zero quote.
        const resolveFreshDirectSwap = async (
          outcome: typeof reviewedOutcome,
        ) => {
          if (
            !detail.directSwapRequested ||
            tierIds.length > 0 ||
            terminalType === "router"
          )
            return null;
          const quote = await quoteDirectBuy(
            chainId,
            BigInt(projectId),
            tokenAddress,
            projectAmount,
          );
          if (!quote) return null;
          const best = chooseBestPayRoute({
            pay: {
              beneficiaryTokenCount: outcome.beneficiaryTokenCount,
              reservedTokenCount: outcome.reservedTokenCount,
            },
            paySettlement: outcome.route === "amm" ? "swap" : "issuance",
            directSwapQuote: quote.out,
          });
          return best.kind === "direct-swap" ? { quote, best } : null;
        };
        const reviewedDirectSwap =
          await resolveFreshDirectSwap(reviewedOutcome);
        if (detail.directSwapRequested && !reviewedDirectSwap) {
          throw new Error(
            "The direct swap no longer beats paying. Review the updated quote.",
          );
        }
        const reviewedTokens = reviewedDirectSwap
          ? reviewedDirectSwap.best.beneficiaryTokenCount
          : reviewedOutcome.beneficiaryTokenCount;
        const reviewedMinimum = reviewedDirectSwap
          ? reviewedDirectSwap.best.beneficiaryTokenCount
          : reviewedOutcome.minReturnedTokens;
        const swapDeployment = reviewedDirectSwap
          ? uniswapV4Deployment(chainId)
          : null;
        if (reviewedDirectSwap && !swapDeployment?.universalRouter) {
          throw new Error(
            "The direct swap router is unavailable on this chain.",
          );
        }
        const reviewedSwapDeadline = BigInt(
          Math.floor(Date.now() / 1000) + 20 * 60,
        );
        const reviewedSwapRequest = reviewedDirectSwap
          ? buildUniswapV4ExactInputSwapTx({
              chainId: chainId as JBChainId,
              poolKey: reviewedDirectSwap.quote.poolKey,
              zeroForOne: reviewedDirectSwap.quote.zeroForOne,
              amountIn: projectAmount,
              minimumAmountOut: reviewedMinimum,
              recipient: beneficiary,
              deadline: reviewedSwapDeadline,
            })
          : null;

        await assertSufficientLiveBalances();

        let reviewedAllowance = 0n;
        if (isUsdc) {
          reviewedAllowance = await publicClient.readContract({
            address: usdcAddress!,
            abi: erc20Abi,
            functionName: "allowance",
            args: [
              currentAddress,
              reviewedDirectSwap ? swapDeployment!.permit2 : terminalAddress,
            ],
          });
        }
        const approvalRequired = isUsdc && reviewedAllowance < projectAmount;
        const permit2AllowanceAbi = [
          {
            type: "function",
            name: "allowance",
            stateMutability: "view",
            inputs: [
              { name: "owner", type: "address" },
              { name: "token", type: "address" },
              { name: "spender", type: "address" },
            ],
            outputs: [
              { name: "amount", type: "uint160" },
              { name: "expiration", type: "uint48" },
              { name: "nonce", type: "uint48" },
            ],
          },
        ] as const;
        const permit2Allowance =
          isUsdc && reviewedDirectSwap
            ? await publicClient.readContract({
                address: swapDeployment!.permit2,
                abi: permit2AllowanceAbi,
                functionName: "allowance",
                args: [
                  currentAddress,
                  usdcAddress!,
                  swapDeployment!.universalRouter!,
                ],
              })
            : null;
        const permit2ApprovalRequired = Boolean(
          permit2Allowance &&
          (permit2Allowance[0] < projectAmount ||
            Number(permit2Allowance[1]) <=
              Math.floor(Date.now() / 1000) + 1_800),
        );
        const approvalCallData = approvalRequired
          ? encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [
                reviewedDirectSwap ? swapDeployment!.permit2 : terminalAddress,
                projectAmount,
              ],
            })
          : null;
        const permit2ApprovalRequest = permit2ApprovalRequired
          ? buildPermit2ApproveTx({
              chainId: chainId as JBChainId,
              token: usdcAddress!,
              amount: projectAmount,
              expiration: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            })
          : null;
        const permit2ApprovalCallData = permit2ApprovalRequest
          ? encodeFunctionData({
              abi: permit2ApprovalRequest.abi,
              functionName: permit2ApprovalRequest.functionName,
              args: permit2ApprovalRequest.args,
            })
          : null;
        const reviewedPayCallData = buildPayCallData(
          chainId,
          terminalAddress,
          parseInt(projectId),
          tokenAddress,
          projectAmount,
          beneficiary,
          memo,
          nftMetadata,
          reviewedMinimum,
        );
        const reviewedCallData = reviewedSwapRequest
          ? encodeFunctionData({
              abi: reviewedSwapRequest.abi,
              functionName: reviewedSwapRequest.functionName,
              args: reviewedSwapRequest.args,
            })
          : reviewedPayCallData;
        const reviewedTarget = reviewedSwapRequest?.address ?? terminalAddress;
        const reviewedValue =
          reviewedSwapRequest?.value ?? (isUsdc ? 0n : projectAmount);
        const review: PaymentReview = {
          txId,
          account: currentAddress,
          chainId,
          chainName: chain.name,
          projectId,
          terminal: reviewedTarget,
          route: reviewedDirectSwap
            ? "direct pool swap"
            : terminalType === "router"
              ? "routed payment"
              : "direct terminal payment",
          outcomeRoute: reviewedDirectSwap ? "swap" : reviewedOutcome.route,
          tokenSymbol: isUsdc ? "USDC" : "ETH",
          tokenAddress,
          amount,
          amountRaw: projectAmount.toString(),
          valueRaw: reviewedValue.toString(),
          beneficiary,
          memo,
          rulesetId: reviewedPreview[0].id.toString(),
          expectedProjectTokens: reviewedTokens.toString(),
          minimumProjectTokens: reviewedMinimum.toString(),
          metadata: nftMetadata,
          callData: reviewedCallData,
          approval: approvalRequired
            ? {
                token: usdcAddress!,
                spender: reviewedDirectSwap
                  ? swapDeployment!.permit2
                  : terminalAddress,
                amount: projectAmount.toString(),
                callData: approvalCallData!,
              }
            : null,
          extraCalls:
            permit2ApprovalRequest && permit2ApprovalCallData
              ? [
                  {
                    to: permit2ApprovalRequest.address,
                    data: permit2ApprovalCallData,
                    value: "0",
                    label: "Authorize the Universal Router in Permit2",
                    contractName: "Permit2",
                    functionName: permit2ApprovalRequest.functionName,
                    args: permit2ApprovalRequest.args,
                  },
                ]
              : [],
          nfts:
            verifiedNFTSelection?.items.map((item) => {
              const reviewedLabel = detail.tierSelections
                ?.find(
                  (selection) =>
                    selection.tierId === item.tierId &&
                    selection.quantity === item.quantity,
                )
                ?.name.trim();
              return {
                tierId: item.tierId,
                name:
                  reviewedLabel && reviewedLabel.length <= 120
                    ? reviewedLabel
                    : item.name,
                quantity: item.quantity,
              };
            }) ?? [],
        };
        const approved = await requestPaymentReview(review);
        if (!approved) throw new Error("Payment review cancelled");

        const callKey = [
          currentAddress.toLowerCase(),
          chainId,
          reviewedTarget.toLowerCase(),
          reviewedValue.toString(),
          reviewedCallData.toLowerCase(),
          approvalCallData?.toLowerCase() ?? "",
          permit2ApprovalCallData?.toLowerCase() ?? "",
        ].join(":");
        const duplicate = useTransactionStore
          .getState()
          .transactions.find(
            (transaction) =>
              transaction.id !== txId &&
              transaction.callKey === callKey &&
              (transaction.status === "pending" ||
                transaction.status === "submitted" ||
                transaction.status === "safe-proposed"),
          );
        if (duplicate)
          throw new Error(
            "This exact payment is already pending. Wait for it to settle before trying again.",
          );
        updateTransaction(txId, {
          account: currentAddress,
          callKey,
          label: `Pay ${amount} ${isUsdc ? "USDC" : "ETH"} to project #${projectId}`,
        });

        await assertFreshPayConfiguration();
        await assertFreshNFTSelection();
        if (safeInfo) {
          const currentSafe = getActiveSafeInfo();
          if (
            !currentSafe ||
            currentSafe.chainId !== chainId ||
            currentSafe.safeAddress.toLowerCase() !==
              currentAddress.toLowerCase()
          ) {
            throw new Error(
              "The connected Safe changed. Review the payment again.",
            );
          }
        } else if (isManagedMode) {
          const auth = useAuthStore.getState();
          if (
            !auth.isAuthenticated() ||
            auth.mode !== "managed" ||
            !auth.token
          ) {
            throw new Error(
              "Managed wallet session changed. Review the payment again.",
            );
          }
        } else {
          client = await getWalletClient(wagmiConfig);
          if (
            !client?.account ||
            client.account.address.toLowerCase() !==
              currentAddress.toLowerCase()
          ) {
            throw new Error(
              "The connected wallet changed. Review the payment again.",
            );
          }

          // Switch to the correct chain if needed.
          const currentChainId = await client.getChainId();
          if (currentChainId !== chainId) {
            updateTransaction(txId, { stage: "switching" });
            await switchChainAsync({ chainId });
            client = await getWalletClient(wagmiConfig);
            if (!client)
              throw new Error("Lost wallet connection after chain switch");
          }
          if ((await client.getChainId()) !== chainId)
            throw new Error(`Wallet did not switch to chain ${chainId}`);
          if (
            !client.account ||
            client.account.address.toLowerCase() !==
              currentAddress.toLowerCase()
          ) {
            throw new Error(
              "The connected wallet changed. Review the payment again.",
            );
          }

          if (isUsdc) {
            await assertFreshPayConfiguration();
            const currentAllowance = await publicClient.readContract({
              address: usdcAddress!,
              abi: erc20Abi,
              functionName: "allowance",
              args: [
                currentAddress,
                reviewedDirectSwap ? swapDeployment!.permit2 : terminalAddress,
              ],
            });
            if (currentAllowance < projectAmount && !approvalRequired) {
              throw new Error(
                "The token allowance changed. Review the payment again.",
              );
            }
            if (currentAllowance < projectAmount) {
              updateTransaction(txId, { stage: "approving" });
              await submitTrackedTokenApproval({
                chainId,
                chain,
                account: currentAddress,
                token: usdcAddress!,
                spender: reviewedDirectSwap
                  ? swapDeployment!.permit2
                  : terminalAddress,
                amount: projectAmount,
                data: approvalCallData!,
                walletClient: client,
                publicClient,
              });
            }
            if (
              reviewedDirectSwap &&
              permit2ApprovalRequest &&
              permit2ApprovalCallData
            ) {
              const livePermit2Allowance = await publicClient.readContract({
                address: swapDeployment!.permit2,
                abi: permit2AllowanceAbi,
                functionName: "allowance",
                args: [
                  currentAddress,
                  usdcAddress!,
                  swapDeployment!.universalRouter!,
                ],
              });
              if (
                livePermit2Allowance[0] < projectAmount ||
                Number(livePermit2Allowance[1]) <=
                  Math.floor(Date.now() / 1000) + 1_800
              ) {
                updateTransaction(txId, { stage: "approving" });
                const permit2Hash = await client.sendTransaction({
                  to: permit2ApprovalRequest.address,
                  data: permit2ApprovalCallData,
                  value: 0n,
                  chain,
                  account: currentAddress,
                });
                const permit2Receipt =
                  await publicClient.waitForTransactionReceipt({
                    hash: permit2Hash,
                  });
                if (permit2Receipt.status !== "success") {
                  throw new Error("Permit2 approval reverted");
                }
              }
            }
          }
        }

        // Update to submitting stage
        updateTransaction(txId, { stage: "submitting" });
        await assertFreshNFTSelection();
        const preview = await previewAndValidate(nftMetadata);
        if (
          preview[0].id !== reviewedPreview[0].id ||
          preview[1] !== reviewedPreview[1] ||
          preview[2] !== reviewedPreview[2] ||
          hookSpecificationsFingerprint(preview) !==
            hookSpecificationsFingerprint(reviewedPreview)
        ) {
          throw new Error(
            "The payment quote changed. Review the payment again.",
          );
        }
        if (reviewedDirectSwap) {
          const currentOutcome = resolvePayPreviewOutcome({
            beneficiaryTokenCount: preview[1],
            reservedTokenCount: preview[2],
            hookSpecifications: preview[3],
          });
          const freshDirectSwap = await resolveFreshDirectSwap(currentOutcome);
          if (
            !freshDirectSwap ||
            freshDirectSwap.quote.poolId.toLowerCase() !==
              reviewedDirectSwap.quote.poolId.toLowerCase() ||
            freshDirectSwap.best.beneficiaryTokenCount < reviewedMinimum
          ) {
            throw new Error(
              "The direct swap quote changed. Review the payment again.",
            );
          }
        }
        const payCallData = buildPayCallData(
          chainId,
          terminalAddress,
          parseInt(projectId),
          tokenAddress,
          projectAmount,
          beneficiary,
          memo,
          nftMetadata,
          reviewedMinimum,
        );
        if (payCallData.toLowerCase() !== reviewedPayCallData.toLowerCase()) {
          throw new Error(
            "The payment calldata changed. Review the payment again.",
          );
        }
        if (!isManagedMode && !safeInfo) {
          client = await getWalletClient(wagmiConfig);
          if (
            !client?.account ||
            client.account.address.toLowerCase() !==
              currentAddress.toLowerCase() ||
            (await client.getChainId()) !== chainId
          ) {
            throw new Error(
              "Wallet account or network changed. Review the payment again.",
            );
          }
        }

        await assertSufficientLiveBalances();
        if (safeInfo && approvalRequired) {
          await publicClient.call({
            account: currentAddress,
            to: usdcAddress!,
            data: approvalCallData!,
            value: 0n,
          });
        } else if (
          safeInfo &&
          permit2ApprovalRequest &&
          permit2ApprovalCallData
        ) {
          await publicClient.call({
            account: currentAddress,
            to: permit2ApprovalRequest.address,
            data: permit2ApprovalCallData,
            value: 0n,
          });
        } else {
          await publicClient.call({
            account: currentAddress,
            to: reviewedTarget,
            data: reviewedCallData,
            value: reviewedValue,
          });
        }

        // Persist only after review and the final live preflight. Tracking
        // failures do not weaken the on-chain checks.
        try {
          const backendTx = await createTransactionRecord({
            chainId,
            fromAddress: currentAddress,
            toAddress: reviewedTarget,
            tokenAddress: isUsdc ? usdcAddress! : undefined,
            amount,
            projectId,
          });
          backendTxId = backendTx.id;
        } catch {
          // Non-fatal: transaction safety is enforced independently on chain.
        }

        let hash: Hex;
        if (safeInfo) {
          const txs: SafeTx[] = [];
          if (approvalRequired) {
            txs.push(
              encodeApprovalTx(
                usdcAddress!,
                reviewedDirectSwap ? swapDeployment!.permit2 : terminalAddress,
                projectAmount,
              ),
            );
          }
          if (permit2ApprovalRequest && permit2ApprovalCallData) {
            txs.push({
              to: permit2ApprovalRequest.address,
              data: permit2ApprovalCallData,
              value: "0x0",
            });
          }
          txs.push({
            to: reviewedTarget,
            data: reviewedCallData,
            value: `0x${reviewedValue.toString(16)}`,
          });
          const safeTxHash = await proposeSafeTransactions(txs);
          updateTransaction(txId, {
            safeTxHash,
            status: "safe-proposed",
            stage: undefined,
          });
          hash = await waitForSafeExecution(safeTxHash);
        } else if (isManagedMode) {
          hash = (await executeManagedTransaction(
            chainId,
            reviewedTarget,
            reviewedCallData,
            reviewedValue.toString(),
          )) as Hex;
        } else {
          hash = await client!.sendTransaction({
            to: reviewedTarget,
            data: reviewedCallData,
            value: reviewedValue,
            chain,
            account: currentAddress,
          });
        }

        // Update to submitted and start confirming stage
        updateTransaction(txId, {
          hash,
          status: "submitted",
          stage: "confirming",
        });

        // Update backend with hash
        if (backendTxId) {
          updateTransactionRecord(backendTxId, {
            status: "submitted",
            txHash: hash,
          }).catch(() => {});
        }

        // Wait for transaction receipt
        try {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash,
          });

          const receiptData: TransactionReceipt = {
            blockNumber: Number(receipt.blockNumber),
            blockHash: receipt.blockHash,
            gasUsed: receipt.gasUsed.toString(),
            effectiveGasPrice: receipt.effectiveGasPrice.toString(),
            status: receipt.status,
          };

          updateTransaction(txId, {
            status: receipt.status === "success" ? "confirmed" : "failed",
            stage: undefined,
            confirmedAt: Date.now(),
            receipt: receiptData,
            ...(receipt.status === "reverted" && {
              error: "Transaction reverted",
            }),
          });

          // Update backend with receipt
          if (backendTxId) {
            updateTransactionRecord(backendTxId, {
              status: receipt.status === "success" ? "confirmed" : "failed",
              receipt: receiptData,
              ...(receipt.status === "reverted" && {
                errorMessage: "Transaction reverted",
              }),
            }).catch(() => {});
          }
        } catch {
          // Transaction was submitted but we couldn't confirm it
          // Keep status as submitted so user can check explorer
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const isCancelled =
          errorMessage.includes("rejected") ||
          errorMessage.includes("denied") ||
          errorMessage.includes("cancelled") ||
          errorMessage.includes("User rejected") ||
          errorMessage.includes("user rejected");

        const status = isCancelled ? "cancelled" : "failed";
        const errorMsg = isCancelled
          ? "Transaction cancelled"
          : errorMessage.slice(0, 100);

        updateTransaction(txId, { status, error: errorMsg });

        // Update backend with error status
        if (backendTxId) {
          updateTransactionRecord(backendTxId, {
            status,
            errorMessage: errorMsg,
          }).catch(() => {});
        }
      }
    },
    [
      switchChainAsync,
      updateTransaction,
      buildPayCallData,
      authToken,
      detectingSafe,
      isManagedMode,
      managedAddress,
      safeInfo,
      executeAddToBalanceTransaction,
    ],
  );

  // Listen for pay events
  useEffect(() => {
    const handlePayEvent = (event: CustomEvent<PayEventDetail>) => {
      executePayTransaction(event.detail);
    };

    window.addEventListener(
      "juice:pay-project",
      handlePayEvent as EventListener,
    );

    return () => {
      window.removeEventListener(
        "juice:pay-project",
        handlePayEvent as EventListener,
      );
    };
  }, [executePayTransaction]);

  return {
    isConnected,
    address,
  };
}
