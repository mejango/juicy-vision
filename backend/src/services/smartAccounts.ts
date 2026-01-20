/**
 * Smart Accounts Service
 *
 * ERC-4337 compatible smart contract wallets for managed users.
 * Key features:
 * - Deterministic addresses via CREATE2 (valid before deployment)
 * - Lazy deployment (only deploy when user takes action)
 * - Gas sponsorship via paymaster for managed accounts only
 * - One-transaction custody transfer to user's EOA
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  keccak256,
  encodeAbiParameters,
  concat,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, optimism, arbitrum, base } from 'viem/chains';
import { query, queryOne, execute, transaction } from '../db/index.ts';
import { logger } from '../utils/logger.ts';
import { getConfig } from '../utils/config.ts';

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
  1: 'https://eth.llamarpc.com',
  10: 'https://optimism.llamarpc.com',
  8453: 'https://base.llamarpc.com',
  42161: 'https://arbitrum.llamarpc.com',
};

// ============================================================================
// Smart Account Factory (SimpleAccount from eth-infinitism)
// ============================================================================

// Using eth-infinitism's SimpleAccount for ERC-4337 compatibility
// These addresses are the same across all EVM chains via CREATE2
const SIMPLE_ACCOUNT_FACTORY = '0x9406Cc6185a346906296840746125a0E44976454' as const;
const ENTRY_POINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const; // v0.7

// Factory ABI for creating accounts
const FACTORY_ABI = [
  {
    name: 'createAccount',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: 'ret', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getAddress',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

// SimpleAccount ABI for transfers and ownership
const SIMPLE_ACCOUNT_ABI = [
  {
    name: 'execute',
    type: 'function',
    inputs: [
      { name: 'dest', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'func', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'executeBatch',
    type: 'function',
    inputs: [
      { name: 'dest', type: 'address[]' },
      { name: 'value', type: 'uint256[]' },
      { name: 'func', type: 'bytes[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'transferOwnership',
    type: 'function',
    inputs: [{ name: 'newOwner', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'owner',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

// ERC20 ABI for token transfers
const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// ============================================================================
// Types
// ============================================================================

interface SmartAccount {
  id: string;
  userId: string;
  chainId: number;
  address: Address;
  salt: string;
  deployed: boolean;
  custodyStatus: 'managed' | 'transferring' | 'self_custody';
  ownerAddress: Address | null;
}

interface DbSmartAccount {
  id: string;
  user_id: string;
  chain_id: number;
  address: string;
  salt: string;
  deployed: boolean;
  deploy_tx_hash: string | null;
  deployed_at: Date | null;
  custody_status: string;
  owner_address: string | null;
  custody_transferred_at: Date | null;
}

// ============================================================================
// Helpers
// ============================================================================

function getPublicClient(chainId: number) {
  const chain = CHAINS[chainId as keyof typeof CHAINS];
  if (!chain) throw new Error(`Unsupported chain: ${chainId}`);

  return createPublicClient({
    chain,
    transport: http(RPC_URLS[chainId]),
  });
}

function getWalletClient(chainId: number, privateKey: `0x${string}`) {
  const chain = CHAINS[chainId as keyof typeof CHAINS];
  if (!chain) throw new Error(`Unsupported chain: ${chainId}`);

  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain,
    transport: http(RPC_URLS[chainId]),
  });
}

/**
 * Generate a deterministic salt from user ID
 * This ensures the same user gets the same address across deployments
 */
function generateSalt(userId: string): bigint {
  const hash = keccak256(
    encodeAbiParameters([{ type: 'string' }], [`juicy-vision:${userId}`])
  );
  return BigInt(hash);
}

/**
 * Compute the smart account address without deploying
 * Uses CREATE2 deterministic addressing
 */
