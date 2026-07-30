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

import { query, queryOne, transaction } from '../db/index.ts';
import {
  type Address,
  decodeFunctionData,
  encodeFunctionData,
  formatUnits,
  isAddressEqual,
  parseUnits,
} from 'viem';
import { arbitrum, base, mainnet, optimism } from '../constants/chains.ts';
import { NATIVE_TOKEN as SHARED_NATIVE_TOKEN } from '@shared/chains.ts';
import { resolvePayPreviewOutcome, TERMINAL_PREVIEW_PAY_ABI } from '@shared/terminalPreview.ts';
import { getConfig } from '../utils/config.ts';
import { type ClaudeModel, MODEL_COSTS } from './claude.ts';
import { fetchPrimaryTerminal, getPublicClient } from './chainReader.ts';
import { getEthUsdRate } from './juice.ts';
import {
  requireRecognizedProjectPayConfiguration,
  requireRecognizedRuntimeHook,
} from './projectTrust.ts';
import { verifyProtectedPaymentReceipt } from './paymentReceipt.ts';

// ============================================================================
// Constants
// ============================================================================

// Supported chains for payment
export const SUPPORTED_CHAINS = {
  1: { name: 'Ethereum', chain: mainnet, rpc: 'https://eth.llamarpc.com' },
  10: { name: 'Optimism', chain: optimism, rpc: 'https://optimism.llamarpc.com' },
  8453: { name: 'Base', chain: base, rpc: 'https://base.llamarpc.com' },
  42161: { name: 'Arbitrum', chain: arbitrum, rpc: 'https://arbitrum.llamarpc.com' },
};

// Native token address (constant across all chains)
export const NATIVE_TOKEN = SHARED_NATIVE_TOKEN;
const PAY_ABI = [{
  name: 'pay',
  type: 'function',
  stateMutability: 'payable',
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
}] as const;

// Pricing tiers (in ETH)
export const AI_PRICING = {
  costPerRequest: parseUnits('0.0001', 18), // 0.0001 ETH per AI request (~$0.25)
  minDeposit: parseUnits('0.001', 18), // Minimum 0.001 ETH (~$2.50)
  recommendedDeposit: parseUnits('0.01', 18), // Recommended 0.01 ETH (~$25)
  maxDeposit: parseUnits('0.1', 18), // Billing top-up guardrail, not a contribution flow
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
    estimatedRequestsRemaining: costPerRequest > 0n ? Number(balanceWei / costPerRequest) : 0,
    isLow: balanceWei <= AI_PRICING.lowBalanceThreshold,
    isEmpty: balanceWei < costPerRequest,
  };
}

/**
 * Check if chat has enough balance for an AI request
 *
 * Controlled by AI_FREE_MODE env var (default: true for beta)
 */
export async function canInvokeAi(chatId: string): Promise<{
  allowed: boolean;
  reason?: string;
  balance?: AiBalanceStatus;
}> {
  const config = getConfig();

  // Beta: AI is free by default
  if (config.aiFreeMode) {
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
export async function generateSqueezePayment(
  chatId: string,
  chainId: number,
  amountWei: bigint,
  beneficiaryAddress: Address,
): Promise<SqueezePaymentData> {
  if (!SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS]) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }
  const projectId = getConfig().aiBillingProjectId;
  if (projectId <= 0) throw new Error('Paid AI billing is not configured');
  if (amountWei < AI_PRICING.minDeposit || amountWei > AI_PRICING.maxDeposit) {
    throw new Error('AI top-up amount is outside the supported billing range');
  }
  const terminal = await fetchPrimaryTerminal(chainId, projectId, NATIVE_TOKEN);

  return {
    chatId,
    chainId,
    terminalAddress: terminal,
    projectId,
    token: NATIVE_TOKEN,
    amountWei,
    memo: `Juicy Vision AI - Chat ${chatId}`,
    beneficiary: beneficiaryAddress,
  };
}

/**
 * Generate calldata for JBMultiTerminal.pay()
 */
