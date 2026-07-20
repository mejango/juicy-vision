/**
 * Terminal Service - Payment Terminal Management
 *
 * Manages physical payment terminals for merchants.
 * Terminals create payment sessions that consumers pay via PWA.
 *
 * Flow: Terminal creates session → Consumer taps NFC/scans QR
 *       → Opens PWA → Pays with Juice/Apple Pay/Wallet
 *       → Tokens issued to consumer's smart account
 */

import { execute, query, queryOne, transaction } from '../db/index.ts';
import { logger } from '../utils/logger.ts';
import { getEthUsdRate, spendJuice } from './juice.ts';
import { fetchPrimaryTerminal, getPublicClient } from './chainReader.ts';
import { type Address, decodeFunctionData, type Hex, isAddressEqual, zeroAddress } from 'viem';
import { createHash, randomBytes } from 'node:crypto';
import {
  CANONICAL_USDC_BY_CHAIN,
  CONTRACTS,
  NATIVE_TOKEN as SHARED_NATIVE_TOKEN,
} from '@shared/chains.ts';
import { broadcastSessionStatus } from './terminalWs.ts';
import { requireRecognizedProjectPayConfiguration } from './projectTrust.ts';
import { verifyProtectedPaymentReceipt } from './paymentReceipt.ts';

// Session expiry time in minutes
const SESSION_EXPIRY_MINUTES = 10;

// API key prefix length for identification
const API_KEY_PREFIX_LENGTH = 8;

// ============================================================================
// Types
// ============================================================================

export interface TerminalDevice {
  id: string;
  merchantId: string;
  name: string;
  projectId: number;
  chainId: number;
  acceptedTokens: string[];
  apiKeyPrefix: string;
  isActive: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
}

export interface PaymentSession {
  id: string;
  deviceId: string;
  amountUsd: number;
  token: string | null;
  tokenSymbol: string;
  status: 'pending' | 'paying' | 'completed' | 'failed' | 'expired' | 'cancelled';
  consumerId: string | null;
  paymentMethod: 'juice' | 'wallet' | 'apple_pay' | 'google_pay' | null;
  txHash: string | null;
  tokensIssued: string | null;
  juiceSpendId: string | null;
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
}

export interface PaymentSessionWithDetails extends PaymentSession {
  merchantId: string;
  merchantName: string;
  projectId: number;
  chainId: number;
}

export interface CreateDeviceParams {
  merchantId: string;
  name: string;
  projectId: number;
  chainId?: number;
  acceptedTokens?: string[];
}

export interface CreateSessionParams {
  deviceId: string;
  amountUsd: number;
  token?: string;
  tokenSymbol?: string;
}

export interface PayWithJuiceParams {
  sessionId: string;
  consumerId: string;
  beneficiaryAddress: string;
  memo?: string;
}

// ============================================================================
// Device Management
// ============================================================================

/**
 * Generate a secure API key for a terminal device
 */
function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `pt_${randomBytes(32).toString('hex')}`;
  const hash = createHash('sha256').update(key).digest('hex');
  const prefix = key.slice(0, API_KEY_PREFIX_LENGTH);
  return { key, hash, prefix };
}

/**
 * Register a new terminal device
 * Returns the device info AND the API key (only shown once)
 */
export async function registerDevice(
  params: CreateDeviceParams,
): Promise<{ device: TerminalDevice; apiKey: string }> {
  const { key, hash, prefix } = generateApiKey();
  const chainId = params.chainId ?? 42161; // Default to Arbitrum
  const acceptedTokens = params.acceptedTokens ?? ['ETH'];

  const row = await queryOne<DeviceRow>(
    `INSERT INTO terminal_devices (
      merchant_id, name, project_id, chain_id, accepted_tokens,
      api_key_hash, api_key_prefix
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, merchant_id, name, project_id, chain_id, accepted_tokens,
              api_key_prefix, is_active, last_seen_at, created_at`,
    [
      params.merchantId,
      params.name,
      params.projectId,
      chainId,
      acceptedTokens,
      hash,
      prefix,
    ],
  );

  if (!row) {
    throw new Error('Failed to create terminal device');
  }

  logger.info('Terminal device registered', {
    deviceId: row.id,
    merchantId: params.merchantId,
    projectId: params.projectId,
    chainId,
  });

  return {
    device: mapDeviceRow(row),
    apiKey: key,
  };
}

/**
 * Get device by ID
 */
