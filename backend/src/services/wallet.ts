import { createPublicClient, createWalletClient, http, parseEther, parseUnits, formatEther, formatUnits, encodeFunctionData, type Address, type Hash, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, optimism, base, arbitrum } from 'viem/chains';
import { query, queryOne, execute } from '../db/index.ts';
import { getConfig } from '../utils/config.ts';
import type { WalletBalance, PendingTransfer } from '../types/index.ts';

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
const USDC_ADDRESSES: Record<number, Address> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
};

// 7 days in milliseconds (transfer finalization period)
const TRANSFER_HOLD_DAYS = 7;
const TRANSFER_HOLD_MS = TRANSFER_HOLD_DAYS * 24 * 60 * 60 * 1000;

// ============================================================================
// Reserves Wallet Operations
// ============================================================================

// NOTE: getCustodialAddress was removed - it was broken and deprecated.
// Use getOrCreateSmartAccount from smartAccounts.ts for per-user wallet addresses.

// Sign and broadcast a transaction using the reserves wallet
export async function signAndBroadcast(
  chainId: number,
  to: Address,
  data: `0x${string}`,
  value: bigint = 0n
): Promise<Hash> {
  const config = getConfig();
  if (!config.reservesPrivateKey) {
    throw new Error('RESERVES_PRIVATE_KEY not configured');
  }

  const account = privateKeyToAccount(config.reservesPrivateKey as `0x${string}`);

  const chain = CHAINS[chainId as keyof typeof CHAINS];
  if (!chain) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URLS[chainId]),
  });

  const hash = await walletClient.sendTransaction({
    to,
    data,
    value,
  });

  return hash;
}

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
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
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

export async function getTokenBalance(
  address: Address,
  chainId: number,
  tokenAddress: Address
): Promise<{ balance: bigint; decimals: number; symbol: string }> {
  const client = getPublicClient(chainId);

  // Native token (ETH)
  if (tokenAddress === '0x0000000000000000000000000000000000000000') {
    const balance = await client.getBalance({ address });
    return { balance, decimals: 18, symbol: 'ETH' };
  }

  // ERC20 token
  const [balance, decimals, symbol] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address],
    }),
    client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'decimals',
    }),
    client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'symbol',
    }),
  ]);

  return { balance, decimals, symbol };
}

// Bendystraw GraphQL endpoint
const BENDYSTRAW_ENDPOINT = 'https://api.bendystraw.xyz/graphql';

// Query to get user's token holdings across all projects
const USER_HOLDINGS_QUERY = `
  query UserHoldings($address: String!, $chainId: Int!) {
    participants(
      where: { address: $address, chainId: $chainId }
      orderBy: "balance"
      orderDirection: "desc"
      limit: 100
    ) {
      items {
        projectId
        balance
        volume
        project {
          metadata {
            name
          }
          handle
        }
      }
    }
  }
`;

interface BendystrawParticipant {
  projectId: number;
  balance: string;
  volume: string;
  project?: {
    metadata?: {
      name?: string;
    };
    handle?: string;
  };
}

interface BendystrawResponse {
  data?: {
    participants?: {
      items?: BendystrawParticipant[];
    };
  };
  errors?: Array<{ message: string }>;
}

// Get all JB project token balances for a user via Bendystraw
export async function getProjectTokenBalances(
  address: Address,
  chainId: number
): Promise<WalletBalance[]> {
  try {
    const response = await fetch(BENDYSTRAW_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: USER_HOLDINGS_QUERY,
        variables: {
          address: address.toLowerCase(),
          chainId,
        },
      }),
    });

    if (!response.ok) {
      console.error('Bendystraw request failed:', response.status);
      return [];
    }

    const result = await response.json() as BendystrawResponse;

    if (result.errors) {
      console.error('Bendystraw query errors:', result.errors);
      return [];
    }

    const participants = result.data?.participants?.items || [];

    // Filter out zero balances and map to WalletBalance format
    return participants
      .filter(p => BigInt(p.balance) > 0n)
      .map(p => {
        const projectName = p.project?.metadata?.name || p.project?.handle || `Project #${p.projectId}`;
        return {
          chainId,
          tokenAddress: `jb:${p.projectId}`, // Special prefix for JB project tokens
          tokenSymbol: projectName.slice(0, 10), // Truncate for display
          balance: p.balance,
          tokenDecimals: 18, // JB tokens use 18 decimals
          isProjectToken: true,
          projectId: p.projectId,
        };
      });
  } catch (err) {
    console.error('Failed to fetch JB token balances:', err);
    return [];
  }
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

// NOTE: requestTransfer was removed - it used the broken getCustodialAddress function.
// For new transfer functionality, implement using smart accounts (ERC-4337).
// See requestWithdrawal in smartAccounts.ts for the correct pattern.

export async function getUserPendingTransfers(userId: string): Promise<PendingTransfer[]> {
  const results = await query<DbPendingTransfer>(
    `SELECT * FROM pending_transfers
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
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
    [transferId, userId]
  );

  if (result === 0) {
    throw new Error('Transfer not found or cannot be cancelled');
  }
}

// Execute transfers that have passed the 7-day hold
export async function executeReadyTransfers(): Promise<number> {
  // Mark ready transfers
  await execute(
    `UPDATE pending_transfers
     SET status = 'ready'
     WHERE status = 'pending' AND available_at <= NOW()`
  );

  // Get ready transfers with user info
  const readyTransfers = await query<DbPendingTransfer & { custodial_address_index: number }>(
    `SELECT pt.*, u.custodial_address_index
     FROM pending_transfers pt
     JOIN users u ON u.id = pt.user_id
     WHERE pt.status = 'ready'`
  );

  let executed = 0;

  for (const transfer of readyTransfers) {
    try {
      // Execute the transfer
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [transfer.to_address as Address, BigInt(transfer.amount)],
      });

      const txHash = await signAndBroadcast(
        transfer.chain_id,
        transfer.token_address as Address,
        data
      );

      // Update transfer record
      await execute(
        `UPDATE pending_transfers
         SET status = 'executed', tx_hash = $1, executed_at = NOW()
         WHERE id = $2`,
        [txHash, transfer.id]
      );

      executed++;
    } catch (error) {
      console.error(`Failed to execute transfer ${transfer.id}:`, error);
      // Don't update status - will retry on next run
    }
  }

  return executed;
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
