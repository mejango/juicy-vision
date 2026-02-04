/**
 * AI Billing Service - "Squeeze to Pay"
 *
 * When the AI runs out of juice, users can "give it a squeeze" by paying
 * to the $NANA revnet (project ID 1). Payments refill the chat's AI balance.
 *
 * Flow:
 * 1. User invokes AI in chat
 * 2. Check chat's aiBalance
 * 3. If insufficient: prompt "Bot ran out of juice, give it a squeeze?"
 * 4. User pays via JBMultiTerminal.pay() to NANA project
 * 5. Backend detects payment (via Bendystraw or webhook)
 * 6. Credit chat's AI balance
 * 7. Continue with AI invocation
 */

import { query, queryOne, execute, transaction } from '../db/index.ts';
import { createPublicClient, http, parseUnits, formatUnits, type Address } from 'viem';
import { mainnet, optimism, base, arbitrum } from 'viem/chains';

// ============================================================================
// Constants
// ============================================================================

// NANA Revnet - the project that receives AI payments
export const NANA_PROJECT_ID = 1;

// Supported chains for payment
export const SUPPORTED_CHAINS = {
  1: { name: 'Ethereum', chain: mainnet, rpc: 'https://eth.llamarpc.com' },
  10: { name: 'Optimism', chain: optimism, rpc: 'https://optimism.llamarpc.com' },
  8453: { name: 'Base', chain: base, rpc: 'https://base.llamarpc.com' },
  42161: { name: 'Arbitrum', chain: arbitrum, rpc: 'https://arbitrum.llamarpc.com' },
};

// JBMultiTerminal addresses per chain (v5)
export const MULTI_TERMINAL: Record<number, Address> = {
  1: '0x1F0a07a04D2a1f1Dd0aCF7C3532A6d0b42e18e67', // Mainnet
  10: '0x1F0a07a04D2a1f1Dd0aCF7C3532A6d0b42e18e67', // Optimism
  8453: '0x1F0a07a04D2a1f1Dd0aCF7C3532A6d0b42e18e67', // Base
  42161: '0x1F0a07a04D2a1f1Dd0aCF7C3532A6d0b42e18e67', // Arbitrum
};

// Native token address (constant across all chains)
export const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const;

// Pricing tiers (in ETH)
export const AI_PRICING = {
  costPerRequest: parseUnits('0.0001', 18), // 0.0001 ETH per AI request (~$0.25)
  minDeposit: parseUnits('0.001', 18), // Minimum 0.001 ETH (~$2.50)
  recommendedDeposit: parseUnits('0.01', 18), // Recommended 0.01 ETH (~$25)
  lowBalanceThreshold: parseUnits('0.0005', 18), // Warn when below 0.0005 ETH
};

// ============================================================================
// Types
// ============================================================================

export interface AiBalanceStatus {
  chatId: string;
  balanceWei: bigint;
  totalSpentWei: bigint;
  estimatedRequestsRemaining: number;
  isLow: boolean;
  isEmpty: boolean;
}

export interface SqueezePaymentData {
  chatId: string;
  chainId: number;
  terminalAddress: Address;
  projectId: number;
  token: Address;
  amountWei: bigint;
  memo: string;
  beneficiary: Address; // Who receives project tokens
}

export interface PaymentConfirmation {
  chatId: string;
  txHash: string;
  chainId: number;
  amountWei: bigint;
  payerAddress: string;
  projectId: number;
  tokensReceived?: bigint;
}

// ============================================================================
// Balance Checking
// ============================================================================

/**
 * Get AI balance status for a chat
 */
export async function getAiBalanceStatus(chatId: string): Promise<AiBalanceStatus | null> {
  const chat = await queryOne<{
    ai_balance_wei: string;
    ai_total_spent_wei: string;
  }>('SELECT ai_balance_wei, ai_total_spent_wei FROM multi_chats WHERE id = $1', [chatId]);

  if (!chat) return null;

  const balanceWei = BigInt(chat.ai_balance_wei);
  const totalSpentWei = BigInt(chat.ai_total_spent_wei);
  const costPerRequest = AI_PRICING.costPerRequest;

  return {
    chatId,
    balanceWei,
    totalSpentWei,
    estimatedRequestsRemaining: costPerRequest > 0n
      ? Number(balanceWei / costPerRequest)
      : 0,
    isLow: balanceWei <= AI_PRICING.lowBalanceThreshold,
    isEmpty: balanceWei < costPerRequest,
  };
}