export async function encodePayCalldata(payment: SqueezePaymentData): Promise<{
  to: Address;
  value: bigint;
  data: `0x${string}`;
}> {
  const client = getPublicClient(payment.chainId);
  const discoveredTerminal = await fetchPrimaryTerminal(
    payment.chainId,
    payment.projectId,
    payment.token,
  );
  if (!isAddressEqual(discoveredTerminal, payment.terminalAddress)) {
    throw new Error('Project payment terminal changed');
  }
  await requireRecognizedProjectPayConfiguration({
    client,
    projectId: BigInt(payment.projectId),
  });
  const preview = await client.readContract({
    account: payment.beneficiary,
    address: discoveredTerminal,
    abi: TERMINAL_PREVIEW_PAY_ABI,
    functionName: 'previewPayFor',
    args: [
      BigInt(payment.projectId),
      payment.token,
      payment.amountWei,
      payment.beneficiary,
      '0x',
    ],
  });
  for (const specification of preview[3]) {
    if (!specification.noop) {
      await requireRecognizedRuntimeHook({
        client,
        projectId: BigInt(payment.projectId),
        rulesetId: preview[0].id,
        hook: specification.hook,
      });
    }
  }
  const previewOutcome = resolvePayPreviewOutcome({
    beneficiaryTokenCount: preview[1],
    reservedTokenCount: preview[2],
    hookSpecifications: preview[3],
  });
  if (previewOutcome.beneficiaryTokenCount <= 0n) {
    throw new Error('The payment quote returns no project tokens');
  }
  const minReturnedTokens = previewOutcome.minReturnedTokens;
  const data = encodeFunctionData({
    abi: PAY_ABI,
    functionName: 'pay',
    args: [
      BigInt(payment.projectId),
      payment.token,
      payment.amountWei,
      payment.beneficiary,
      minReturnedTokens,
      payment.memo,
      '0x',
    ],
  });
  await client.call({
    account: payment.beneficiary,
    to: discoveredTerminal,
    data,
    value: payment.amountWei,
  });

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
  const configuredProjectId = getConfig().aiBillingProjectId;
  if (configuredProjectId <= 0) throw new Error('Paid AI billing is not configured');
  if (confirmation.projectId !== configuredProjectId) {
    throw new Error('Payment project does not match AI billing');
  }
  if (!SUPPORTED_CHAINS[confirmation.chainId as keyof typeof SUPPORTED_CHAINS]) {
    throw new Error('Unsupported payment chain');
  }

  const chainClient = getPublicClient(confirmation.chainId);
  const terminal = await fetchPrimaryTerminal(
    confirmation.chainId,
    configuredProjectId,
    NATIVE_TOKEN,
  );
  const [chainTransaction, receipt] = await Promise.all([
    chainClient.getTransaction({ hash: confirmation.txHash as `0x${string}` }),
    chainClient.getTransactionReceipt({ hash: confirmation.txHash as `0x${string}` }),
  ]);
  if (receipt.status !== 'success') throw new Error('Payment transaction reverted');
  if (!chainTransaction.to || !isAddressEqual(chainTransaction.to, terminal)) {
    throw new Error('Payment was not sent to this project terminal');
  }
  if (!isAddressEqual(chainTransaction.from, confirmation.payerAddress as Address)) {
    throw new Error('Payment sender does not match this wallet');
  }
  const decoded = decodeFunctionData({ abi: PAY_ABI, data: chainTransaction.input });
  if (decoded.functionName !== 'pay') throw new Error('Transaction is not a project payment');
  const [projectId, token, amount, beneficiary, minReturnedTokens, memo, metadata] = decoded.args;
  if (projectId !== BigInt(configuredProjectId) || !isAddressEqual(token, NATIVE_TOKEN)) {
    throw new Error('Payment project or token does not match AI billing');
  }
  if (
    amount !== confirmation.amountWei ||
    chainTransaction.value !== amount ||
    !isAddressEqual(beneficiary, confirmation.payerAddress as Address)
  ) {
    throw new Error('Payment amount or beneficiary does not match the quote');
  }
  if (minReturnedTokens <= 0n) throw new Error('Payment has no minimum project-token return');
  if (memo !== `Juicy Vision AI - Chat ${confirmation.chatId}` || metadata !== '0x') {
    throw new Error('Payment does not match this AI billing request');
  }

  verifyProtectedPaymentReceipt({
    logs: receipt.logs,
    entrypoint: terminal,
    projectId: BigInt(configuredProjectId),
    payer: confirmation.payerAddress as Address,
    beneficiary: confirmation.payerAddress as Address,
    amount: confirmation.amountWei,
    memo,
    metadata,
    minimum: minReturnedTokens,
  });

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

    console.log(
      `[AI Billing] Credited ${
        formatUnits(confirmation.amountWei, 18)
      } ETH to chat ${confirmation.chatId}`,
    );
  });
}