async function computeSmartAccountAddress(
  chainId: number,
  ownerAddress: Address,
  salt: bigint
): Promise<Address> {
  const client = getPublicClient(chainId);

  const address = await client.readContract({
    address: SIMPLE_ACCOUNT_FACTORY,
    abi: FACTORY_ABI,
    functionName: 'getAddress',
    args: [ownerAddress, salt],
  });

  return address;
}

/**
 * Check if a smart account is deployed (has code)
 */
async function isAccountDeployed(
  chainId: number,
  address: Address
): Promise<boolean> {
  const client = getPublicClient(chainId);
  const code = await client.getCode({ address });
  return code !== undefined && code !== '0x';
}

// ============================================================================
// Smart Account Management
// ============================================================================

/**
 * Get or create a smart account for a user on a specific chain
 * Does NOT deploy - just computes the deterministic address
 */
export async function getOrCreateSmartAccount(
  userId: string,
  chainId: number
): Promise<SmartAccount> {
  // Check if we already have this account in DB
  const existing = await queryOne<DbSmartAccount>(
    `SELECT * FROM user_smart_accounts WHERE user_id = $1 AND chain_id = $2`,
    [userId, chainId]
  );

  if (existing) {
    return {
      id: existing.id,
      userId: existing.user_id,
      chainId: existing.chain_id,
      address: existing.address as Address,
      salt: existing.salt,
      deployed: existing.deployed,
      custodyStatus: existing.custody_status as SmartAccount['custodyStatus'],
      ownerAddress: existing.owner_address as Address | null,
    };
  }

  // Compute new account address
  const config = getConfig();
  const systemKey = config.reservesPrivateKey as `0x${string}`;
  if (!systemKey) throw new Error('RESERVES_PRIVATE_KEY not configured');

  const systemAccount = privateKeyToAccount(systemKey);
  const salt = generateSalt(userId);
  const address = await computeSmartAccountAddress(
    chainId,
    systemAccount.address,
    salt
  );

  // Store in database
  const [row] = await query<DbSmartAccount>(
    `INSERT INTO user_smart_accounts (user_id, chain_id, address, salt)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, chainId, address, salt.toString()]
  );

  logger.info('Created smart account record', {
    userId,
    chainId,
    address,
    salt: salt.toString(),
  });

  return {
    id: row.id,
    userId: row.user_id,
    chainId: row.chain_id,
    address: row.address as Address,
    salt: row.salt,
    deployed: false,
    custodyStatus: 'managed',
    ownerAddress: null,
  };
}

/**
 * Get all smart accounts for a user
 */
export async function getUserSmartAccounts(userId: string): Promise<SmartAccount[]> {
  const rows = await query<DbSmartAccount>(
    `SELECT * FROM user_smart_accounts WHERE user_id = $1`,
    [userId]
  );

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    chainId: r.chain_id,
    address: r.address as Address,
    salt: r.salt,
    deployed: r.deployed,
    custodyStatus: r.custody_status as SmartAccount['custodyStatus'],
    ownerAddress: r.owner_address as Address | null,
  }));
}

/**
 * Deploy a smart account (lazy deployment)
 * Called when user takes an action requiring the contract to exist
 */
export async function deploySmartAccount(
  userId: string,
  chainId: number
): Promise<{ txHash: Hash; address: Address }> {
  const account = await getOrCreateSmartAccount(userId, chainId);

  if (account.deployed) {
    logger.debug('Smart account already deployed', {
      userId,
      chainId,
      address: account.address,
    });
    return { txHash: '0x' as Hash, address: account.address };
  }

  // Check if already deployed on-chain (might have been deployed externally)
  const alreadyDeployed = await isAccountDeployed(chainId, account.address);
  if (alreadyDeployed) {
    await execute(
      `UPDATE user_smart_accounts
       SET deployed = TRUE, deployed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [account.id]
    );
    logger.info('Smart account was already deployed on-chain', {
      userId,
      chainId,
      address: account.address,
    });
    return { txHash: '0x' as Hash, address: account.address };
  }

  // Deploy the account
  const config = getConfig();
  const systemKey = config.reservesPrivateKey as `0x${string}`;
  if (!systemKey) throw new Error('RESERVES_PRIVATE_KEY not configured');

  const systemAccount = privateKeyToAccount(systemKey);
  const walletClient = getWalletClient(chainId, systemKey);
  const salt = BigInt(account.salt);

  const txHash = await walletClient.writeContract({
    address: SIMPLE_ACCOUNT_FACTORY,
    abi: FACTORY_ABI,
    functionName: 'createAccount',
    args: [systemAccount.address, salt],
  });

  // Wait for deployment
  const publicClient = getPublicClient(chainId);
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Update database
  await execute(
    `UPDATE user_smart_accounts
     SET deployed = TRUE, deploy_tx_hash = $1, deployed_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [txHash, account.id]
  );

  logger.info('Deployed smart account', {
    userId,
    chainId,
    address: account.address,
    txHash,
  });

  return { txHash, address: account.address };
}

/**
 * Ensure account is deployed before taking action
 * Returns the account address (deploying if needed)
 */
async function ensureDeployed(
  userId: string,
  chainId: number
): Promise<Address> {
  const account = await getOrCreateSmartAccount(userId, chainId);

  if (!account.deployed) {
    await deploySmartAccount(userId, chainId);
  }

  return account.address;
}

// ============================================================================
// Withdrawals (Gas-sponsored for managed accounts)
// ============================================================================

/**
 * Request a withdrawal from a managed smart account
 * System executes the withdrawal and sponsors gas
 */
export async function requestWithdrawal(params: {
  userId: string;
  chainId: number;
  tokenAddress: Address;
  amount: bigint;
  toAddress: Address;
}): Promise<{ withdrawalId: string; txHash: Hash }> {
  const { userId, chainId, tokenAddress, amount, toAddress } = params;

  // Get account and verify it's managed
  const account = await getOrCreateSmartAccount(userId, chainId);

  if (account.custodyStatus !== 'managed') {
    throw new Error('Account is not managed - use your own wallet to withdraw');
  }

  // Ensure deployed
  const accountAddress = await ensureDeployed(userId, chainId);

  // Verify balance
  const publicClient = getPublicClient(chainId);
  const isNative = tokenAddress === '0x0000000000000000000000000000000000000000';

  let balance: bigint;
  if (isNative) {
    balance = await publicClient.getBalance({ address: accountAddress });
  } else {
    balance = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [accountAddress],
    });
  }

  if (balance < amount) {
    throw new Error(`Insufficient balance: have ${balance}, need ${amount}`);
  }

  // Create withdrawal record
  const [withdrawal] = await query<{ id: string }>(
    `INSERT INTO smart_account_withdrawals
     (smart_account_id, token_address, amount, to_address, status)
     VALUES ($1, $2, $3, $4, 'processing')
     RETURNING id`,
    [account.id, tokenAddress, amount.toString(), toAddress]
  );

  try {
    // Execute withdrawal via the smart account
    const config = getConfig();
    const systemKey = config.reservesPrivateKey as `0x${string}`;
    const walletClient = getWalletClient(chainId, systemKey);

    let txHash: Hash;

    if (isNative) {
      // Native ETH transfer
      txHash = await walletClient.writeContract({
        address: accountAddress,
        abi: SIMPLE_ACCOUNT_ABI,
        functionName: 'execute',
        args: [toAddress, amount, '0x'],
      });
    } else {
      // ERC20 transfer
      const transferData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [toAddress, amount],
      });

      txHash = await walletClient.writeContract({
        address: accountAddress,
        abi: SIMPLE_ACCOUNT_ABI,
        functionName: 'execute',
        args: [tokenAddress, 0n, transferData],
      });
    }

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Update withdrawal record
    await execute(
      `UPDATE smart_account_withdrawals
       SET status = 'completed', tx_hash = $1, executed_at = NOW(),
           gas_cost_wei = $2
       WHERE id = $3`,
      [txHash, receipt.gasUsed.toString(), withdrawal.id]
    );

    logger.info('Withdrawal completed', {
      withdrawalId: withdrawal.id,
      userId,
      chainId,
      tokenAddress,
      amount: amount.toString(),
      toAddress,
      txHash,
    });

    return { withdrawalId: withdrawal.id, txHash };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await execute(
      `UPDATE smart_account_withdrawals
       SET status = 'failed', error_message = $1
       WHERE id = $2`,
      [errorMessage, withdrawal.id]
    );

    logger.error('Withdrawal failed', error as Error, {
      withdrawalId: withdrawal.id,
      userId,
      chainId,
    });

    throw error;
  }
}

/**
 * Get user's withdrawal history
 */
export async function getUserWithdrawals(
  userId: string
): Promise<
  Array<{
    id: string;
    chainId: number;
    tokenAddress: string;
    amount: string;
    toAddress: string;
    status: string;
    txHash: string | null;
    createdAt: Date;
  }>
> {
  const rows = await query<{
    id: string;
    chain_id: number;
    token_address: string;
    amount: string;
    to_address: string;
    status: string;
    tx_hash: string | null;
    created_at: string;
  }>(
    `SELECT w.id, sa.chain_id, w.token_address, w.amount, w.to_address,
            w.status, w.tx_hash, w.created_at
     FROM smart_account_withdrawals w
     JOIN user_smart_accounts sa ON sa.id = w.smart_account_id
     WHERE sa.user_id = $1
     ORDER BY w.created_at DESC`,
    [userId]
  );

  return rows.map((r) => ({
    id: r.id,
    chainId: r.chain_id,
    tokenAddress: r.token_address,
    amount: r.amount,
    toAddress: r.to_address,
    status: r.status,
    txHash: r.tx_hash,
    createdAt: new Date(r.created_at),
  }));
}

// ============================================================================
// Custody Transfer
// ============================================================================

/**
 * Transfer custody of a smart account to user's EOA
 * After this, the user controls the account and must pay their own gas
 */
export async function transferCustody(
  userId: string,
  chainId: number,
  newOwnerAddress: Address
): Promise<{ txHash: Hash }> {
  const account = await getOrCreateSmartAccount(userId, chainId);

  if (account.custodyStatus !== 'managed') {
    throw new Error('Account custody has already been transferred');
  }

  // Ensure deployed before transfer
  const accountAddress = await ensureDeployed(userId, chainId);

  // Mark as transferring
  await execute(
    `UPDATE user_smart_accounts
     SET custody_status = 'transferring', updated_at = NOW()
     WHERE id = $1`,
    [account.id]
  );

  try {
    const config = getConfig();
    const systemKey = config.reservesPrivateKey as `0x${string}`;
    const walletClient = getWalletClient(chainId, systemKey);
    const publicClient = getPublicClient(chainId);

    // Transfer ownership
    const txHash = await walletClient.writeContract({
      address: accountAddress,
      abi: SIMPLE_ACCOUNT_ABI,
      functionName: 'transferOwnership',
      args: [newOwnerAddress],
    });

    await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Update database
    await execute(
      `UPDATE user_smart_accounts
       SET custody_status = 'self_custody',
           owner_address = $1,
           custody_transferred_at = NOW(),
           custody_transfer_tx_hash = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [newOwnerAddress, txHash, account.id]
    );

    logger.info('Custody transferred', {
      userId,
      chainId,
      accountAddress,
      newOwnerAddress,
      txHash,
    });

    return { txHash };
  } catch (error) {
    // Revert status on failure
    await execute(
      `UPDATE user_smart_accounts
       SET custody_status = 'managed', updated_at = NOW()
       WHERE id = $1`,
      [account.id]
    );

    logger.error('Custody transfer failed', error as Error, {
      userId,
      chainId,
    });

    throw error;
  }
}