/**
 * Check if chat has enough balance for an AI request
 *
 * NOTE: Currently free - squeeze-to-pay disabled for beta
 */
export async function canInvokeAi(chatId: string): Promise<{
  allowed: boolean;
  reason?: string;
  balance?: AiBalanceStatus;
}> {
  // Beta: AI is free for now
  const FREE_MODE = true;

  if (FREE_MODE) {
    return { allowed: true };
  }

  const balance = await getAiBalanceStatus(chatId);
  if (!balance) {
    return { allowed: false, reason: 'Chat not found' };
  }

  if (balance.isEmpty) {
    return {
      allowed: false,
      reason: 'Bot ran out of juice! Give it a squeeze to continue.',
      balance,
    };
  }

  return { allowed: true, balance };
}

// ============================================================================
// Payment Generation
// ============================================================================

/**
 * Generate payment data for "squeezing" the bot
 */
export function generateSqueezePayment(
  chatId: string,
  chainId: number,
  amountWei: bigint,
  beneficiaryAddress: Address
): SqueezePaymentData {
  const terminal = MULTI_TERMINAL[chainId];
  if (!terminal) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  return {
    chatId,
    chainId,
    terminalAddress: terminal,
    projectId: NANA_PROJECT_ID,
    token: NATIVE_TOKEN,
    amountWei,
    memo: `Juicy Vision AI - Chat ${chatId}`,
    beneficiary: beneficiaryAddress,
  };
}

/**
 * Generate calldata for JBMultiTerminal.pay()
 */
export function encodePayCalldata(payment: SqueezePaymentData): {
  to: Address;
  value: bigint;
  data: `0x${string}`;
} {
  // JBMultiTerminal.pay(projectId, token, amount, beneficiary, minReturnedTokens, memo, metadata)
  const MULTI_TERMINAL_ABI = [{
    name: 'pay',
    type: 'function',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'beneficiary', type: 'address' },
      { name: 'minReturnedTokens', type: 'uint256' },
      { name: 'memo', type: 'string' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'payable',
  }] as const;

  // Simple ABI encoding for pay function
  const selector = '0x5bb24f77'; // pay() selector

  // Encode parameters (simplified - in production use viem's encodeFunctionData)
  const projectIdHex = payment.projectId.toString(16).padStart(64, '0');
  const tokenHex = payment.token.slice(2).padStart(64, '0');
  const amountHex = payment.amountWei.toString(16).padStart(64, '0');
  const beneficiaryHex = payment.beneficiary.slice(2).padStart(64, '0');
  const minTokensHex = '0'.padStart(64, '0'); // 0 min tokens
  const memoOffset = (7 * 32).toString(16).padStart(64, '0'); // Offset to memo
  const metadataOffset = (9 * 32).toString(16).padStart(64, '0'); // Offset to metadata

  // Encode memo string
  const memoBytes = new TextEncoder().encode(payment.memo);
  const memoLength = memoBytes.length.toString(16).padStart(64, '0');
  const memoPadded = Array.from(memoBytes).map(b => b.toString(16).padStart(2, '0')).join('').padEnd(Math.ceil(memoBytes.length / 32) * 64, '0');

  // Empty metadata
  const metadataLength = '0'.padStart(64, '0');

  const data = `${selector}${projectIdHex}${tokenHex}${amountHex}${beneficiaryHex}${minTokensHex}${memoOffset}${metadataOffset}${memoLength}${memoPadded}${metadataLength}` as `0x${string}`;

  return {
    to: payment.terminalAddress,
    value: payment.amountWei,
    data,
  };
}

// ============================================================================
// Payment Confirmation
// ============================================================================

/**
 * Confirm a payment and credit the chat's AI balance
 */
export async function confirmPayment(confirmation: PaymentConfirmation): Promise<void> {
  await transaction(async (client) => {
    // Check if payment already processed
    const existing = await client.queryObject<{ id: string }>`
      SELECT id FROM ai_billing WHERE tx_hash = ${confirmation.txHash}
    `;
    if (existing.rows.length > 0) {
      console.log(`Payment ${confirmation.txHash} already processed`);
      return;
    }

    // Credit the balance
    await client.queryObject`
      UPDATE multi_chats
      SET ai_balance_wei = (ai_balance_wei::numeric + ${confirmation.amountWei.toString()})::text
      WHERE id = ${confirmation.chatId}
    `;

    // Record the deposit
    await client.queryObject`
      INSERT INTO ai_billing (
        chat_id, type, amount_wei, payer_address, tx_hash, project_id, chain_id
      ) VALUES (
        ${confirmation.chatId}, 'deposit', ${confirmation.amountWei.toString()},
        ${confirmation.payerAddress}, ${confirmation.txHash},
        ${confirmation.projectId}, ${confirmation.chainId}
      )
    `;

    console.log(`[AI Billing] Credited ${formatUnits(confirmation.amountWei, 18)} ETH to chat ${confirmation.chatId}`);
  });
}

