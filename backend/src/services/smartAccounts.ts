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
  type Address,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  type Hash,
  type Hex,
  http,
  keccak256,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  sepolia,
} from 'viem/chains';
import { CANONICAL_USDC_BY_CHAIN, DEAD_ADDRESS as SHARED_DEAD_ADDRESS } from '@shared/chains.ts';
import { execute, query, queryOne } from '../db/index.ts';
import { logger } from '../utils/logger.ts';
import { getConfig } from '../utils/config.ts';

// ============================================================================
// Chain Configuration
// ============================================================================

const CHAINS = {
  // Mainnets
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
  // Testnets
  11155111: sepolia,
  11155420: optimismSepolia,
  84532: baseSepolia,
  421614: arbitrumSepolia,
} as const;

// Ankr chain slugs for premium RPC
const ANKR_SLUGS: Record<number, string> = {
  1: 'eth',
  10: 'optimism',
  8453: 'base',
  42161: 'arbitrum',
  11155111: 'eth_sepolia',
  11155420: 'optimism_sepolia',
  84532: 'base_sepolia',
  421614: 'arbitrum_sepolia',
};

// Fallback public RPC endpoints (used when no API key configured)
const FALLBACK_RPC_URLS: Record<number, string> = {
  // Mainnets
  1: 'https://ethereum.publicnode.com',
  10: 'https://mainnet.optimism.io',
  8453: 'https://mainnet.base.org',
  42161: 'https://arb1.arbitrum.io/rpc',
  // Testnets
  11155111: 'https://sepolia.drpc.org',
  11155420: 'https://optimism-sepolia.drpc.org',
  84532: 'https://base-sepolia.drpc.org',
  421614: 'https://arbitrum-sepolia.drpc.org',
};

const NATIVE_WALLET_TOKEN = '0x0000000000000000000000000000000000000000' as Address;
const DEAD_ADDRESS = SHARED_DEAD_ADDRESS.toLowerCase() as Address;
const USDC_BY_CHAIN = CANONICAL_USDC_BY_CHAIN as Record<number, Address>;

function requireRecognizedWalletToken(chainId: number, tokenAddress: Address): 'ETH' | 'USDC' {
  const normalized = tokenAddress.toLowerCase();
  if (normalized === NATIVE_WALLET_TOKEN) return 'ETH';
  if (normalized === USDC_BY_CHAIN[chainId]?.toLowerCase()) return 'USDC';
  throw new Error(`Wallet token not recognized on chain ${chainId}: ${tokenAddress}`);
}

// Get RPC URL for chain, preferring Ankr with API key
function getRpcUrl(chainId: number): string {
  const config = getConfig();
  const slug = ANKR_SLUGS[chainId];

  if (config.ankrApiKey && slug) {
    return `https://rpc.ankr.com/${slug}/${config.ankrApiKey}`;
  }

  return FALLBACK_RPC_URLS[chainId] || `https://rpc.ankr.com/${slug || 'eth'}`;
}

// ============================================================================
// Smart Account Factory (SimpleAccount from eth-infinitism)
// ============================================================================

// ForwardableSimpleAccountFactory: SimpleAccount + ERC2771Context
// Deployed via CREATE2 (deterministic deployer) - same address on all EVM chains
const SIMPLE_ACCOUNT_FACTORY = '0x69a05d911af23501ff9d6b811a97cac972dade05' as const;
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
    transport: http(getRpcUrl(chainId)),
  });
}

function getWalletClient(chainId: number, privateKey: `0x${string}`) {
  const chain = CHAINS[chainId as keyof typeof CHAINS];
  if (!chain) throw new Error(`Unsupported chain: ${chainId}`);

  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain,
    transport: http(getRpcUrl(chainId)),
  });
}

/**
 * Generate a deterministic salt from user ID
 * This ensures the same user gets the same address across deployments
 */
function generateSalt(userId: string): bigint {
  const hash = keccak256(
    encodeAbiParameters([{ type: 'string' }], [`juicy-vision:${userId}`]),
  );
  return BigInt(hash);
}

/**
 * Compute the smart account address without deploying.
 * Calls the factory's getAddress() which uses CREATE2 to deterministically
 * derive the proxy address from owner + salt + implementation.
 * Address is the same across all chains (same factory, same implementation).
 */