/**
 * Calculate the cost in wei for an AI request based on model and token usage
 */
export function calculateTokenCost(
  model: ClaudeModel,
  inputTokens: number,
  outputTokens: number,
  ethUsdRate: number,
): bigint {
  const costs = MODEL_COSTS[model];
  if (!costs) {
    throw new Error(`AI model pricing is not configured: ${model}`);
  }

  // Calculate cost in USD (costs are per 1M tokens)
  const inputCostUsd = (inputTokens / 1_000_000) * costs.inputPer1M;
  const outputCostUsd = (outputTokens / 1_000_000) * costs.outputPer1M;
  const totalCostUsd = inputCostUsd + outputCostUsd;

  if (!Number.isFinite(ethUsdRate) || ethUsdRate <= 0) {
    throw new Error('ETH/USD rate unavailable');
  }
  const ethPerUsd = 1 / ethUsdRate;
  const costEth = totalCostUsd * ethPerUsd;

  // Convert to wei
  return parseUnits(costEth.toFixed(18), 18);
}

/**
 * Deduct cost for an AI request
 *
 * Controlled by AI_FREE_MODE env var (default: true for beta)
 */
export async function deductAiCost(
  chatId: string,
  messageId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<{ success: boolean; newBalance: bigint; costWei: bigint }> {
  const config = getConfig();

  // Beta: AI is free by default
  if (config.aiFreeMode) {
    return { success: true, newBalance: 0n, costWei: 0n };
  }

  // Calculate actual cost based on model and tokens
  const ethUsdRate = await getEthUsdRate();
  const cost = calculateTokenCost(
    model as ClaudeModel,
    inputTokens,
    outputTokens,
    ethUsdRate,
  );

  // Check balance first
  const balance = await getAiBalanceStatus(chatId);
  if (!balance || balance.balanceWei < cost) {
    return { success: false, newBalance: balance?.balanceWei ?? 0n, costWei: cost };
  }

  await transaction(async (client) => {
    // Deduct from balance
    await client.queryObject`
      UPDATE multi_chats
      SET ai_balance_wei = (ai_balance_wei::numeric - ${cost.toString()})::text,
          ai_total_spent_wei = (ai_total_spent_wei::numeric + ${cost.toString()})::text
      WHERE id = ${chatId}
    `;

    // Record usage with token details
    await client.queryObject`
      INSERT INTO ai_billing (chat_id, type, amount_wei, message_id, model, tokens_used)
      VALUES (${chatId}, 'usage', ${cost.toString()}, ${messageId}, ${model}, ${
      inputTokens + outputTokens
    })
    `;
  });

  const newBalance = await getAiBalanceStatus(chatId);
  return { success: true, newBalance: newBalance?.balanceWei ?? 0n, costWei: cost };
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
  limit = 50,
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
    [chatId, limit],
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

This will enable approximately ${
      Number(AI_PRICING.recommendedDeposit / AI_PRICING.costPerRequest)
    } AI requests.`;
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
  lastWarningTime?: Date,
): boolean {
  if (!balance.isLow) return false;

  // Don't show warning more than once per hour
  if (lastWarningTime) {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (lastWarningTime > hourAgo) return false;
  }

  return true;
}
