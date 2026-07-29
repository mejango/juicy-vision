import { useEffect, useRef, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { jbMultiTerminalAbi } from "@bananapus/nana-sdk-core";
import { useThemeStore } from "../../stores";
import DialogShell from "../ui/DialogShell";
import ChainLogo from "../ui/ChainLogo";
import {
  PAYMENT_REVIEW_EVENT,
  type PaymentReview,
  type PaymentReviewRequest,
} from "../../utils/paymentReview";
import {
  buildTransactionAuditPrompt,
  transactionReviewJson,
  type TransactionReview,
} from "../../utils/transactionReview";
import { buildTxLinkEntries } from "../../utils/txlink";
import { useSafeApp } from "../../hooks/useSafeApp";
import TechnicalDetails from "../shared/TechnicalDetails";
import CopyTxButton from "./CopyTxButton";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function exactPaymentReview(
  review: PaymentReview,
  safeAddress?: `0x${string}`,
): TransactionReview {
  const calls: TransactionReview["calls"][number][] = [];
  if (review.approval) {
    calls.push({
      chainId: review.chainId,
      from: review.account,
      to: review.approval.token,
      value: 0n,
      data: review.approval.callData,
      abi: erc20Abi,
      functionName: "approve",
      args: [review.approval.spender, BigInt(review.approval.amount)],
      label: `Approve exactly ${review.approval.amount} raw token units`,
      contractName: "ERC-20 token",
    });
  }
  for (const call of review.extraCalls ?? []) {
    calls.push({
      chainId: review.chainId,
      from: review.account,
      to: call.to,
      value: BigInt(call.value),
      data: call.data,
      functionName: call.functionName,
      args: call.args,
      label: call.label,
      contractName: call.contractName,
    });
  }
  calls.push({
    chainId: review.chainId,
    from: review.account,
    to: review.terminal,
    value: BigInt(review.valueRaw),
    data: review.callData,
    abi: review.route === "direct pool swap" ? undefined : jbMultiTerminalAbi,
    functionName:
      review.route === "direct pool swap"
        ? "execute"
        : review.action === "addToBalance"
          ? "addToBalanceOf"
          : "pay",
    label:
      review.route === "direct pool swap"
        ? "Swap for project tokens"
        : review.action === "addToBalance"
          ? "Add funds to the project balance"
          : "Pay the project",
    contractName:
      review.route === "direct pool swap"
        ? "Uniswap Universal Router"
        : review.route === "routed payment"
          ? "JBRouterTerminal"
          : "JBMultiTerminal",
  });
  return {
    calls,
    kind: safeAddress ? "authorization" : "transaction",
    title:
      review.action === "addToBalance"
        ? "Review balance contribution"
        : "Review payment",
    ...(safeAddress && {
      authorization: {
        type: "Safe transaction proposal",
        safeAddress,
        chainId: review.chainId,
        calls: calls.map((call) => ({
          to: call.to,
          value: `0x${(call.value ?? 0n).toString(16)}`,
          data: call.data,
        })),
      },
    }),
  };
}

export default function PaymentReviewModal() {
  const { theme } = useThemeStore();
  const { safeInfo } = useSafeApp();
  const isDark = theme === "dark";
  const [request, setRequest] = useState<PaymentReviewRequest | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const activeRequest = useRef<PaymentReviewRequest | null>(null);

  useEffect(() => {
    const handleReview = (event: Event) => {
      const next = (event as CustomEvent<PaymentReviewRequest>).detail;
      if (activeRequest.current) {
        next.respond(false);
        return;
      }
      activeRequest.current = next;
      setAgreed(false);
      setCopyState("idle");
      setRequest(next);
    };
    window.addEventListener(PAYMENT_REVIEW_EVENT, handleReview);
    return () => {
      window.removeEventListener(PAYMENT_REVIEW_EVENT, handleReview);
      activeRequest.current?.respond(false);
      activeRequest.current = null;
    };
  }, []);

  const respond = (approved: boolean) => {
    const current = activeRequest.current;
    activeRequest.current = null;
    setRequest(null);
    setAgreed(false);
    current?.respond(approved);
  };

  if (!request) return null;
  const review = request.review;
  const addsToBalance = review.action === "addToBalance";
  const expectedTokens = formatUnits(BigInt(review.expectedProjectTokens), 18);
  const minimumTokens = formatUnits(BigInt(review.minimumProjectTokens), 18);
  const exactReview = exactPaymentReview(review, safeInfo?.safeAddress);

  return (
    <DialogShell
      isOpen
      onClose={() => respond(false)}
      labelledBy="payment-review-title"
      contentClassName={`relative flex max-h-[90vh] w-full max-w-lg flex-col border ${
        isDark
          ? "border-white/15 bg-juice-dark text-white"
          : "border-gray-200 bg-white text-gray-900"
      }`}
    >
        <div
          className={`border-b px-5 py-4 ${isDark ? "border-white/10" : "border-gray-100"}`}
        >
          <h2 id="payment-review-title" className="text-base font-semibold">
            {addsToBalance ? "Review balance contribution" : "Review payment"}
          </h2>
          <p
            className={`mt-1 text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            Project #{review.projectId} ·{" "}
            <span className="inline-flex items-center gap-1.5 align-middle">
              <ChainLogo chainId={review.chainId} size={14} />
              {review.chainName}
            </span>
          </p>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div
            className={`border p-3 ${isDark ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50"}`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className={isDark ? "text-gray-400" : "text-gray-600"}>
                Amount
              </span>
              <span className="font-mono font-semibold">
                {review.amount} {review.tokenSymbol}
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
              <span className={isDark ? "text-gray-400" : "text-gray-600"}>
                Route
              </span>
              <span>
                {review.route}
                {review.outcomeRoute ? ` · ${review.outcomeRoute}` : ""}
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
              <span className={isDark ? "text-gray-400" : "text-gray-600"}>
                Account
              </span>
              <span className="font-mono">{shortAddress(review.account)}</span>
            </div>
            {!addsToBalance && (
              <>
                <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
                  <span className={isDark ? "text-gray-400" : "text-gray-600"}>
                    Beneficiary
                  </span>
                  <span className="font-mono">
                    {shortAddress(review.beneficiary)}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
                  <span className={isDark ? "text-gray-400" : "text-gray-600"}>
                    Quoted project tokens
                  </span>
                  <span className="font-mono">{expectedTokens}</span>
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
                  <span className={isDark ? "text-gray-400" : "text-gray-600"}>
                    Minimum received
                  </span>
                  <span className="font-mono">{minimumTokens}</span>
                </div>
              </>
            )}
            {addsToBalance && (
              <p
                className={`mt-3 text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}
              >
                Adds funds to the project treasury without issuing project
                tokens.
              </p>
            )}
          </div>

          {review.nfts.length > 0 && (
            <div
              className={`border p-3 ${isDark ? "border-cyan-500/30 bg-cyan-500/5" : "border-cyan-200 bg-cyan-50"}`}
            >
              <div
                className={`mb-2 text-xs font-medium ${isDark ? "text-cyan-300" : "text-cyan-800"}`}
              >
                NFTs
              </div>
              {review.nfts.map((nft) => (
                <div
                  key={nft.tierId}
                  className="flex justify-between gap-3 text-sm"
                >
                  <span>{nft.name}</span>
                  <span className="font-mono">×{nft.quantity}</span>
                </div>
              ))}
            </div>
          )}

          {review.approval && (
            <div
              className={`border p-3 ${isDark ? "border-amber-500/30 bg-amber-500/5" : "border-amber-200 bg-amber-50"}`}
            >
              <div
                className={`text-xs font-medium ${isDark ? "text-amber-300" : "text-amber-800"}`}
              >
                Token approval required
              </div>
              <div className="mt-2 text-xs font-mono break-all">
                approve({review.approval.spender}, {review.approval.amount})
              </div>
              <div
                className={`mt-1 text-[10px] ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                Exact amount only · token {shortAddress(review.approval.token)}
              </div>
            </div>
          )}

          <TechnicalDetails
            contract={
              review.route === "direct pool swap"
                ? "UNISWAP_UNIVERSAL_ROUTER"
                : review.route === "routed payment"
                  ? "JB_ROUTER_TERMINAL"
                  : "JB_MULTI_TERMINAL"
            }
            contractAddress={review.terminal}
            functionName={
              review.route === "direct pool swap"
                ? "execute"
                : addsToBalance
                  ? "addToBalanceOf"
                  : "pay"
            }
            chainId={review.chainId}
            chainName={review.chainName}
            projectId={review.projectId}
            parameters={{
              token: review.tokenAddress,
              amount: review.amountRaw,
              ...(addsToBalance
                ? { shouldReturnHeldFees: false }
                : {
                    beneficiary: review.beneficiary,
                    minReturnedTokens: review.minimumProjectTokens,
                  }),
              memo: review.memo,
              metadata: review.metadata,
              value: review.valueRaw,
              calldata: review.callData,
              approvalCalldata: review.approval?.callData || "none",
              additionalCalls:
                review.extraCalls?.map((call) => ({
                  to: call.to,
                  value: call.value,
                  calldata: call.data,
                })) ?? [],
              rulesetId: review.rulesetId,
            }}
            isDark={isDark}
            defaultExpanded
          />

          <details
            className={`border ${isDark ? "border-white/15 bg-black/20" : "border-gray-200 bg-gray-50"}`}
          >
            <summary className="cursor-pointer px-4 py-3 text-xs font-semibold">
              Raw transaction payload
            </summary>
            <pre
              className={`max-h-80 overflow-auto border-t p-4 text-[11px] leading-relaxed ${
                isDark
                  ? "border-white/10 bg-black/40 text-gray-200"
                  : "border-gray-200 bg-gray-950 text-gray-100"
              }`}
            >
              {transactionReviewJson(exactReview)}
            </pre>
          </details>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className={`border px-4 py-2 text-xs font-semibold ${
                isDark
                  ? "border-juice-cyan/50 text-juice-cyan"
                  : "border-teal-600 text-teal-700"
              }`}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    buildTransactionAuditPrompt(exactReview),
                  );
                  setCopyState("copied");
                } catch {
                  setCopyState("failed");
                }
                window.setTimeout(() => setCopyState("idle"), 2200);
              }}
            >
              {copyState === "copied"
                ? "Prompt copied — paste into your LLM"
                : copyState === "failed"
                  ? "Could not copy prompt"
                  : "[copy tx audit prompt]"}
            </button>
            <CopyTxButton
              isDark={isDark}
              getEntries={() =>
                buildTxLinkEntries({
                  chainId: review.chainId,
                  to: review.terminal,
                  data: review.callData,
                  value: review.valueRaw,
                  approval: review.approval
                    ? {
                        token: review.approval.token,
                        data: review.approval.callData,
                      }
                    : null,
                })
              }
            />
          </div>
        </div>

        <div
          className={`border-t px-5 py-4 ${isDark ? "border-white/10" : "border-gray-100"}`}
        >
          <label
            className={`mb-4 flex items-start gap-3 border p-3 text-xs leading-relaxed ${
              isDark
                ? "border-white/15 bg-white/5"
                : "border-gray-200 bg-gray-50"
            }`}
          >
            <input
              className="mt-0.5"
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
            />
            <span>
              I reviewed the chain, destination, amount, beneficiary, calldata,
              and any token approval. I agree to this exact payload.
            </span>
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => respond(false)}
              className={`flex-1 border-2 py-3 font-medium ${
                isDark
                  ? "border-white/20 text-white hover:bg-white/10"
                  : "border-gray-200 text-gray-700 hover:bg-gray-50"
              }`}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!agreed}
              onClick={() => respond(true)}
              className="flex-1 bg-green-500 py-3 font-bold text-black hover:bg-green-500/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {safeInfo ? "Propose to Safe" : "Continue to wallet"}
            </button>
          </div>
        </div>
    </DialogShell>
  );
}