export async function getDevice(deviceId: string): Promise<TerminalDevice | null> {
  const row = await queryOne<DeviceRow>(
    `SELECT id, merchant_id, name, project_id, chain_id, accepted_tokens,
            api_key_prefix, is_active, last_seen_at, created_at
     FROM terminal_devices WHERE id = $1`,
    [deviceId],
  );

  return row ? mapDeviceRow(row) : null;
}

/**
 * Get all devices for a merchant
 */
export async function getMerchantDevices(merchantId: string): Promise<TerminalDevice[]> {
  const rows = await query<DeviceRow>(
    `SELECT id, merchant_id, name, project_id, chain_id, accepted_tokens,
            api_key_prefix, is_active, last_seen_at, created_at
     FROM terminal_devices
     WHERE merchant_id = $1
     ORDER BY created_at DESC`,
    [merchantId],
  );

  return rows.map(mapDeviceRow);
}

/**
 * Authenticate device by API key
 */
export async function authenticateDevice(apiKey: string): Promise<TerminalDevice | null> {
  const hash = createHash('sha256').update(apiKey).digest('hex');

  const row = await queryOne<DeviceRow>(
    `UPDATE terminal_devices
     SET last_seen_at = NOW()
     WHERE api_key_hash = $1 AND is_active = TRUE
     RETURNING id, merchant_id, name, project_id, chain_id, accepted_tokens,
               api_key_prefix, is_active, last_seen_at, created_at`,
    [hash],
  );

  return row ? mapDeviceRow(row) : null;
}

/**
 * Update device settings
 */
export async function updateDevice(
  deviceId: string,
  merchantId: string,
  updates: {
    name?: string;
    projectId?: number;
    chainId?: number;
    acceptedTokens?: string[];
    isActive?: boolean;
  },
): Promise<TerminalDevice | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    values.push(updates.name);
  }
  if (updates.projectId !== undefined) {
    setClauses.push(`project_id = $${paramIndex++}`);
    values.push(updates.projectId);
  }
  if (updates.chainId !== undefined) {
    setClauses.push(`chain_id = $${paramIndex++}`);
    values.push(updates.chainId);
  }
  if (updates.acceptedTokens !== undefined) {
    setClauses.push(`accepted_tokens = $${paramIndex++}`);
    values.push(updates.acceptedTokens);
  }
  if (updates.isActive !== undefined) {
    setClauses.push(`is_active = $${paramIndex++}`);
    values.push(updates.isActive);
  }

  if (setClauses.length === 0) {
    return getDevice(deviceId);
  }

  values.push(deviceId, merchantId);

  const row = await queryOne<DeviceRow>(
    `UPDATE terminal_devices
     SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex++} AND merchant_id = $${paramIndex}
     RETURNING id, merchant_id, name, project_id, chain_id, accepted_tokens,
               api_key_prefix, is_active, last_seen_at, created_at`,
    values,
  );

  return row ? mapDeviceRow(row) : null;
}

/**
 * Regenerate API key for a device
 */
export async function regenerateApiKey(
  deviceId: string,
  merchantId: string,
): Promise<string | null> {
  const { key, hash, prefix } = generateApiKey();

  const count = await execute(
    `UPDATE terminal_devices
     SET api_key_hash = $1, api_key_prefix = $2, updated_at = NOW()
     WHERE id = $3 AND merchant_id = $4`,
    [hash, prefix, deviceId, merchantId],
  );

  if (count === 0) {
    return null;
  }

  logger.info('Terminal API key regenerated', { deviceId, merchantId });
  return key;
}

/**
 * Delete a terminal device
 */
export async function deleteDevice(
  deviceId: string,
  merchantId: string,
): Promise<boolean> {
  const count = await execute(
    `DELETE FROM terminal_devices
     WHERE id = $1 AND merchant_id = $2`,
    [deviceId, merchantId],
  );

  if (count > 0) {
    logger.info('Terminal device deleted', { deviceId, merchantId });
    return true;
  }
  return false;
}

// ============================================================================
// Payment Session Management
// ============================================================================

/**
 * Create a new payment session
 */
