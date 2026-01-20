import { Pool } from 'postgres';
import { getConfig } from '../utils/config.ts';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const config = getConfig();
    pool = new Pool(config.databaseUrl, 10); // 10 connections max
  }
  return pool;
}

export async function query<T>(sql: string, args?: unknown[]): Promise<T[]> {
  const pool = getPool();
  const connection = await pool.connect();
  try {
    const result = await connection.queryObject<T>(sql, args);
    return result.rows;
  } finally {
    connection.release();
  }
}

export async function queryOne<T>(sql: string, args?: unknown[]): Promise<T | null> {
  const rows = await query<T>(sql, args);
  return rows[0] ?? null;
}

export async function execute(sql: string, args?: unknown[]): Promise<number> {
  const pool = getPool();
  const connection = await pool.connect();
  try {
    const result = await connection.queryObject(sql, args);
    return result.rowCount ?? 0;
  } finally {
    connection.release();
  }
}

// Transaction helper
export async function transaction<T>(
  fn: (query: typeof query, execute: typeof execute) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const connection = await pool.connect();
  try {
    await connection.queryObject('BEGIN');
    const boundQuery = async <U>(sql: string, args?: unknown[]): Promise<U[]> => {
      const result = await connection.queryObject<U>(sql, args);
      return result.rows;
    };
    const boundExecute = async (sql: string, args?: unknown[]): Promise<number> => {
      const result = await connection.queryObject(sql, args);
      return result.rowCount ?? 0;
    };
    const result = await fn(boundQuery, boundExecute);
    await connection.queryObject('COMMIT');
    return result;
  } catch (error) {
    await connection.queryObject('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