// ============================================================================
// Balance Syncing
// ============================================================================

/**
 * Sync token balances for a smart account from chain
 */
export async function syncAccountBalances(
  accountId: string,
  chainId: number,
  address: Address,
  tokenAddresses: Address[]
): Promise<void> {
  const publicClient = getPublicClient(chainId);

  for (const tokenAddress of tokenAddresses) {
    try {
      const isNative = tokenAddress === '0x0000000000000000000000000000000000000000';
      let balance: bigint;
      let symbol: string;
      let decimals: number;

      if (isNative) {
        balance = await publicClient.getBalance({ address });
        symbol = 'ETH';
        decimals = 18;
      } else {
        balance = await publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        // TODO: Fetch symbol and decimals from token contract
        symbol = 'TOKEN';
        decimals = 18;
      }

      // Upsert balance
      await execute(
        `INSERT INTO smart_account_balances
         (smart_account_id, token_address, token_symbol, token_decimals, balance, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (smart_account_id, token_address)
         DO UPDATE SET balance = $5, last_synced_at = NOW()`,
        [accountId, tokenAddress, symbol, decimals, balance.toString()]
      );
    } catch (error) {
      logger.error('Failed to sync balance', error as Error, {
        accountId,
        chainId,
        tokenAddress,
      });
    }
  }
}

