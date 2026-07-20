import { type Address, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum, base, mainnet, optimism } from 'viem/chains';
import { CANONICAL_USDC_BY_CHAIN } from '@shared/chains.ts';
import { execute, query } from '../db/index.ts';
import { getConfig } from '../utils/config.ts';
import type { PendingTransfer } from '../types/index.ts';

// ============================================================================
// Chain Configuration
// ============================================================================

const CHAINS = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
} as const;

const RPC_URLS: Record<number, string> = {
  1: 'https://rpc.ankr.com/eth',
  10: 'https://rpc.ankr.com/optimism',
  8453: 'https://rpc.ankr.com/base',
  42161: 'https://rpc.ankr.com/arbitrum',
};

// USDC addresses per chain
const USDC_ADDRESSES = CANONICAL_USDC_BY_CHAIN as Record<number, Address>;

// ============================================================================
// Balance Queries
// ============================================================================

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

function getPublicClient(chainId: number) {
  const chain = CHAINS[chainId as keyof typeof CHAINS];
  if (!chain) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  return createPublicClient({
    chain,
    transport: http(RPC_URLS[chainId]),
  });
}

// ============================================================================
// Transfer Management (7-day hold for payment finalization)
// ============================================================================

interface DbPendingTransfer {
  id: string;
  user_id: string;
  chain_id: number;
  token_address: string;
  token_symbol: string;
  amount: string;
  to_address: string;
  status: 'pending' | 'ready' | 'executed' | 'cancelled';
  tx_hash: string | null;
  created_at: Date;
  available_at: Date;
  executed_at: Date | null;
}

// NOTE: this legacy transfer writer was removed. Managed-account transfers use
// the delayed, allowlisted path in smartAccounts.ts.

export async function getUserPendingTransfers(userId: string): Promise<PendingTransfer[]> {
  const results = await query<DbPendingTransfer>(
    `SELECT * FROM pending_transfers
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );

  return results.map((t) => ({
    id: t.id,
    userId: t.user_id,
    chainId: t.chain_id,
    tokenAddress: t.token_address,
    tokenSymbol: t.token_symbol,
    amount: t.amount,
    toAddress: t.to_address,
    createdAt: t.created_at,
    availableAt: t.available_at,
    status: t.status,
    txHash: t.tx_hash ?? undefined,
  }));
}

export async function cancelTransfer(transferId: string, userId: string): Promise<void> {
  const result = await execute(
    `UPDATE pending_transfers
     SET status = 'cancelled'
     WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
    [transferId, userId],
  );

  if (result === 0) {
    throw new Error('Transfer not found or cannot be cancelled');
  }
}

// ============================================================================
// Reserves Wallet (for fiat-to-crypto payments)
// ============================================================================

export async function getReservesBalance(chainId: number): Promise<{
  eth: bigint;
  usdc: bigint;
}> {
  const config = getConfig();
  if (!config.reservesPrivateKey) {
    throw new Error('Reserves wallet not configured');
  }

  const account = privateKeyToAccount(config.reservesPrivateKey as `0x${string}`);
  const client = getPublicClient(chainId);

  const [ethBalance, usdcBalance] = await Promise.all([
    client.getBalance({ address: account.address }),
    USDC_ADDRESSES[chainId]
      ? client.readContract({
        address: USDC_ADDRESSES[chainId],
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account.address],
      })
      : 0n,
  ]);

  return {
    eth: ethBalance,
    usdc: usdcBalance,
  };
}

export function getReservesAddress(): Address {
  const config = getConfig();
  if (!config.reservesPrivateKey) {
    throw new Error('Reserves wallet not configured');
  }

  const account = privateKeyToAccount(config.reservesPrivateKey as `0x${string}`);
  return account.address;
}
