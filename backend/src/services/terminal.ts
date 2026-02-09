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

import { query, queryOne, execute, transaction } from '../db/index.ts';
import { logger } from '../utils/logger.ts';
import { spendJuice } from './juice.ts';
import { randomBytes, createHash } from 'node:crypto';
import { broadcastSessionStatus } from './terminalWs.ts';

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
  params: CreateDeviceParams
): Promise<{ device: TerminalDevice; apiKey: string }> {
  const { key, hash, prefix } = generateApiKey();
  const chainId = params.chainId ?? 42161; // Default to Arbitrum
  const acceptedTokens = params.acceptedTokens ?? ['ETH'];

  const row = await queryOne<{
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
  }>(
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
    ]
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
  const row = await queryOne<{
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
  }>(
    `SELECT id, merchant_id, name, project_id, chain_id, accepted_tokens,
            api_key_prefix, is_active, last_seen_at, created_at
     FROM terminal_devices WHERE id = $1`,
    [deviceId]
  );

  return row ? mapDeviceRow(row) : null;
}

/**
 * Get all devices for a merchant
 */
export async function getMerchantDevices(merchantId: string): Promise<TerminalDevice[]> {
  const rows = await query<{
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
  }>(
    `SELECT id, merchant_id, name, project_id, chain_id, accepted_tokens,
            api_key_prefix, is_active, last_seen_at, created_at
     FROM terminal_devices
     WHERE merchant_id = $1
     ORDER BY created_at DESC`,
    [merchantId]
  );

  return rows.map(mapDeviceRow);
}

/**
 * Authenticate device by API key
 */
export async function authenticateDevice(apiKey: string): Promise<TerminalDevice | null> {
  const hash = createHash('sha256').update(apiKey).digest('hex');

  const row = await queryOne<{
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
  }>(
    `UPDATE terminal_devices
     SET last_seen_at = NOW()
     WHERE api_key_hash = $1 AND is_active = TRUE
     RETURNING id, merchant_id, name, project_id, chain_id, accepted_tokens,
               api_key_prefix, is_active, last_seen_at, created_at`,
    [hash]
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
  }
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

  const row = await queryOne<{
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
  }>(
    `UPDATE terminal_devices
     SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex++} AND merchant_id = $${paramIndex}
     RETURNING id, merchant_id, name, project_id, chain_id, accepted_tokens,
               api_key_prefix, is_active, last_seen_at, created_at`,
    values
  );

  return row ? mapDeviceRow(row) : null;
}

/**
 * Regenerate API key for a device
 */
