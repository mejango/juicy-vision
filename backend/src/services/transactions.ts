import { query, queryOne, execute } from '../db/index.ts';

// =============================================================================
// Types
// =============================================================================

export type TransactionStatus = 'pending' | 'submitted' | 'confirmed' | 'failed' | 'cancelled';

export interface TransactionReceipt {
  blockNumber: number;
  blockHash: string;
  gasUsed: string;
  effectiveGasPrice: string;
  status: 'success' | 'reverted';
}

export interface Transaction {
  id: string;
  userId: string | null;
  sessionId: string | null;
  txHash: string | null;
  chainId: number;
  fromAddress: string;
  toAddress: string;
  tokenAddress: string | null;
  amount: string;
  projectId: string | null;
  status: TransactionStatus;
  errorMessage: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  receipt: TransactionReceipt | null;
}

interface DbTransaction {
  id: string;
  user_id: string | null;
  session_id: string | null;
  tx_hash: string | null;
  chain_id: number;
  from_address: string;
  to_address: string;
  token_address: string | null;
  amount: string;
  project_id: string | null;
  status: TransactionStatus;
  error_message: string | null;
  created_at: Date;
  submitted_at: Date | null;
  confirmed_at: Date | null;
  receipt: TransactionReceipt | null;
}

// =============================================================================
// Helper: Convert DB row to Transaction type
// =============================================================================

function toTransaction(row: DbTransaction): Transaction {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    txHash: row.tx_hash,
    chainId: row.chain_id,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    tokenAddress: row.token_address,
    amount: row.amount,
    projectId: row.project_id,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    confirmedAt: row.confirmed_at,
    receipt: row.receipt,
  };
}

// =============================================================================
// Transaction CRUD Operations
// =============================================================================

export interface CreateTransactionParams {
  userId?: string;
  sessionId?: string;
  chainId: number;
  fromAddress: string;
  toAddress: string;
  tokenAddress?: string;
  amount: string;
  projectId?: string;
}

export async function createTransaction(params: CreateTransactionParams): Promise<Transaction> {
  const {
    userId,
    sessionId,
    chainId,
    fromAddress,
    toAddress,
    tokenAddress,
    amount,
    projectId,
  } = params;

  const result = await query<DbTransaction>(
    `INSERT INTO transactions (
      user_id, session_id, chain_id, from_address, to_address,
      token_address, amount, project_id, status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
    RETURNING *`,
    [
      userId || null,
      sessionId || null,
      chainId,
      fromAddress.toLowerCase(),
      toAddress.toLowerCase(),
      tokenAddress?.toLowerCase() || null,
      amount,
      projectId || null,
    ]
  );

  return toTransaction(result[0]);
}

export interface UpdateTransactionParams {
  status?: TransactionStatus;
  txHash?: string;
  errorMessage?: string;
  receipt?: TransactionReceipt;
}

export async function updateTransaction(
  id: string,
  params: UpdateTransactionParams
): Promise<Transaction | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (params.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    values.push(params.status);

    // Set timestamp based on status
    if (params.status === 'submitted') {
      updates.push(`submitted_at = NOW()`);
    } else if (params.status === 'confirmed' || params.status === 'failed') {
      updates.push(`confirmed_at = NOW()`);
    }
  }

  if (params.txHash !== undefined) {
    updates.push(`tx_hash = $${paramIndex++}`);
    values.push(params.txHash.toLowerCase());
  }

  if (params.errorMessage !== undefined) {
    updates.push(`error_message = $${paramIndex++}`);
    values.push(params.errorMessage);
  }

  if (params.receipt !== undefined) {
    updates.push(`receipt = $${paramIndex++}`);
    values.push(JSON.stringify(params.receipt));
  }

  if (updates.length === 0) {
    return getTransactionById(id);
  }

  values.push(id);
  const result = await query<DbTransaction>(
    `UPDATE transactions
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  return result[0] ? toTransaction(result[0]) : null;
}

export async function getTransactionById(id: string): Promise<Transaction | null> {
  const row = await queryOne<DbTransaction>(
    'SELECT * FROM transactions WHERE id = $1',
    [id]
  );

  return row ? toTransaction(row) : null;
}

export async function getTransactionByHash(txHash: string): Promise<Transaction | null> {
  const row = await queryOne<DbTransaction>(
    'SELECT * FROM transactions WHERE tx_hash = $1',
    [txHash.toLowerCase()]
  );

  return row ? toTransaction(row) : null;
}

export async function getTransactionsBySession(
  sessionId: string,
  limit = 50
): Promise<Transaction[]> {
  const rows = await query<DbTransaction>(
    `SELECT * FROM transactions
     WHERE session_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [sessionId, limit]
  );

  return rows.map(toTransaction);
}

export async function getTransactionsByUser(
  userId: string,
  limit = 50,
  offset = 0
): Promise<Transaction[]> {
  const rows = await query<DbTransaction>(
    `SELECT * FROM transactions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  return rows.map(toTransaction);
}

export async function getTransactionsByProject(
  projectId: string,
  chainId?: number,
  limit = 50
): Promise<Transaction[]> {
  let sql = `SELECT * FROM transactions WHERE project_id = $1`;
  const params: unknown[] = [projectId];

  if (chainId !== undefined) {
    sql += ` AND chain_id = $2`;
    params.push(chainId);
  }

  sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const rows = await query<DbTransaction>(sql, params);
  return rows.map(toTransaction);
}

export async function getPendingTransactions(limit = 100): Promise<Transaction[]> {
  const rows = await query<DbTransaction>(
    `SELECT * FROM transactions
     WHERE status IN ('pending', 'submitted')
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );

  return rows.map(toTransaction);
}

// =============================================================================
// Cleanup
// =============================================================================

export async function cleanupOldTransactions(daysOld = 90): Promise<number> {
  return await execute(
    `DELETE FROM transactions
     WHERE created_at < NOW() - INTERVAL '${daysOld} days'
     AND status IN ('confirmed', 'failed', 'cancelled')`
  );
}