async function computeSmartAccountAddress(
  chainId: number,
  ownerAddress: Address,
  salt: bigint,
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

/** Derive the canonical account address for a user and account owner. */
export function deriveSmartAccountAddress(
  userId: string,
  chainId: number,
  ownerAddress: Address,
): Promise<Address> {
  return computeSmartAccountAddress(chainId, ownerAddress, generateSalt(userId));
}

/**
 * Check if a smart account is deployed (has code)
 */
async function isAccountDeployed(
  chainId: number,
  address: Address,
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
  chainId: number,
): Promise<SmartAccount> {
  // Check if we already have this account in DB
  const existing = await queryOne<DbSmartAccount>(
    `SELECT * FROM user_smart_accounts WHERE user_id = $1 AND chain_id = $2`,
    [userId, chainId],
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
    salt,
  );

  // Store in database - salt as hex string (fits in varchar(66) as 0x + 64 hex chars)
  // Use ON CONFLICT to handle race conditions (multiple concurrent requests)
  // The unique constraint is on (chain_id, address) to prevent same address on same chain
  const saltHex = '0x' + salt.toString(16).padStart(64, '0');

  try {
    const [row] = await query<DbSmartAccount>(
      `INSERT INTO user_smart_accounts (user_id, chain_id, address, salt)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, chainId, address, saltHex],
    );

    logger.info('Created smart account record', {
      userId,
      chainId,
      address,
      salt: saltHex,
    });

    return {
      id: row.id,
      userId: row.user_id,
      chainId: row.chain_id,
      address: row.address as Address,
      salt: row.salt,
      deployed: row.deployed,
      custodyStatus: row.custody_status as SmartAccount['custodyStatus'],
      ownerAddress: row.owner_address as Address | null,
    };
  } catch (error) {
    // Handle race condition: if another request already inserted, fetch the existing record
    // SECURITY: Always include userId in query to ensure we only return the correct user's account
    if (error instanceof Error && error.message.includes('duplicate key')) {
      logger.debug('Smart account already exists (race condition), fetching existing', {
        userId,
        chainId,
        address,
      });

      const existingRow = await queryOne<DbSmartAccount>(
        `SELECT * FROM user_smart_accounts WHERE user_id = $1 AND chain_id = $2`,
        [userId, chainId],
      );

      if (existingRow) {
        // SECURITY: Verify the fetched account belongs to this user
        if (existingRow.user_id !== userId) {
          logger.error('Smart account user mismatch', new Error('Account user ID does not match'), {
            expectedUserId: userId,
            actualUserId: existingRow.user_id,
            chainId,
            address,
          });
          throw new Error('Smart account ownership mismatch');
        }

        return {
          id: existingRow.id,
          userId: existingRow.user_id,
          chainId: existingRow.chain_id,
          address: existingRow.address as Address,
          salt: existingRow.salt,
          deployed: existingRow.deployed,
          custodyStatus: existingRow.custody_status as SmartAccount['custodyStatus'],
          ownerAddress: existingRow.owner_address as Address | null,
        };
      }
    }
    throw error;
  }
}

/**
 * Get all smart accounts for a user
 */
export async function getUserSmartAccounts(userId: string): Promise<SmartAccount[]> {
  const rows = await query<DbSmartAccount>(
    `SELECT * FROM user_smart_accounts WHERE user_id = $1`,
    [userId],
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
  chainId: number,
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
      [account.id],
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
  const publicClient = getPublicClient(chainId);
  const salt = BigInt(account.salt);

  await publicClient.simulateContract({
    account: systemAccount.address,
    address: SIMPLE_ACCOUNT_FACTORY,
    abi: FACTORY_ABI,
    functionName: 'createAccount',
    args: [systemAccount.address, salt],
  });

  const txHash = await walletClient.writeContract({
    address: SIMPLE_ACCOUNT_FACTORY,
    abi: FACTORY_ABI,
    functionName: 'createAccount',
    args: [systemAccount.address, salt],
  });

  // Wait for deployment
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') throw new Error('Smart account deployment reverted');
  if (!await isAccountDeployed(chainId, account.address)) {
    throw new Error('Smart account factory did not deploy the expected account');
  }

  // Update database
  await execute(
    `UPDATE user_smart_accounts
     SET deployed = TRUE, deploy_tx_hash = $1, deployed_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [txHash, account.id],
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
export async function ensureDeployed(
  userId: string,
  chainId: number,
): Promise<Address> {
  const account = await getOrCreateSmartAccount(userId, chainId);

  if (!account.deployed) {
    await deploySmartAccount(userId, chainId);
  }

  return account.address;
}

/**
 * Get the factory deployment transaction data for a user's smart account.
 * Used by Relayr bundle creation to include deployment in gas-sponsored bundles.
 * createAccount is idempotent - if already deployed, it returns early with no effect.
 */
export function getFactoryDeployData(
  ownerAddress: Address,
  userId: string,
): { target: Address; data: Hex } {
  const salt = generateSalt(userId);
  return {
    target: SIMPLE_ACCOUNT_FACTORY as Address,
    data: encodeFunctionData({
      abi: FACTORY_ABI,
      functionName: 'createAccount',
      args: [ownerAddress, salt],
    }),
  };
}

// ============================================================================
// Transaction Execution (Gas-sponsored for managed accounts)
// ============================================================================

/**
 * Execute a transaction approved by the managed-wallet policy via the smart account.
 * System sponsors gas for managed accounts
 * Callers must run assertManagedTransactionAllowed before entering this service.
 */
export async function executeTransaction(params: {
  userId: string;
  chainId: number;
  to: Address;
  data: `0x${string}`;
  value?: bigint;
}): Promise<{ txHash: Hash; accountAddress: Address }> {
  const { userId, chainId, to, data, value = 0n } = params;

  // Get account and verify it's managed
  const account = await getOrCreateSmartAccount(userId, chainId);

  if (account.custodyStatus !== 'managed') {
    throw new Error('Account is not managed - use your own wallet');
  }

  // Ensure deployed
  const accountAddress = await ensureDeployed(userId, chainId);

  // Check if account has enough ETH for the value (if sending ETH)
  if (value > 0n) {
    const publicClient = getPublicClient(chainId);
    const balance = await publicClient.getBalance({ address: accountAddress });
    if (balance < value) {
      throw new Error(`Insufficient ETH balance: have ${balance}, need ${value}`);
    }
  }

  // Execute via the smart account
  const config = getConfig();
  const systemKey = config.reservesPrivateKey as `0x${string}`;
  const walletClient = getWalletClient(chainId, systemKey);
  const publicClient = getPublicClient(chainId);

  // Simulate the inner call as the smart account before asking the account to
  // execute it. This catches permission, routing, value, and ABI failures.
  await publicClient.call({
    account: accountAddress,
    to,
    data,
    value,
  });

  const txHash = await walletClient.writeContract({
    address: accountAddress,
    abi: SIMPLE_ACCOUNT_ABI,
    functionName: 'execute',
    args: [to, value, data],
  });

  // Wait for confirmation
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error(`Managed transaction reverted: ${txHash}`);
  }

  logger.info('Transaction executed via smart account', {
    userId,
    chainId,
    accountAddress,
    to,
    value: value.toString(),
    txHash,
  });

  return { txHash, accountAddress };
}

/**
 * Get user's withdrawal history
 */
export async function getUserWithdrawals(
  userId: string,
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
    [userId],
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
  newOwnerAddress: Address,
): Promise<{ txHash: Hash }> {
  const account = await getOrCreateSmartAccount(userId, chainId);
  const normalizedOwner = newOwnerAddress.toLowerCase();

  if (
    normalizedOwner === NATIVE_WALLET_TOKEN ||
    normalizedOwner === DEAD_ADDRESS ||
    normalizedOwner === account.address.toLowerCase()
  ) {
    throw new Error('New owner must be a different explicit wallet address');
  }

  if (account.custodyStatus !== 'managed') {
    throw new Error('Account custody has already been transferred');
  }

  // Ensure deployed before transfer
  const accountAddress = await ensureDeployed(userId, chainId);

  const claimed = await execute(
    `UPDATE user_smart_accounts
     SET custody_status = 'transferring', updated_at = NOW()
     WHERE id = $1 AND custody_status = 'managed'`,
    [account.id],
  );
  if (claimed !== 1) throw new Error('Account custody is already being transferred');

  let txHash: Hash | null = null;
  let provenReverted = false;
  try {
    const config = getConfig();
    const systemKey = config.reservesPrivateKey as `0x${string}`;
    if (!systemKey) throw new Error('RESERVES_PRIVATE_KEY not configured');
    const walletClient = getWalletClient(chainId, systemKey);
    const publicClient = getPublicClient(chainId);

    await publicClient.simulateContract({
      account: privateKeyToAccount(systemKey).address,
      address: accountAddress,
      abi: SIMPLE_ACCOUNT_ABI,
      functionName: 'transferOwnership',
      args: [newOwnerAddress],
    });
    txHash = await walletClient.writeContract({
      address: accountAddress,
      abi: SIMPLE_ACCOUNT_ABI,
      functionName: 'transferOwnership',
      args: [newOwnerAddress],
    });

    await execute(
      `UPDATE user_smart_accounts
       SET owner_address = $1, custody_transfer_tx_hash = $2, updated_at = NOW()
       WHERE id = $3 AND custody_status = 'transferring'`,
      [newOwnerAddress, txHash, account.id],
    );
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      provenReverted = true;
      throw new Error('Custody transfer reverted');
    }
    const onchainOwner = await publicClient.readContract({
      address: accountAddress,
      abi: SIMPLE_ACCOUNT_ABI,
      functionName: 'owner',
    });
    if (onchainOwner.toLowerCase() !== normalizedOwner) {
      throw new Error('Smart account owner does not match the requested wallet');
    }

    // Update database
    await execute(
      `UPDATE user_smart_accounts
       SET custody_status = 'self_custody',
           owner_address = $1,
           custody_transferred_at = NOW(),
           custody_transfer_tx_hash = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [newOwnerAddress, txHash, account.id],
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
    if (!txHash || provenReverted) {
      await execute(
        `UPDATE user_smart_accounts
         SET custody_status = 'managed', owner_address = NULL,
             custody_transfer_tx_hash = NULL, updated_at = NOW()
         WHERE id = $1 AND custody_status = 'transferring'`,
        [account.id],
      );
    }

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
  tokenAddresses: Address[],
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
        [accountId, tokenAddress, symbol, decimals, balance.toString()],
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
  chainId: number,
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
    [userId, chainId],
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
    ],
  );

  logger.info('Recorded project role', params);
}

/**
 * Get all project roles for a user's smart accounts
 */
export async function getUserProjectRoles(
  userId: string,
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
    [userId],
  );

  return rows.map((r) => ({
    projectId: r.project_id,
    chainId: r.chain_id,
    roleType: r.role_type,
    percentBps: r.percent_bps,
    active: r.active,
  }));
}

// ============================================================================
// Multi-Chain Export
// ============================================================================

interface ExportBlocker {
  type: 'pending_withdrawal';
  id: string;
  chainId: number;
  tokenAddress: string;
  amount: string;
}

interface ExportSnapshot {
  accounts: Array<{
    chainId: number;
    address: string;
    deployed: boolean;
    ethBalance: string;
    tokens: Array<{ symbol: string; balance: string }>;
  }>;
  projectRoles: Array<{
    projectId: number;
    chainId: number;
    role: string;
    percentBps: number | null;
  }>;
}

interface ExportRequest {
  id: string;
  userId: string;
  newOwnerAddress: Address;
  chainIds: number[];
  chainStatus: Record<string, { status: string; txHash?: string; error?: string }>;
  status: 'pending' | 'blocked' | 'processing' | 'completed' | 'partial' | 'failed' | 'cancelled';
  blockedByPendingOps: boolean;
  pendingOpsDetails: { withdrawals: ExportBlocker[] } | null;
  exportSnapshot: ExportSnapshot | null;
  userConfirmedAt: Date | null;
  createdAt: Date;
}

/**
 * Check if user can export (no pending operations blocking)
 */
export async function checkExportBlockers(userId: string): Promise<{
  canExport: boolean;
  blockers: ExportBlocker[];
}> {
  const pendingWithdrawals = await query<{
    id: string;
    chain_id: number;
    token_address: string;
    amount: string;
  }>(
    `SELECT w.id, sa.chain_id, w.token_address, w.amount
     FROM smart_account_withdrawals w
     JOIN user_smart_accounts sa ON sa.id = w.smart_account_id
     WHERE sa.user_id = $1 AND w.status IN ('pending', 'processing')`,
    [userId],
  );

  const blockers: ExportBlocker[] = pendingWithdrawals.map((w) => ({
    type: 'pending_withdrawal',
    id: w.id,
    chainId: w.chain_id,
    tokenAddress: w.token_address,
    amount: w.amount,
  }));

  return {
    canExport: blockers.length === 0,
    blockers,
  };
}

/**
 * Build a snapshot of what user is exporting (for confirmation UI)
 */
async function buildExportSnapshot(userId: string): Promise<ExportSnapshot> {
  const accounts = await getUserSmartAccounts(userId);
  const projectRoles = await getUserProjectRoles(userId);

  const accountSnapshots = await Promise.all(
    accounts
      .filter((a) => a.custodyStatus === 'managed')
      .map(async (account) => {
        // Get cached balances
        const balances = await getAccountBalances(userId, account.chainId);
        const ethBalance = balances.find(
          (b) => b.tokenAddress === '0x0000000000000000000000000000000000000000',
        );
        const tokens = balances.filter(
          (b) => b.tokenAddress !== '0x0000000000000000000000000000000000000000',
        );

        return {
          chainId: account.chainId,
          address: account.address,
          deployed: account.deployed,
          ethBalance: ethBalance?.balance || '0',
          tokens: tokens.map((t) => ({ symbol: t.tokenSymbol, balance: t.balance })),
        };
      }),
  );

  return {
    accounts: accountSnapshots,
    projectRoles: projectRoles
      .filter((r) => r.active)
      .map((r) => ({
        projectId: r.projectId,
        chainId: r.chainId,
        role: r.roleType,
        percentBps: r.percentBps,
      })),
  };
}

/**
 * Request an export of all managed accounts to user's self-custody address
 * Returns export request for user confirmation
 */
export async function requestExport(
  userId: string,
  newOwnerAddress: Address,
): Promise<{
  exportId: string;
  blocked: boolean;
  blockers: ExportBlocker[];
  snapshot: ExportSnapshot;
  chainIds: number[];
}> {
  // Check for blockers
  const { canExport, blockers } = await checkExportBlockers(userId);

  // Get user's managed accounts
  const accounts = await getUserSmartAccounts(userId);
  const managedAccounts = accounts.filter((a) => a.custodyStatus === 'managed');

  if (managedAccounts.length === 0) {
    throw new Error('No managed accounts to export');
  }
  const normalizedOwner = newOwnerAddress.toLowerCase();
  if (
    normalizedOwner === NATIVE_WALLET_TOKEN ||
    normalizedOwner === DEAD_ADDRESS ||
    managedAccounts.some((account) => account.address.toLowerCase() === normalizedOwner)
  ) {
    throw new Error('Export destination must be a different explicit wallet address');
  }

  const chainIds = managedAccounts.map((a) => a.chainId);

  // Build snapshot
  const snapshot = await buildExportSnapshot(userId);

  // Create export request
  const [row] = await query<{ id: string }>(
    `INSERT INTO smart_account_exports
     (user_id, new_owner_address, chain_ids, status, blocked_by_pending_ops, pending_ops_details, export_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      userId,
      newOwnerAddress,
      chainIds,
      canExport ? 'pending' : 'blocked',
      !canExport,
      blockers.length > 0 ? JSON.stringify({ withdrawals: blockers }) : null,
      JSON.stringify(snapshot),
    ],
  );

  logger.info('Export requested', {
    exportId: row.id,
    userId,
    newOwnerAddress,
    chainIds,
    blocked: !canExport,
    blockerCount: blockers.length,
  });

  return {
    exportId: row.id,
    blocked: !canExport,
    blockers,
    snapshot,
    chainIds,
  };
}

/**
 * Confirm and execute the export
 */
export async function confirmExport(exportId: string): Promise<{
  status: 'completed' | 'partial' | 'failed';
  chainResults: Record<number, { success: boolean; txHash?: string; error?: string }>;
}> {
  // Get export request
  const exportReq = await queryOne<{
    id: string;
    user_id: string;
    new_owner_address: string;
    chain_ids: number[];
    status: string;
    blocked_by_pending_ops: boolean;
  }>(
    `SELECT id, user_id, new_owner_address, chain_ids, status, blocked_by_pending_ops
     FROM smart_account_exports WHERE id = $1`,
    [exportId],
  );

  if (!exportReq) {
    throw new Error('Export request not found');
  }

  if (exportReq.status !== 'pending' && exportReq.status !== 'blocked') {
    throw new Error(`Export is ${exportReq.status}, cannot confirm`);
  }

  if (exportReq.blocked_by_pending_ops) {
    // Re-check blockers
    const { canExport, blockers } = await checkExportBlockers(exportReq.user_id);
    if (!canExport) {
      throw new Error(`Export blocked by ${blockers.length} pending operation(s)`);
    }
    // Update to unblocked
    await execute(
      `UPDATE smart_account_exports
       SET blocked_by_pending_ops = FALSE, pending_ops_details = NULL, status = 'pending'
       WHERE id = $1`,
      [exportId],
    );
  }

  // Claim the request atomically so duplicate confirmations cannot transfer the
  // same account twice.
  const claimed = await execute(
    `UPDATE smart_account_exports
     SET user_confirmed_at = NOW(), started_at = NOW(), status = 'processing'
     WHERE id = $1 AND status IN ('pending', 'blocked')`,
    [exportId],
  );
  if (claimed !== 1) throw new Error('Export is already being processed');

  // Execute transfers
  const chainResults: Record<number, { success: boolean; txHash?: string; error?: string }> = {};
  const chainStatus: Record<
    string,
    { status: string; txHash?: string; error?: string; completedAt?: string }
  > = {};

  for (const chainId of exportReq.chain_ids) {
    try {
      const { txHash } = await transferCustody(
        exportReq.user_id,
        chainId,
        exportReq.new_owner_address as Address,
      );

      chainResults[chainId] = { success: true, txHash };
      chainStatus[chainId.toString()] = {
        status: 'completed',
        txHash,
        completedAt: new Date().toISOString(),
      };

      logger.info('Chain export completed', { exportId, chainId, txHash });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      chainResults[chainId] = { success: false, error: errorMsg };
      chainStatus[chainId.toString()] = {
        status: 'failed',
        error: errorMsg,
      };

      logger.error('Chain export failed', error as Error, { exportId, chainId });
    }

    // Update chain status after each chain
    await execute(
      `UPDATE smart_account_exports SET chain_status = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(chainStatus), exportId],
    );
  }

  // Determine final status
  const results = Object.values(chainResults);
  const allSucceeded = results.every((r) => r.success);
  const allFailed = results.every((r) => !r.success);
  const finalStatus = allSucceeded ? 'completed' : allFailed ? 'failed' : 'partial';

  await execute(
    `UPDATE smart_account_exports
     SET status = $1, completed_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [finalStatus, exportId],
  );

  logger.info('Export finished', {
    exportId,
    finalStatus,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
  });

  return { status: finalStatus, chainResults };
}

/**
 * Retry failed chains in a partial export
 */
export async function retryExport(exportId: string): Promise<{
  status: 'completed' | 'partial' | 'failed';
  chainResults: Record<number, { success: boolean; txHash?: string; error?: string }>;
}> {
  const exportReq = await queryOne<{
    id: string;
    user_id: string;
    new_owner_address: string;
    chain_ids: number[];
    chain_status: Record<
      string,
      { status: string; txHash?: string; error?: string; completedAt?: string }
    >;
    status: string;
    retry_count: number;
  }>(
    `SELECT id, user_id, new_owner_address, chain_ids, chain_status, status, retry_count
     FROM smart_account_exports WHERE id = $1`,
    [exportId],
  );

  if (!exportReq) {
    throw new Error('Export request not found');
  }

  if (exportReq.status !== 'partial' && exportReq.status !== 'failed') {
    throw new Error(`Export is ${exportReq.status}, cannot retry`);
  }

  // Find failed chains
  const failedChainIds = exportReq.chain_ids.filter(
    (chainId) => exportReq.chain_status[chainId.toString()]?.status !== 'completed',
  );

  if (failedChainIds.length === 0) {
    throw new Error('No failed chains to retry');
  }

  // Update retry count
  await execute(
    `UPDATE smart_account_exports
     SET status = 'processing', retry_count = retry_count + 1, last_retry_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [exportId],
  );

  const chainResults: Record<number, { success: boolean; txHash?: string; error?: string }> = {};
  const chainStatus = { ...exportReq.chain_status };

  for (const chainId of failedChainIds) {
    try {
      const { txHash } = await transferCustody(
        exportReq.user_id,
        chainId,
        exportReq.new_owner_address as Address,
      );

      chainResults[chainId] = { success: true, txHash };
      chainStatus[chainId.toString()] = {
        status: 'completed',
        txHash,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      chainResults[chainId] = { success: false, error: errorMsg };
      chainStatus[chainId.toString()] = {
        status: 'failed',
        error: errorMsg,
      };
    }

    await execute(
      `UPDATE smart_account_exports SET chain_status = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(chainStatus), exportId],
    );
  }

  // Check overall status (including previously successful chains)
  const allChainStatuses = exportReq.chain_ids.map(
    (chainId) => chainStatus[chainId.toString()]?.status,
  );
  const allCompleted = allChainStatuses.every((s) => s === 'completed');
  const allFailed = allChainStatuses.every((s) => s === 'failed');
  const finalStatus = allCompleted ? 'completed' : allFailed ? 'failed' : 'partial';

  await execute(
    `UPDATE smart_account_exports
     SET status = $1, completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END, updated_at = NOW()
     WHERE id = $2`,
    [finalStatus, exportId],
  );

  return { status: finalStatus, chainResults };
}

/**
 * Cancel a pending export
 */
export async function cancelExport(exportId: string): Promise<void> {
  const result = await execute(
    `UPDATE smart_account_exports
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'blocked')`,
    [exportId],
  );

  if (result === 0) {
    throw new Error('Export not found or cannot be cancelled');
  }

  logger.info('Export cancelled', { exportId });
}

/**
 * Get export status
 */
export async function getExportStatus(exportId: string): Promise<ExportRequest | null> {
  const row = await queryOne<{
    id: string;
    user_id: string;
    new_owner_address: string;
    chain_ids: number[];
    chain_status: Record<string, { status: string; txHash?: string; error?: string }>;
    status: string;
    blocked_by_pending_ops: boolean;
    pending_ops_details: { withdrawals: ExportBlocker[] } | null;
    export_snapshot: ExportSnapshot | null;
    user_confirmed_at: string | null;
    created_at: string;
  }>(`SELECT * FROM smart_account_exports WHERE id = $1`, [exportId]);

  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    newOwnerAddress: row.new_owner_address as Address,
    chainIds: row.chain_ids,
    chainStatus: row.chain_status,
    status: row.status as ExportRequest['status'],
    blockedByPendingOps: row.blocked_by_pending_ops,
    pendingOpsDetails: row.pending_ops_details,
    exportSnapshot: row.export_snapshot,
    userConfirmedAt: row.user_confirmed_at ? new Date(row.user_confirmed_at) : null,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Get user's export history
 */
export async function getUserExports(userId: string): Promise<ExportRequest[]> {
  const rows = await query<{
    id: string;
    user_id: string;
    new_owner_address: string;
    chain_ids: number[];
    chain_status: Record<string, { status: string; txHash?: string; error?: string }>;
    status: string;
    blocked_by_pending_ops: boolean;
    pending_ops_details: { withdrawals: ExportBlocker[] } | null;
    export_snapshot: ExportSnapshot | null;
    user_confirmed_at: string | null;
    created_at: string;
  }>(
    `SELECT * FROM smart_account_exports WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    newOwnerAddress: row.new_owner_address as Address,
    chainIds: row.chain_ids,
    chainStatus: row.chain_status,
    status: row.status as ExportRequest['status'],
    blockedByPendingOps: row.blocked_by_pending_ops,
    pendingOpsDetails: row.pending_ops_details,
    exportSnapshot: row.export_snapshot,
    userConfirmedAt: row.user_confirmed_at ? new Date(row.user_confirmed_at) : null,
    createdAt: new Date(row.created_at),
  }));
}

// ============================================================================
// Delayed Transfers (with hold period for fraud protection)
// ============================================================================

/** Default hold period: 7 days in milliseconds */
const TRANSFER_HOLD_MS = 7 * 24 * 60 * 60 * 1000;

export interface PendingTransfer {
  id: string;
  userId: string;
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string;
  amount: string;
  toAddress: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  availableAt: Date;
  createdAt: Date;
  txHash?: string;
}

/**
 * Request a transfer with a hold period (fraud protection).
 * The transfer will be pending until availableAt, then can be executed.
 *
 * @param params Transfer parameters
 * @param holdMs Optional hold period in ms (default: 7 days)
 * @returns The pending transfer record
 */
export async function requestTransfer(params: {
  userId: string;
  chainId: number;
  tokenAddress: Address;
  amount: bigint;
  toAddress: Address;
}): Promise<PendingTransfer> {
  const {
    userId,
    chainId,
    tokenAddress,
    amount,
    toAddress,
  } = params;
  const tokenSymbol = requireRecognizedWalletToken(chainId, tokenAddress);
  if (amount <= 0n) throw new Error('Transfer amount must be greater than zero');

  // Get account and verify it's managed
  const account = await getOrCreateSmartAccount(userId, chainId);

  if (account.custodyStatus !== 'managed') {
    throw new Error('Account is not managed - use your own wallet to transfer');
  }

  // Verify balance
  const publicClient = getPublicClient(chainId);
  const accountAddress = account.address as Address;
  const normalizedRecipient = toAddress.toLowerCase();
  if (
    normalizedRecipient === NATIVE_WALLET_TOKEN ||
    normalizedRecipient === DEAD_ADDRESS ||
    normalizedRecipient === accountAddress.toLowerCase()
  ) {
    throw new Error('Transfer recipient must be a different explicit wallet address');
  }
  const isNative = tokenSymbol === 'ETH';

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
    throw new Error(`Insufficient balance: have ${balance.toString()}, need ${amount.toString()}`);
  }

  const availableAt = new Date(Date.now() + TRANSFER_HOLD_MS);

  // Create pending transfer record
  const [withdrawal] = await query<{
    id: string;
    created_at: Date;
  }>(
    `INSERT INTO smart_account_withdrawals
     (smart_account_id, token_address, amount, to_address, status, transfer_type, available_at)
     VALUES ($1, $2, $3, $4, 'pending', 'delayed', $5)
     RETURNING id, created_at`,
    [account.id, tokenAddress, amount.toString(), toAddress, availableAt],
  );

  logger.info('Pending transfer created', {
    transferId: withdrawal.id,
    userId,
    chainId,
    tokenAddress,
    amount: amount.toString(),
    toAddress,
    availableAt,
  });

  return {
    id: withdrawal.id,
    userId,
    chainId,
    tokenAddress,
    tokenSymbol,
    amount: amount.toString(),
    toAddress,
    status: 'pending',
    availableAt,
    createdAt: withdrawal.created_at,
  };
}

/**
 * Cancel a pending transfer (only before it's executed)
 */
export async function cancelTransfer(
  transferId: string,
  userId: string,
): Promise<void> {
  const result = await execute(
    `UPDATE smart_account_withdrawals w
     SET status = 'cancelled'
     FROM user_smart_accounts a
     WHERE w.id = $1
       AND w.smart_account_id = a.id
       AND a.user_id = $2
       AND w.status = 'pending'
       AND w.transfer_type = 'delayed'`,
    [transferId, userId],
  );

  if (result === 0) {
    throw new Error('Transfer not found, not owned by user, or cannot be cancelled');
  }

  logger.info('Transfer cancelled', { transferId, userId });
}

/**
 * Get user's pending/delayed transfers
 */
export async function getUserPendingTransfers(userId: string): Promise<PendingTransfer[]> {
  const rows = await query<{
    id: string;
    chain_id: number;
    token_address: string;
    amount: string;
    to_address: string;
    status: string;
    available_at: Date;
    created_at: Date;
    tx_hash: string | null;
  }>(
    `SELECT w.id, a.chain_id, w.token_address, w.amount, w.to_address,
            w.status, w.available_at, w.created_at, w.tx_hash
     FROM smart_account_withdrawals w
     JOIN user_smart_accounts a ON a.id = w.smart_account_id
     WHERE a.user_id = $1 AND w.transfer_type = 'delayed'
     ORDER BY w.created_at DESC`,
    [userId],
  );

  return rows.map((r) => ({
    id: r.id,
    userId,
    chainId: r.chain_id,
    tokenAddress: r.token_address,
    tokenSymbol: '', // Would need to look up or store in DB
    amount: r.amount,
    toAddress: r.to_address,
    status: r.status as PendingTransfer['status'],
    availableAt: r.available_at,
    createdAt: r.created_at,
    txHash: r.tx_hash ?? undefined,
  }));
}

/**
 * Execute transfers that have passed their hold period.
 * Called by cron job to process ready transfers.
 *
 * @returns Number of transfers executed
 */
export async function executeReadySmartAccountTransfers(): Promise<number> {
  let executed = 0;

  // Reconcile hashes recorded by a prior run before claiming new work. An RPC
  // timeout after broadcast must never turn into a second transfer.
  const submittedTransfers = await query<{
    id: string;
    chain_id: number;
    tx_hash: string;
  }>(
    `SELECT w.id, a.chain_id, w.tx_hash
     FROM smart_account_withdrawals w
     JOIN user_smart_accounts a ON a.id = w.smart_account_id
     WHERE w.status = 'processing'
       AND w.transfer_type = 'delayed'
       AND w.tx_hash IS NOT NULL
     LIMIT 50`,
  );
  for (const transfer of submittedTransfers) {
    try {
      const receipt = await getPublicClient(transfer.chain_id).getTransactionReceipt({
        hash: transfer.tx_hash as Hash,
      });
      const status = receipt.status === 'success' ? 'completed' : 'failed';
      const count = await execute(
        `UPDATE smart_account_withdrawals
         SET status = $1, executed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE executed_at END,
             error_message = CASE WHEN $1 = 'failed' THEN 'Transfer transaction reverted' ELSE NULL END
         WHERE id = $2 AND status = 'processing' AND tx_hash = $3`,
        [status, transfer.id, transfer.tx_hash],
      );
      if (status === 'completed' && count === 1) executed++;
    } catch {
      // Transaction is still pending or the RPC is temporarily unavailable.
    }
  }

  // Atomically claim pending delayed transfers that are now available.
  const readyTransfers = await query<{
    id: string;
    smart_account_id: string;
    user_id: string;
    chain_id: number;
    account_address: string;
    token_address: string;
    amount: string;
    to_address: string;
  }>(
    `WITH candidates AS (
       SELECT w.id
       FROM smart_account_withdrawals w
       JOIN user_smart_accounts a ON a.id = w.smart_account_id
       WHERE w.status = 'pending'
         AND w.transfer_type = 'delayed'
         AND w.available_at <= NOW()
         AND a.custody_status = 'managed'
       ORDER BY w.available_at ASC
       LIMIT 50
       FOR UPDATE OF w SKIP LOCKED
     )
     UPDATE smart_account_withdrawals AS withdrawal
     SET status = 'processing'
     FROM candidates, user_smart_accounts AS account
     WHERE withdrawal.id = candidates.id
       AND account.id = withdrawal.smart_account_id
     RETURNING withdrawal.id, withdrawal.smart_account_id, account.user_id,
               account.chain_id, account.address AS account_address,
               withdrawal.token_address, withdrawal.amount, withdrawal.to_address`,
  );

  if (readyTransfers.length === 0) {
    return executed;
  }

  logger.info(`Processing ${readyTransfers.length} ready transfers`);

  for (const transfer of readyTransfers) {
    let txHash: Hash | null = null;
    try {
      // Execute the transfer
      const config = getConfig();
      const systemKey = config.reservesPrivateKey as `0x${string}`;
      if (!systemKey) throw new Error('RESERVES_PRIVATE_KEY not configured');
      const walletClient = getWalletClient(transfer.chain_id, systemKey);

      const accountAddress = transfer.account_address as Address;
      const tokenAddress = transfer.token_address as Address;
      const toAddress = transfer.to_address as Address;
      const amount = BigInt(transfer.amount);
      const tokenSymbol = requireRecognizedWalletToken(transfer.chain_id, tokenAddress);
      if (amount <= 0n) throw new Error('Transfer amount must be greater than zero');
      const normalizedRecipient = toAddress.toLowerCase();
      if (
        normalizedRecipient === NATIVE_WALLET_TOKEN ||
        normalizedRecipient === DEAD_ADDRESS ||
        normalizedRecipient === transfer.account_address.toLowerCase()
      ) {
        throw new Error('Transfer recipient must be a different explicit wallet address');
      }
      const isNative = tokenSymbol === 'ETH';
      const deployedAddress = await ensureDeployed(transfer.user_id, transfer.chain_id);
      if (deployedAddress.toLowerCase() !== accountAddress.toLowerCase()) {
        throw new Error('Managed account address changed');
      }
      const publicClient = getPublicClient(transfer.chain_id);
      let target: Address;
      let value: bigint;
      let callData: Hex;

      if (isNative) {
        target = toAddress;
        value = amount;
        callData = '0x';
      } else {
        target = tokenAddress;
        value = 0n;
        callData = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [toAddress, amount],
        });
      }

      const outerData = encodeFunctionData({
        abi: SIMPLE_ACCOUNT_ABI,
        functionName: 'execute',
        args: [target, value, callData],
      });
      const systemAccount = privateKeyToAccount(systemKey);
      await publicClient.call({
        account: systemAccount.address,
        to: accountAddress,
        data: outerData,
      });
      txHash = await walletClient.writeContract({
        address: accountAddress,
        abi: SIMPLE_ACCOUNT_ABI,
        functionName: 'execute',
        args: [target, value, callData],
      });

      const recorded = await execute(
        `UPDATE smart_account_withdrawals
         SET tx_hash = $1
         WHERE id = $2 AND status = 'processing' AND tx_hash IS NULL`,
        [txHash, transfer.id],
      );
      if (recorded !== 1) throw new Error('Could not bind submitted transfer hash');

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') throw new Error('Transfer transaction reverted');

      // Mark as completed
      await execute(
        `UPDATE smart_account_withdrawals
         SET status = 'completed', tx_hash = $1, executed_at = NOW()
         WHERE id = $2 AND status = 'processing' AND tx_hash = $1`,
        [txHash, transfer.id],
      );

      logger.info('Transfer executed', {
        transferId: transfer.id,
        txHash,
        chainId: transfer.chain_id,
      });

      executed++;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        'Transfer execution failed',
        error instanceof Error ? error : new Error(errorMsg),
        {
          transferId: transfer.id,
        },
      );

      if (txHash) {
        await execute(
          `UPDATE smart_account_withdrawals
           SET error_message = $1
           WHERE id = $2 AND status = 'processing' AND tx_hash = $3`,
          [errorMsg, transfer.id, txHash],
        );
      } else {
        await execute(
          `UPDATE smart_account_withdrawals
           SET status = 'failed', error_message = $1
           WHERE id = $2 AND status = 'processing' AND tx_hash IS NULL`,
          [errorMsg, transfer.id],
        );
      }
    }
  }

  return executed;
}
