import type { Address, Hex } from "viem";
import { useViewAsStore, VIEW_AS_WRITE_REFUSAL } from "../stores/viewAsStore";

export const PAYMENT_REVIEW_EVENT = "juice:payment-review-request";

export interface PaymentReview {
  action?: "pay" | "addToBalance";
  txId: string;
  account: Address;
  chainId: number;
  chainName: string;
  projectId: string;
  terminal: Address;
  route: "direct terminal payment" | "routed payment" | "direct pool swap";
  outcomeRoute?: "issuance" | "amm" | "swap";
  tokenSymbol: "ETH" | "USDC";
  tokenAddress: Address;
  amount: string;
  amountRaw: string;
  valueRaw: string;
  beneficiary: Address;
  memo: string;
  rulesetId: string;
  expectedProjectTokens: string;
  minimumProjectTokens: string;
  metadata: Hex;
  callData: Hex;
  approval: {
    token: Address;
    spender: Address;
    amount: string;
    callData: Hex;
  } | null;
  /** Additional exact calls executed between the ERC-20 approval and main call. */
  extraCalls?: Array<{
    to: Address;
    data: Hex;
    value: string;
    label: string;
    contractName: string;
    functionName?: string;
    args?: readonly unknown[];
  }>;
  nfts: Array<{ tierId: number; name: string; quantity: number }>;
}

export interface PaymentReviewRequest {
  review: PaymentReview;
  respond: (approved: boolean) => void;
}

export function requestPaymentReview(review: PaymentReview): Promise<boolean> {
  // View-as mode is read-only: payments funnel through this review seam, so
  // refusing here blocks transacting while impersonating an account.
  if (useViewAsStore.getState().viewAs) {
    return Promise.reject(new Error(VIEW_AS_WRITE_REFUSAL));
  }
  return new Promise((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(() => respond(false), 5 * 60 * 1000);
    const respond = (approved: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(approved);
    };
    window.dispatchEvent(
      new CustomEvent<PaymentReviewRequest>(PAYMENT_REVIEW_EVENT, {
        detail: { review, respond },
      }),
    );
  });
}