export async function createSession(
  params: CreateSessionParams,
): Promise<PaymentSession> {
  const device = await getDevice(params.deviceId);
  if (!device || !device.isActive) throw new Error('Terminal device is not active');

  const requestedSymbol = (params.tokenSymbol || (params.token ? '' : 'ETH')).toUpperCase();
  if (requestedSymbol !== 'ETH' && requestedSymbol !== 'USDC') {
    throw new Error('Wallet terminal sessions support ETH or canonical USDC only');
  }

  const tokenAddress = resolveWalletToken(device.chainId, params.token, requestedSymbol);
  const accepted = device.acceptedTokens.map((value) => value.toLowerCase());
  if (
    !accepted.includes(requestedSymbol.toLowerCase()) &&
    !accepted.includes(tokenAddress.toLowerCase())
  ) {
    throw new Error(`${requestedSymbol} is not enabled for this terminal`);
  }

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + SESSION_EXPIRY_MINUTES);

  const row = await queryOne<SessionRow>(
    `INSERT INTO payment_sessions (
      device_id, amount_usd, token, token_symbol, expires_at
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [
      params.deviceId,
      params.amountUsd,
      requestedSymbol === 'ETH' ? null : tokenAddress,
      requestedSymbol,
      expiresAt,
    ],
  );

  if (!row) {
    throw new Error('Failed to create payment session');
  }

  logger.info('Payment session created', {
    sessionId: row.id,
    deviceId: params.deviceId,
    amountUsd: params.amountUsd,
    expiresAt: expiresAt.toISOString(),
  });

  return mapSessionRow(row);
}

/**
 * Get payment session by ID
 */
export async function getSession(sessionId: string): Promise<PaymentSession | null> {
  const row = await queryOne<SessionRow>(`SELECT * FROM payment_sessions WHERE id = $1`, [sessionId]);

  return row ? mapSessionRow(row) : null;
}

/**
 * Get session with merchant/project details
 */
export async function getSessionWithDetails(
  sessionId: string,
): Promise<PaymentSessionWithDetails | null> {
  const row = await queryOne<SessionRow & {
    merchant_id: string;
    merchant_name: string;
    project_id: number;
    chain_id: number;
  }>(
    `SELECT ps.*,
            td.merchant_id,
            u.email as merchant_name,
            td.project_id,
            td.chain_id
     FROM payment_sessions ps
     JOIN terminal_devices td ON td.id = ps.device_id
     JOIN users u ON u.id = td.merchant_id
     WHERE ps.id = $1`,
    [sessionId],
  );

  if (!row) return null;

  return {
    ...mapSessionRow(row),
    merchantId: row.merchant_id,
    merchantName: row.merchant_name,
    projectId: row.project_id,
    chainId: row.chain_id,
  };
}

/**
 * Get all sessions for a device
 */
export async function getDeviceSessions(
  deviceId: string,
  limit = 50,
): Promise<PaymentSession[]> {
  const rows = await query<SessionRow>(
    `SELECT * FROM payment_sessions
     WHERE device_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [deviceId, limit],
  );

  return rows.map(mapSessionRow);
}

/**
 * Get all sessions for a merchant
 */
export async function getMerchantSessions(
  merchantId: string,
  limit = 100,
  status?: string,
): Promise<PaymentSessionWithDetails[]> {
  let sql = `
    SELECT ps.*,
           td.merchant_id,
           u.email as merchant_name,
           td.project_id,
           td.chain_id
    FROM payment_sessions ps
    JOIN terminal_devices td ON td.id = ps.device_id
    JOIN users u ON u.id = td.merchant_id
    WHERE td.merchant_id = $1
  `;
  const values: unknown[] = [merchantId];

  if (status) {
    sql += ` AND ps.status = $2`;
    values.push(status);
  }

  sql += ` ORDER BY ps.created_at DESC LIMIT $${values.length + 1}`;
  values.push(limit);

  const rows = await query<SessionRow & {
    merchant_id: string;
    merchant_name: string;
    project_id: number;
    chain_id: number;
  }>(sql, values);

  return rows.map((row) => ({
    ...mapSessionRow(row),
    merchantId: row.merchant_id,
    merchantName: row.merchant_name,
    projectId: row.project_id,
    chainId: row.chain_id,
  }));
}

/**
 * Update session status
 */