/**
 * Deduct cost for an AI request
 *
 * NOTE: Currently free - no deductions in beta
 */
export async function deductAiCost(
  chatId: string,
  messageId: string,
  model: string,
  tokensUsed: number
): Promise<{ success: boolean; newBalance: bigint }> {
  // Beta: AI is free, skip deductions
  const FREE_MODE = true;
  if (FREE_MODE) {
    return { success: true, newBalance: 0n };
  }

  const cost = AI_PRICING.costPerRequest;

  // Check balance first
  const balance = await getAiBalanceStatus(chatId);
  if (!balance || balance.isEmpty) {
    return { success: false, newBalance: 0n };
  }

  await transaction(async (client) => {
    // Deduct from balance
    await client.queryObject`
      UPDATE multi_chats
      SET ai_balance_wei = (ai_balance_wei::numeric - ${cost.toString()})::text,
          ai_total_spent_wei = (ai_total_spent_wei::numeric + ${cost.toString()})::text
      WHERE id = ${chatId}
    `;

    // Record usage
    await client.queryObject`
      INSERT INTO ai_billing (chat_id, type, amount_wei, message_id, model, tokens_used)
      VALUES (${chatId}, 'usage', ${cost.toString()}, ${messageId}, ${model}, ${tokensUsed})
    `;
  });

  const newBalance = await getAiBalanceStatus(chatId);
  return { success: true, newBalance: newBalance?.balanceWei ?? 0n };
}

// ============================================================================
// Usage History
// ============================================================================

export interface BillingRecord {
  id: string;
  type: 'deposit' | 'usage' | 'refund';
  amountWei: bigint;
  payerAddress?: string;
  txHash?: string;
  messageId?: string;
  model?: string;
  tokensUsed?: number;
  createdAt: Date;
}

/**
 * Get billing history for a chat
 */
export async function getBillingHistory(
  chatId: string,
  limit = 50
): Promise<BillingRecord[]> {
  const records = await query<{
    id: string;
    type: 'deposit' | 'usage' | 'refund';
    amount_wei: string;
    payer_address: string | null;
    tx_hash: string | null;
    message_id: string | null;
    model: string | null;
    tokens_used: number | null;
    created_at: Date;
  }>(
    `SELECT * FROM ai_billing WHERE chat_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [chatId, limit]
  );

  return records.map((r) => ({
    id: r.id,
    type: r.type,
    amountWei: BigInt(r.amount_wei),
    payerAddress: r.payer_address ?? undefined,
    txHash: r.tx_hash ?? undefined,
    messageId: r.message_id ?? undefined,
    model: r.model ?? undefined,
    tokensUsed: r.tokens_used ?? undefined,
    createdAt: r.created_at,
  }));
}

// ============================================================================
// Prompts & Messages
// ============================================================================

/**
 * Generate the "squeeze" prompt message
 */
export function getSqueezePromptMessage(balance: AiBalanceStatus): string {
  if (balance.isEmpty) {
    return `🍊 **Bot ran out of juice!**

The AI assistant needs more juice to continue helping you. Give it a squeeze by making a small payment to the $NANA revnet.

**Recommended amount:** ${formatUnits(AI_PRICING.recommendedDeposit, 18)} ETH (~$25)
**Minimum:** ${formatUnits(AI_PRICING.minDeposit, 18)} ETH

This will enable approximately ${Number(AI_PRICING.recommendedDeposit / AI_PRICING.costPerRequest)} AI requests.`;
  }

  if (balance.isLow) {
    return `🍊 **Running low on juice!**

Only ${balance.estimatedRequestsRemaining} AI requests remaining. Consider topping up to avoid interruption.

**Balance:** ${formatUnits(balance.balanceWei, 18)} ETH`;
  }

  return '';
}

/**
 * Generate low balance warning (to show periodically)
 */
export function shouldShowLowBalanceWarning(
  balance: AiBalanceStatus,
  lastWarningTime?: Date
): boolean {
  if (!balance.isLow) return false;

  // Don't show warning more than once per hour
  if (lastWarningTime) {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (lastWarningTime > hourAgo) return false;
  }

  return true;
}