export async function regenerateApiKey(
  deviceId: string,
  merchantId: string
): Promise<string | null> {
  const { key, hash, prefix } = generateApiKey();

  const count = await execute(
    `UPDATE terminal_devices
     SET api_key_hash = $1, api_key_prefix = $2, updated_at = NOW()
     WHERE id = $3 AND merchant_id = $4`,
    [hash, prefix, deviceId, merchantId]
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
  merchantId: string
): Promise<boolean> {
  const count = await execute(
    `DELETE FROM terminal_devices
     WHERE id = $1 AND merchant_id = $2`,
    [deviceId, merchantId]
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
  params: CreateSessionParams
): Promise<PaymentSession> {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + SESSION_EXPIRY_MINUTES);

  const row = await queryOne<{
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
    `INSERT INTO payment_sessions (
      device_id, amount_usd, token, token_symbol, expires_at
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [
      params.deviceId,
      params.amountUsd,
      params.token || null,
      params.tokenSymbol || 'ETH',
      expiresAt,
    ]
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
  const row = await queryOne<{
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
  }>(`SELECT * FROM payment_sessions WHERE id = $1`, [sessionId]);

  return row ? mapSessionRow(row) : null;
}

/**
 * Get session with merchant/project details
 */
export async function getSessionWithDetails(
  sessionId: string
): Promise<PaymentSessionWithDetails | null> {
  const row = await queryOne<{
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
    [sessionId]
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
  limit = 50
): Promise<PaymentSession[]> {
  const rows = await query<{
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
    `SELECT * FROM payment_sessions
     WHERE device_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [deviceId, limit]
  );

  return rows.map(mapSessionRow);
}

/**
 * Get all sessions for a merchant
 */
export async function getMerchantSessions(
  merchantId: string,
  limit = 100,
  status?: string
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

  const rows = await query<{
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
  }
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

  const row = await queryOne<{
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
     SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    values
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
  deviceId: string
): Promise<boolean> {
  const count = await execute(
    `UPDATE payment_sessions
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND device_id = $2 AND status = 'pending'`,
    [sessionId, deviceId]
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
     WHERE status = 'pending' AND expires_at <= NOW()`
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
  params: PayWithJuiceParams
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
      [params.sessionId]
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
      [params.consumerId, params.sessionId]
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
        [params.sessionId]
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
      [spendId, params.sessionId]
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

/**
 * Mark session as completed (called when Juice spend completes)
 */
export async function completeSessionFromSpend(
  spendId: string,
  txHash: string,
  tokensIssued: string
): Promise<PaymentSession | null> {
  const row = await queryOne<{
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
     SET status = 'completed', tx_hash = $1, tokens_issued = $2, completed_at = NOW(), updated_at = NOW()
     WHERE juice_spend_id = $3 AND status = 'paying'
     RETURNING *`,
    [txHash, tokensIssued, spendId]
  );

  if (row) {
    logger.info('Payment session completed', {
      sessionId: row.id,
      txHash,
      tokensIssued,
    });
  }

  return row ? mapSessionRow(row) : null;
}

/**
 * Mark session as failed (called when Juice spend fails)
 */
export async function failSessionFromSpend(
  spendId: string,
  errorMessage: string
): Promise<PaymentSession | null> {
  const row = await queryOne<{
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
     SET status = 'failed', updated_at = NOW()
     WHERE juice_spend_id = $1 AND status = 'paying'
     RETURNING *`,
    [spendId]
  );

  if (row) {
    logger.warn('Payment session failed', {
      sessionId: row.id,
      spendId,
      errorMessage,
    });
  }

  return row ? mapSessionRow(row) : null;
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
    [merchantId]
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
const JB_MULTI_TERMINAL = '0x52869db3d61dde1e391967f2ce5039ad0ecd371c';
const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe';

/**
 * Get payment parameters for wallet payment
 * Returns the terminal address and encoded calldata for JBMultiTerminal.pay()
 */
export async function getWalletPaymentParams(
  sessionId: string
): Promise<{
  terminalAddress: string;
  chainId: number;
  projectId: number;
  amountUsd: number;
  tokenAddress: string;
  tokenSymbol: string;
  merchantName: string;
} | null> {
  const session = await getSessionWithDetails(sessionId);
  if (!session) return null;
  if (session.status !== 'pending') return null;
  if (new Date(session.expiresAt) < new Date()) return null;

  return {
    terminalAddress: JB_MULTI_TERMINAL,
    chainId: session.chainId,
    projectId: session.projectId,
    amountUsd: session.amountUsd,
    tokenAddress: session.token || NATIVE_TOKEN,
    tokenSymbol: session.tokenSymbol || 'ETH',
    merchantName: session.merchantName,
  };
}

/**
 * Start a wallet payment (consumer has initiated transaction)
 */
export async function startWalletPayment(
  sessionId: string,
  payerAddress: string
): Promise<PaymentSession | null> {
  const row = await queryOne<{
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
     SET status = 'paying', payment_method = 'wallet', updated_at = NOW()
     WHERE id = $1 AND status = 'pending' AND expires_at > NOW()
     RETURNING *`,
    [sessionId]
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
  tokensIssued?: string
): Promise<PaymentSession | null> {
  const row = await queryOne<{
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
     SET status = 'completed', tx_hash = $1, tokens_issued = $2, completed_at = NOW(), updated_at = NOW()
     WHERE id = $3 AND status = 'paying' AND payment_method = 'wallet'
     RETURNING *`,
    [txHash, tokensIssued || null, sessionId]
  );

  if (row) {
    logger.info('Wallet payment confirmed', { sessionId, txHash, tokensIssued });
    // Broadcast completion to connected WebSocket clients
    broadcastSessionStatus(sessionId, 'completed', { txHash, tokensIssued });
  }

  return row ? mapSessionRow(row) : null;
}

/**
 * Mark a wallet payment as failed
 */
export async function failWalletPayment(
  sessionId: string,
  errorMessage?: string
): Promise<PaymentSession | null> {
  const row = await queryOne<{
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
     SET status = 'failed', updated_at = NOW()
     WHERE id = $1 AND status = 'paying' AND payment_method = 'wallet'
     RETURNING *`,
    [sessionId]
  );

  if (row) {
    logger.info('Wallet payment failed', { sessionId, errorMessage });
    // Broadcast failure to connected WebSocket clients
    broadcastSessionStatus(sessionId, 'failed', { error: errorMessage });
  }

  return row ? mapSessionRow(row) : null;
}

// ============================================================================
// Row Mappers
// ============================================================================

function mapDeviceRow(row: {
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
}): TerminalDevice {
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

function mapSessionRow(row: {
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
}): PaymentSession {
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