export async function updateSessionStatus(
  sessionId: string,
  status: PaymentSession['status'],
  updates?: {
    consumerId?: string;
    paymentMethod?: PaymentSession['paymentMethod'];
    txHash?: string;
    tokensIssued?: string;
    juiceSpendId?: string;
  },
): Promise<PaymentSession | null> {
  const setClauses = ['status = $2'];
  const values: unknown[] = [sessionId, status];
  let paramIndex = 3;

  if (updates?.consumerId) {
    setClauses.push(`consumer_id = $${paramIndex++}`);
    values.push(updates.consumerId);
  }
  if (updates?.paymentMethod) {
    setClauses.push(`payment_method = $${paramIndex++}`);
    values.push(updates.paymentMethod);
  }
  if (updates?.txHash) {
    setClauses.push(`tx_hash = $${paramIndex++}`);
    values.push(updates.txHash);
  }
  if (updates?.tokensIssued) {
    setClauses.push(`tokens_issued = $${paramIndex++}`);
    values.push(updates.tokensIssued);
  }
  if (updates?.juiceSpendId) {
    setClauses.push(`juice_spend_id = $${paramIndex++}`);
    values.push(updates.juiceSpendId);
  }

  if (status === 'completed') {
    setClauses.push(`completed_at = NOW()`);
  }

  const row = await queryOne<SessionRow>(
    `UPDATE payment_sessions
     SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    values,
  );

  if (row) {
    logger.info('Payment session updated', { sessionId, status, updates });
    // Broadcast status update to connected WebSocket clients
    broadcastSessionStatus(sessionId, status, {
      txHash: updates?.txHash,
      tokensIssued: updates?.tokensIssued,
    });
  }

  return row ? mapSessionRow(row) : null;
}

/**
 * Cancel a pending session
 */
export async function cancelSession(
  sessionId: string,
  deviceId: string,
): Promise<boolean> {
  const count = await execute(
    `UPDATE payment_sessions
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND device_id = $2 AND status = 'pending'`,
    [sessionId, deviceId],
  );

  if (count > 0) {
    logger.info('Payment session cancelled', { sessionId, deviceId });
    // Broadcast cancellation to connected WebSocket clients
    broadcastSessionStatus(sessionId, 'cancelled');
    return true;
  }
  return false;
}

/**
 * Expire old pending sessions
 */
export async function expireSessions(): Promise<number> {
  const count = await execute(
    `UPDATE payment_sessions
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending' AND expires_at <= NOW()`,
  );

  if (count > 0) {
    logger.info('Expired payment sessions', { count });
  }

  return count;
}

// ============================================================================
// Payment Execution
// ============================================================================

/**
 * Pay a session with Juice credits
 */