/**
 * Get cached balances for a smart account
 */
export async function getAccountBalances(
  userId: string,
  chainId: number
): Promise<
  Array<{
    tokenAddress: string;
    tokenSymbol: string;
    balance: string;
    decimals: number;
  }>
> {
  const rows = await query<{
    token_address: string;
    token_symbol: string;
    balance: string;
    token_decimals: number;
  }>(
    `SELECT b.token_address, b.token_symbol, b.balance, b.token_decimals
     FROM smart_account_balances b
     JOIN user_smart_accounts sa ON sa.id = b.smart_account_id
     WHERE sa.user_id = $1 AND sa.chain_id = $2
     AND b.balance != '0'`,
    [userId, chainId]
  );

  return rows.map((r) => ({
    tokenAddress: r.token_address,
    tokenSymbol: r.token_symbol,
    balance: r.balance,
    decimals: r.token_decimals,
  }));
}

// ============================================================================
// Project Role Tracking
// ============================================================================

/**
 * Record that a smart account was set as a project recipient
 */
export async function recordProjectRole(params: {
  smartAccountId: string;
  projectId: number;
  chainId: number;
  roleType: 'payout_recipient' | 'reserved_recipient' | 'operator';
  splitGroup?: number;
  percentBps?: number;
  txHash?: string;
}): Promise<void> {
  await execute(
    `INSERT INTO smart_account_project_roles
     (smart_account_id, project_id, chain_id, role_type, split_group, percent_bps, set_tx_hash, set_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      params.smartAccountId,
      params.projectId,
      params.chainId,
      params.roleType,
      params.splitGroup || null,
      params.percentBps || null,
      params.txHash || null,
    ]
  );

  logger.info('Recorded project role', params);
}

/**
 * Get all project roles for a user's smart accounts
 */
export async function getUserProjectRoles(
  userId: string
): Promise<
  Array<{
    projectId: number;
    chainId: number;
    roleType: string;
    percentBps: number | null;
    active: boolean;
  }>
> {
  const rows = await query<{
    project_id: number;
    chain_id: number;
    role_type: string;
    percent_bps: number | null;
    active: boolean;
  }>(
    `SELECT r.project_id, r.chain_id, r.role_type, r.percent_bps, r.active
     FROM smart_account_project_roles r
     JOIN user_smart_accounts sa ON sa.id = r.smart_account_id
     WHERE sa.user_id = $1
     ORDER BY r.created_at DESC`,
    [userId]
  );

  return rows.map((r) => ({
    projectId: r.project_id,
    chainId: r.chain_id,
    roleType: r.role_type,
    percentBps: r.percent_bps,
    active: r.active,
  }));
}