export async function payWithJuice(
  params: PayWithJuiceParams,
): Promise<PaymentSession> {
  return await transaction(async (client) => {
    // Get session with device details
    const { rows: sessions } = await client.queryObject<{
      id: string;
      device_id: string;
      amount_usd: string;
      status: string;
      expires_at: string;
      project_id: number;
      chain_id: number;
    }>(
      `SELECT ps.id, ps.device_id, ps.amount_usd, ps.status, ps.expires_at,
              td.project_id, td.chain_id
       FROM payment_sessions ps
       JOIN terminal_devices td ON td.id = ps.device_id
       WHERE ps.id = $1
       FOR UPDATE`,
      [params.sessionId],
    );

    const session = sessions[0];
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== 'pending') {
      throw new Error(`Session is not pending: ${session.status}`);
    }

    if (new Date(session.expires_at) < new Date()) {
      throw new Error('Session has expired');
    }

    const amountUsd = parseFloat(session.amount_usd);

    // Mark session as paying
    await client.queryObject(
      `UPDATE payment_sessions
       SET status = 'paying', consumer_id = $1, payment_method = 'juice', updated_at = NOW()
       WHERE id = $2`,
      [params.consumerId, params.sessionId],
    );

    // Execute the Juice spend (this deducts from balance and queues for execution)
    let spendId: string;
    try {
      spendId = await spendJuice({
        userId: params.consumerId,
        amount: amountUsd,
        projectId: session.project_id,
        chainId: session.chain_id,
        beneficiaryAddress: params.beneficiaryAddress,
        memo: params.memo || `PayTerm payment`,
      });
    } catch (error) {
      // Revert session to pending on spend failure
      await client.queryObject(
        `UPDATE payment_sessions
         SET status = 'pending', consumer_id = NULL, payment_method = NULL, updated_at = NOW()
         WHERE id = $1`,
        [params.sessionId],
      );
      throw error;
    }

    // Update session with spend reference
    // The actual completion happens when the spend is executed on-chain
    const { rows: updated } = await client.queryObject<{
      id: string;
      device_id: string;
      amount_usd: string;
      token: string | null;
      token_symbol: string;
      status: string;
      consumer_id: string | null;
      payment_method: string | null;
      tx_hash: string | null;
      tokens_issued: string | null;
      juice_spend_id: string | null;
      expires_at: string;
      completed_at: string | null;
      created_at: string;
    }>(
      `UPDATE payment_sessions
       SET juice_spend_id = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [spendId, params.sessionId],
    );

    logger.info('Payment session paid with Juice', {
      sessionId: params.sessionId,
      consumerId: params.consumerId,
      spendId,
      amountUsd,
    });

    return mapSessionRow(updated[0]);
  });
}

// ============================================================================
// Merchant Analytics
// ============================================================================

/**
 * Get merchant's terminal stats
 */
export async function getMerchantStats(merchantId: string): Promise<{
  totalDevices: number;
  activeDevices: number;
  totalPayments: number;
  completedPayments: number;
  totalVolumeUsd: number;
  last24hVolumeUsd: number;
  last7dVolumeUsd: number;
}> {
  const row = await queryOne<{
    total_devices: string;
    active_devices: string;
    total_payments: string;
    completed_payments: string;
    total_volume_usd: string;
    last_24h_volume_usd: string;
    last_7d_volume_usd: string;
  }>(
    `SELECT
      (SELECT COUNT(*) FROM terminal_devices WHERE merchant_id = $1) as total_devices,
      (SELECT COUNT(*) FROM terminal_devices WHERE merchant_id = $1 AND is_active = TRUE) as active_devices,
      COUNT(ps.id) as total_payments,
      COUNT(ps.id) FILTER (WHERE ps.status = 'completed') as completed_payments,
      COALESCE(SUM(ps.amount_usd) FILTER (WHERE ps.status = 'completed'), 0) as total_volume_usd,
      COALESCE(SUM(ps.amount_usd) FILTER (WHERE ps.status = 'completed' AND ps.completed_at >= NOW() - INTERVAL '24 hours'), 0) as last_24h_volume_usd,
      COALESCE(SUM(ps.amount_usd) FILTER (WHERE ps.status = 'completed' AND ps.completed_at >= NOW() - INTERVAL '7 days'), 0) as last_7d_volume_usd
    FROM payment_sessions ps
    JOIN terminal_devices td ON td.id = ps.device_id
    WHERE td.merchant_id = $1`,
    [merchantId],
  );

  return {
    totalDevices: parseInt(row?.total_devices ?? '0'),
    activeDevices: parseInt(row?.active_devices ?? '0'),
    totalPayments: parseInt(row?.total_payments ?? '0'),
    completedPayments: parseInt(row?.completed_payments ?? '0'),
    totalVolumeUsd: parseFloat(row?.total_volume_usd ?? '0'),
    last24hVolumeUsd: parseFloat(row?.last_24h_volume_usd ?? '0'),
    last7dVolumeUsd: parseFloat(row?.last_7d_volume_usd ?? '0'),
  };
}

// ============================================================================
// Wallet Payment Functions
// ============================================================================

// JBMultiTerminal contract addresses (CREATE2 - same on all chains)
const NATIVE_TOKEN = SHARED_NATIVE_TOKEN;
const USDC_ADDRESSES = CANONICAL_USDC_BY_CHAIN as Record<number, Address>;

const TERMINAL_PAY_ABI = [{
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
  outputs: [{ name: 'beneficiaryTokenCount', type: 'uint256' }],
}] as const;

const RECOGNIZED_MULTI_TERMINAL = CONTRACTS.JBMultiTerminal as Address;
function resolveWalletToken(
  chainId: number,
  token: string | null | undefined,
  symbol: string,
): Address {
  if (symbol === 'ETH') {
    if (token && token.toLowerCase() !== NATIVE_TOKEN.toLowerCase()) {
      throw new Error('ETH sessions must use the Juicebox native-token address');
    }
    return NATIVE_TOKEN;
  }

  const canonicalUsdc = USDC_ADDRESSES[chainId];
  if (!canonicalUsdc) throw new Error(`USDC is not supported on chain ${chainId}`);
  if (token && token.toLowerCase() !== canonicalUsdc.toLowerCase()) {
    throw new Error('The requested token is not canonical USDC on this chain');
  }
  return canonicalUsdc;
}

function quoteTokenAmount(amountUsd: number, token: Address, ethUsdRate?: number): bigint {
  const usdMicros = BigInt(Math.round(amountUsd * 1_000_000));
  if (token.toLowerCase() !== NATIVE_TOKEN.toLowerCase()) return usdMicros;
  if (!ethUsdRate) throw new Error('An ETH/USD rate is required for native payments');
  const priceMicros = BigInt(Math.round(ethUsdRate * 1_000_000));
  return (usdMicros * 10n ** 18n + priceMicros - 1n) / priceMicros;
}

/**
 * Get payment parameters for wallet payment
 * Returns the terminal address and encoded calldata for JBMultiTerminal.pay()
 */
export async function getWalletPaymentParams(
  sessionId: string,
): Promise<
  {
    terminalAddress: string;
    chainId: number;
    projectId: number;
    amountUsd: number;
    tokenAddress: string;
    tokenSymbol: string;
    merchantName: string;
    paymentAmount: string;
    paymentMemo: string;
    quoteExpiresAt: string;
  } | null
> {
  const session = await getSessionWithDetails(sessionId);
  if (!session) return null;
  if (session.status !== 'pending') return null;
  if (new Date(session.expiresAt) < new Date()) return null;

  const tokenAddress = resolveWalletToken(
    session.chainId,
    session.token,
    session.tokenSymbol.toUpperCase(),
  );
  const terminalAddress = await fetchPrimaryTerminal(
    session.chainId,
    session.projectId,
    tokenAddress,
  );
  if (terminalAddress.toLowerCase() === zeroAddress) return null;
  if (terminalAddress.toLowerCase() !== RECOGNIZED_MULTI_TERMINAL.toLowerCase()) {
    throw new Error('Wallet checkout is unavailable because this project uses a routing terminal');
  }
  await requireRecognizedProjectPayConfiguration({
    client: getPublicClient(session.chainId),
    projectId: BigInt(session.projectId),
  });

  const ethUsdRate = tokenAddress.toLowerCase() === NATIVE_TOKEN.toLowerCase()
    ? await getEthUsdRate()
    : undefined;
  const paymentAmount = quoteTokenAmount(session.amountUsd, tokenAddress, ethUsdRate);
  const quoteExpiresAt = new Date(Math.min(
    Date.now() + 60_000,
    new Date(session.expiresAt).getTime(),
  ));
  const paymentMemo = `PayTerm ${session.id}`;

  const updated = await execute(
    `UPDATE payment_sessions
     SET quoted_token_amount = $1, quoted_terminal_address = $2,
         quoted_token_address = $3, quoted_project_id = $4,
         quoted_chain_id = $5, quote_expires_at = $6, updated_at = NOW()
     WHERE id = $7 AND status = 'pending' AND expires_at > NOW()`,
    [
      paymentAmount.toString(),
      terminalAddress,
      tokenAddress,
      session.projectId,
      session.chainId,
      quoteExpiresAt,
      sessionId,
    ],
  );
  if (updated !== 1) return null;

  return {
    terminalAddress,
    chainId: session.chainId,
    projectId: session.projectId,
    amountUsd: session.amountUsd,
    tokenAddress,
    tokenSymbol: session.tokenSymbol,
    merchantName: session.merchantName,
    paymentAmount: paymentAmount.toString(),
    paymentMemo,
    quoteExpiresAt: quoteExpiresAt.toISOString(),
  };
}

/**
 * Start a wallet payment (consumer has initiated transaction)
 */
export async function startWalletPayment(
  sessionId: string,
  payerAddress: string,
): Promise<PaymentSession | null> {
  const row = await queryOne<SessionRow>(
    `UPDATE payment_sessions
     SET status = 'paying', payment_method = 'wallet', payer_address = $2, updated_at = NOW()
     WHERE id = $1 AND status = 'pending' AND expires_at > NOW()
       AND quote_expires_at > NOW() AND quoted_token_amount IS NOT NULL
       AND quoted_terminal_address IS NOT NULL AND quoted_token_address IS NOT NULL
       AND quoted_project_id IS NOT NULL AND quoted_chain_id IS NOT NULL
     RETURNING *`,
    [sessionId, payerAddress],
  );

  if (row) {
    logger.info('Wallet payment started', { sessionId, payerAddress });
    // Broadcast status update to connected WebSocket clients
    broadcastSessionStatus(sessionId, 'paying');
  }

  return row ? mapSessionRow(row) : null;
}

/**
 * Confirm a wallet payment (transaction submitted)
 */
export async function confirmWalletPayment(
  sessionId: string,
  txHash: string,
  _tokensIssued?: string,
): Promise<PaymentSession | null> {
  const verification = await queryOne<{
    status: string;
    payment_method: string | null;
    payer_address: string | null;
    tx_hash: string | null;
    quoted_token_amount: string | null;
    quoted_terminal_address: string | null;
    quoted_token_address: string | null;
    quoted_project_id: string | null;
    quoted_chain_id: number | null;
  }>(
    `SELECT status, payment_method, payer_address, tx_hash,
            quoted_token_amount, quoted_terminal_address,
            quoted_token_address, quoted_project_id, quoted_chain_id
     FROM payment_sessions
     WHERE id = $1`,
    [sessionId],
  );
  if (
    !verification ||
    verification.status !== 'paying' ||
    verification.payment_method !== 'wallet' ||
    !verification.payer_address ||
    !verification.quoted_token_amount ||
    !verification.quoted_terminal_address ||
    !verification.quoted_token_address ||
    !verification.quoted_project_id ||
    verification.quoted_chain_id === null
  ) {
    return null;
  }

  const tokenAddress = verification.quoted_token_address as Address;
  const terminalAddress = verification.quoted_terminal_address as Address;
  const projectId = BigInt(verification.quoted_project_id);
  const chainId = verification.quoted_chain_id;
  if (terminalAddress.toLowerCase() !== RECOGNIZED_MULTI_TERMINAL.toLowerCase()) {
    throw new Error(`Terminal not recognized for wallet checkout: ${terminalAddress}`);
  }
  resolveWalletToken(
    chainId,
    tokenAddress,
    tokenAddress.toLowerCase() === NATIVE_TOKEN.toLowerCase() ? 'ETH' : 'USDC',
  );
  const client = getPublicClient(chainId);
  const hash = txHash as Hex;
  const chainTransaction = await client.getTransaction({ hash });
  if (!chainTransaction.to || !isAddressEqual(chainTransaction.to, terminalAddress)) {
    throw new Error('Wallet transaction targeted the wrong terminal');
  }
  if (!isAddressEqual(chainTransaction.from, verification.payer_address as Address)) {
    throw new Error('Wallet transaction was sent by a different payer');
  }

  const decoded = decodeFunctionData({ abi: TERMINAL_PAY_ABI, data: chainTransaction.input });
  if (decoded.functionName !== 'pay' || !decoded.args) {
    throw new Error('Wallet transaction is not a terminal payment');
  }
  const [
    paidProjectId,
    paidToken,
    paidAmount,
    paidBeneficiary,
    paidMinimum,
    paidMemo,
    paidMetadata,
  ] = decoded.args;
  if (paidProjectId !== projectId) throw new Error('Wallet transaction paid the wrong project');
  if (!isAddressEqual(paidToken, tokenAddress)) {
    throw new Error('Wallet transaction used the wrong token');
  }
  if (paidAmount !== BigInt(verification.quoted_token_amount)) {
    throw new Error('Wallet transaction used the wrong amount');
  }
  if (!isAddressEqual(paidBeneficiary, verification.payer_address as Address)) {
    throw new Error('Wallet transaction sends project tokens to the wrong beneficiary');
  }
  if (paidMinimum <= 0n) throw new Error('Wallet transaction has no minimum project-token return');
  if (paidMemo !== `PayTerm ${sessionId}`) {
    throw new Error('Wallet transaction does not match this payment session');
  }
  if (paidMetadata !== '0x') {
    throw new Error('Wallet transaction contains unexpected payment metadata');
  }

  const isNative = tokenAddress.toLowerCase() === NATIVE_TOKEN.toLowerCase();
  if (
    (isNative && chainTransaction.value !== paidAmount) ||
    (!isNative && chainTransaction.value !== 0n)
  ) {
    throw new Error('Wallet transaction sent an incorrect native value');
  }

  const bound = await queryOne<{ id: string }>(
    `UPDATE payment_sessions
     SET tx_hash = COALESCE(tx_hash, $1), updated_at = NOW()
     WHERE id = $2 AND status = 'paying' AND payment_method = 'wallet'
       AND (tx_hash IS NULL OR LOWER(tx_hash) = LOWER($1))
       AND NOT EXISTS (
         SELECT 1 FROM payment_sessions used
         WHERE LOWER(used.tx_hash) = LOWER($1) AND used.id <> $2
       )
     RETURNING id`,
    [txHash, sessionId],
  );
  if (!bound) return null;

  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('Wallet transaction reverted');

  const issuedTokens = verifyProtectedPaymentReceipt({
    logs: receipt.logs,
    entrypoint: terminalAddress,
    projectId: paidProjectId,
    payer: verification.payer_address as Address,
    beneficiary: paidBeneficiary,
    amount: paidAmount,
    memo: paidMemo,
    metadata: paidMetadata,
    minimum: paidMinimum,
  });

  const row = await queryOne<SessionRow>(
    `UPDATE payment_sessions
     SET status = 'completed', tokens_issued = $2, completed_at = NOW(), updated_at = NOW()
     WHERE id = $3 AND status = 'paying' AND payment_method = 'wallet'
       AND LOWER(tx_hash) = LOWER($1)
     RETURNING *`,
    [txHash, issuedTokens.toString(), sessionId],
  );

  if (row) {
    logger.info('Wallet payment confirmed', { sessionId, txHash });
    // Broadcast completion to connected WebSocket clients
    broadcastSessionStatus(sessionId, 'completed', { txHash });
  }

  return row ? mapSessionRow(row) : null;
}

/**
 * Release a wallet attempt without claiming that an uncertain on-chain payment
 * failed. A submitted transaction can only be released after a proven revert.
 */
export async function resetWalletPayment(
  sessionId: string,
  payerAddress: string,
  txHash?: string,
  errorMessage?: string,
): Promise<PaymentSession | null> {
  if (txHash) {
    const attempt = await queryOne<{
      payer_address: string | null;
      tx_hash: string | null;
      quoted_chain_id: number | null;
    }>(
      `SELECT payer_address, tx_hash, quoted_chain_id
       FROM payment_sessions
       WHERE id = $1 AND status = 'paying' AND payment_method = 'wallet'`,
      [sessionId],
    );
    if (
      !attempt?.payer_address ||
      attempt.payer_address.toLowerCase() !== payerAddress.toLowerCase() ||
      (attempt.tx_hash !== null && attempt.tx_hash.toLowerCase() !== txHash.toLowerCase()) ||
      attempt.quoted_chain_id === null
    ) return null;

    const client = getPublicClient(attempt.quoted_chain_id);
    const [receipt, chainTransaction] = await Promise.all([
      client.getTransactionReceipt({ hash: txHash as Hex }),
      client.getTransaction({ hash: txHash as Hex }),
    ]);
    if (
      receipt.status !== 'reverted' ||
      !isAddressEqual(chainTransaction.from, payerAddress as Address)
    ) {
      throw new Error('Only a proven reverted transaction can be reset');
    }
  }

  const row = await queryOne<SessionRow>(
    `UPDATE payment_sessions
     SET status = 'pending', payment_method = NULL, payer_address = NULL,
         tx_hash = NULL, tokens_issued = NULL,
         quoted_token_amount = NULL, quoted_terminal_address = NULL,
         quoted_token_address = NULL, quoted_project_id = NULL,
         quoted_chain_id = NULL, quote_expires_at = NULL, updated_at = NOW()
     WHERE id = $1 AND status = 'paying' AND payment_method = 'wallet'
       AND LOWER(payer_address) = LOWER($2)
       AND (
         ($3::VARCHAR IS NULL AND tx_hash IS NULL) OR
         ($3::VARCHAR IS NOT NULL AND (tx_hash IS NULL OR LOWER(tx_hash) = LOWER($3)))
       )
     RETURNING *`,
    [sessionId, payerAddress, txHash ?? null],
  );

  if (row) {
    logger.info('Wallet payment attempt reset', { sessionId, txHash, errorMessage });
    broadcastSessionStatus(sessionId, 'pending');
  }

  return row ? mapSessionRow(row) : null;
}

// ============================================================================
// Row Mappers
// ============================================================================

// Raw DB row shapes shared by the queries and mappers below
interface DeviceRow {
  id: string;
  merchant_id: string;
  name: string;
  project_id: number;
  chain_id: number;
  accepted_tokens: string[];
  api_key_prefix: string;
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
}

interface SessionRow {
  id: string;
  device_id: string;
  amount_usd: string;
  token: string | null;
  token_symbol: string;
  status: string;
  consumer_id: string | null;
  payment_method: string | null;
  tx_hash: string | null;
  tokens_issued: string | null;
  juice_spend_id: string | null;
  expires_at: string;
  completed_at: string | null;
  created_at: string;
}

function mapDeviceRow(row: DeviceRow): TerminalDevice {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    name: row.name,
    projectId: row.project_id,
    chainId: row.chain_id,
    acceptedTokens: row.accepted_tokens,
    apiKeyPrefix: row.api_key_prefix,
    isActive: row.is_active,
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
    createdAt: new Date(row.created_at),
  };
}

function mapSessionRow(row: SessionRow): PaymentSession {
  return {
    id: row.id,
    deviceId: row.device_id,
    amountUsd: parseFloat(row.amount_usd),
    token: row.token,
    tokenSymbol: row.token_symbol,
    status: row.status as PaymentSession['status'],
    consumerId: row.consumer_id,
    paymentMethod: row.payment_method as PaymentSession['paymentMethod'],
    txHash: row.tx_hash,
    tokensIssued: row.tokens_issued,
    juiceSpendId: row.juice_spend_id,
    expiresAt: new Date(row.expires_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    createdAt: new Date(row.created_at),
  };
}
