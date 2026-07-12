/**
 * Relayr Bundle Service
 *
 * Creates Relayr bundles with ERC-2771 signed forward requests.
 * Enables server-side signing for managed wallet users.
 *
 * Smart account routing: wraps transactions through SmartAccount.execute()
 * via the ERC-2771 forwarder, so _msgSender() = reserves EOA = owner.
 * ForwardableSimpleAccount trusts the forwarder (implements isTrustedForwarder).
 */

import {
  type Address,
  type Chain,
  createPublicClient,
  encodeFunctionData,
  getContract,
  type Hex,
  http,
} from 'viem';
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts';
import process from 'node:process';
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
import { getConfig } from '../utils/config.ts';
import { logger } from '../utils/logger.ts';
import { createHash } from 'node:crypto';
import { execute, queryOne } from '../db/index.ts';
import { getSigningKey } from './encryption.ts';
import {
  deriveSmartAccountAddress,
  getFactoryDeployData,
  getOrCreateSmartAccount,
} from './smartAccounts.ts';
import { assertManagedTransactionAllowed } from './transactionPolicy.ts';

// ============================================================================
// Chain Configuration
// ============================================================================

const CHAINS: Record<number, Chain> = {
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
};

const RPC_URLS: Record<number, string> = {
  // Mainnets (drpc.org is generally more reliable)
  1: 'https://eth.drpc.org',
  10: 'https://mainnet.optimism.io',
  8453: 'https://mainnet.base.org',
  42161: 'https://arb1.arbitrum.io/rpc',
  // Testnets (drpc.org for reliability, public endpoints are slow)
  11155111: 'https://sepolia.drpc.org',
  11155420: 'https://optimism-sepolia.drpc.org',
  84532: 'https://base-sepolia.drpc.org',
  421614: 'https://arbitrum-sepolia.drpc.org',
};

// ============================================================================
// ERC-2771 Forwarder Configuration
// ============================================================================

// TrustedForwarder address (same on all chains)
// Canonical Juicebox V6 forwarder from deploy-all-v6 deployment artifacts.
const ERC2771_FORWARDER_ADDRESS = '0x3ba60b60933916a7c87d0860dcee62a0ce34e3e2' as const;

// Minimal ABI for ERC2771Forwarder
const ERC2771_FORWARDER_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'owner', type: 'address' }],
    name: 'nonces',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'from', type: 'address' },
          { internalType: 'address', name: 'to', type: 'address' },
          { internalType: 'uint256', name: 'value', type: 'uint256' },
          { internalType: 'uint256', name: 'gas', type: 'uint256' },
          { internalType: 'uint48', name: 'deadline', type: 'uint48' },
          { internalType: 'bytes', name: 'data', type: 'bytes' },
          { internalType: 'bytes', name: 'signature', type: 'bytes' },
        ],
        internalType: 'struct ERC2771Forwarder.ForwardRequestData',
        name: 'request',
        type: 'tuple',
      },
    ],
    name: 'execute',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

// SimpleAccount execute ABI for wrapping calls through the smart account
const SIMPLE_ACCOUNT_EXECUTE_ABI = [
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
] as const;

// EIP-712 typed data types for ForwardRequest signing
const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
} as const;

// 48 hours deadline for signatures
const ERC2771_DEADLINE_DURATION_SECONDS = 48 * 60 * 60;

// Relayr API configuration - all required env vars
const RELAYR_API_URL = process.env.RELAYR_API_URL;
const RELAYR_APP_ID = process.env.RELAYR_APP_ID;
const RELAYR_API_KEY = process.env.RELAYR_API_KEY;

// ============================================================================
// Types
// ============================================================================

export interface RelayrTransaction {
  chainId: number;
  target: string;
  data: string;
  value: string;
}

export interface CreateBundleParams {
  userId: string;
  transactions: RelayrTransaction[];
  owner: string;
  smartAccountAddress?: string; // Route through smart account's execute() for managed wallets
  operationKey: string;
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

// ============================================================================
// Main Function
// ============================================================================

/**
 * Create a Relayr bundle with ERC-2771 signed transactions.
 *
 * When smartAccountAddress is provided:
 * - Wraps each tx as SmartAccount.execute(target, value, data)
 * - Signs ERC-2771 forward request targeting the smart account
 * - Forwarder calls SmartAccount.execute(), _msgSender() = reserves EOA = owner
 * - Includes factory createAccount() for lazy deployment
 * - All gas sponsored via Relayr
 *
 * When smartAccountAddress is NOT provided:
 * - Signs ERC-2771 forward request targeting the contract directly
 * - _msgSender() inside target = reserves EOA
 */
export async function createRelayrBundle(
  params: CreateBundleParams,
): Promise<{ bundleId: string }> {
  const { userId, transactions, owner, smartAccountAddress, operationKey } = params;
  const config = getConfig();
  const requestHash = createHash('sha256').update(JSON.stringify({
    transactions: transactions.map((transaction) => ({
      chainId: transaction.chainId,
      target: transaction.target.toLowerCase(),
      data: transaction.data.toLowerCase(),
      value: BigInt(transaction.value).toString(),
    })),
    owner: owner.toLowerCase(),
    smartAccountAddress: smartAccountAddress?.toLowerCase() || null,
  })).digest('hex');

  if (operationKey) {
    const existing = await queryOne<{
      request_hash: string;
      status: string;
      bundle_id: string | null;
    }>(
      `SELECT request_hash, status, bundle_id
       FROM relayr_bundle_operations
       WHERE user_id = $1 AND operation_key = $2`,
      [userId, operationKey],
    );
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new Error('Operation key is already bound to a different transaction set');
      }
      if (existing.status === 'created' && existing.bundle_id) {
        return { bundleId: existing.bundle_id };
      }
      if (existing.status === 'creating' || existing.status === 'uncertain') {
        throw new Error(
          'This operation was already submitted and cannot be safely submitted again',
        );
      }
    }
  }

  // Validate required env vars
  if (!RELAYR_API_URL) {
    throw new Error('RELAYR_API_URL not configured');
  }
  if (!RELAYR_APP_ID) {
    throw new Error('RELAYR_APP_ID not configured');
  }
  if (!RELAYR_API_KEY) {
    throw new Error('RELAYR_API_KEY not configured');
  }

  const requestedOwner = owner.toLowerCase();
  const uniqueChainIds = [...new Set(transactions.map((tx) => tx.chainId))];
  if (uniqueChainIds.length !== transactions.length) {
    throw new Error('A managed bundle may contain only one reviewed transaction per chain');
  }
  if (!smartAccountAddress) {
    for (const chainId of uniqueChainIds) {
      const account = await getOrCreateSmartAccount(userId, chainId);
      if (account.custodyStatus !== 'managed') {
        throw new Error(`Account on chain ${chainId} is not managed`);
      }
      if (account.address.toLowerCase() !== requestedOwner) {
        throw new Error(
          `Project owner is not the authenticated user's managed account on chain ${chainId}`,
        );
      }
    }
  }

  for (const tx of transactions) {
    await assertManagedTransactionAllowed({
      chainId: tx.chainId,
      to: tx.target as Address,
      data: tx.data as Hex,
      value: BigInt(tx.value),
      expectedAccount: (smartAccountAddress || owner) as Address,
    });
  }

  // Existing-project calls routed through a smart account must be signed by
  // that account's configured owner. Direct launch calls may use the user's
  // stored signing key because project ownership is explicit in their calldata.
  let signingAccount: PrivateKeyAccount;

  if (smartAccountAddress) {
    const reservesKey = config.reservesPrivateKey as `0x${string}`;
    if (!reservesKey) {
      throw new Error('RESERVES_PRIVATE_KEY not configured for managed smart-account routing');
    }
    signingAccount = privateKeyToAccount(reservesKey);

    const requestedAddress = smartAccountAddress.toLowerCase();
    for (const chainId of uniqueChainIds) {
      const [account, derivedAddress] = await Promise.all([
        getOrCreateSmartAccount(userId, chainId),
        deriveSmartAccountAddress(userId, chainId, signingAccount.address),
      ]);
      if (account.custodyStatus !== 'managed') {
        throw new Error(`Smart account on chain ${chainId} is not managed`);
      }
      if (
        account.address.toLowerCase() !== requestedAddress ||
        derivedAddress.toLowerCase() !== requestedAddress
      ) {
        throw new Error(
          `Smart account address is not the authenticated user's account on chain ${chainId}`,
        );
      }
    }
    logger.info('Using managed account owner key', { userId, signer: signingAccount.address });
  } else {
    const userSigningKey = await getSigningKey(userId);
    if (userSigningKey) {
      signingAccount = privateKeyToAccount(userSigningKey);
      logger.info('Using user signing key', { userId, signer: signingAccount.address });
    } else {
      const reservesKey = config.reservesPrivateKey as `0x${string}`;
      if (!reservesKey) {
        throw new Error(
          'No signing key available: user has no stored key and RESERVES_PRIVATE_KEY not configured',
        );
      }
      signingAccount = privateKeyToAccount(reservesKey);
      logger.info('Using reserves signing key (no user key stored)', {
        userId,
        signer: signingAccount.address,
      });
    }
  }

  logger.info('Creating Relayr bundle', {
    userId,
    owner,
    smartAccount: smartAccountAddress || 'none',
    chainCount: transactions.length,
    chains: transactions.map((tx) => tx.chainId),
  });

  // Build the raw transactions to wrap with ERC-2771.
  // For smart account routing: wrap each tx as SmartAccount.execute(target, value, data)
  // and target the forwarder at the smart account address.
  const rawTransactions: Array<{
    chainId: number;
    target: Address;
    data: Hex;
    value: bigint;
  }> = [];

  if (smartAccountAddress) {
    // Include factory deployment on each chain (idempotent - no-op if already deployed)
    const uniqueChainIds = [...new Set(transactions.map((tx) => tx.chainId))];
    for (const chainId of uniqueChainIds) {
      const deployData = getFactoryDeployData(signingAccount.address, userId);
      rawTransactions.push({
        chainId,
        target: deployData.target,
        data: deployData.data as Hex,
        value: 0n,
      });
    }

    // Wrap each application tx through SmartAccount.execute()
    for (const tx of transactions) {
      const executeData = encodeFunctionData({
        abi: SIMPLE_ACCOUNT_EXECUTE_ABI,
        functionName: 'execute',
        args: [tx.target as Address, BigInt(tx.value || '0'), tx.data as Hex],
      });

      rawTransactions.push({
        chainId: tx.chainId,
        target: smartAccountAddress as Address,
        data: executeData,
        value: 0n, // Value is encoded in the execute() call, not sent with the forward request
      });
    }
  } else {
    // Direct: forward request targets the contract directly
    for (const tx of transactions) {
      rawTransactions.push({
        chainId: tx.chainId,
        target: tx.target as Address,
        data: tx.data as Hex,
        value: BigInt(tx.value || '0'),
      });
    }
  }

  // Sign ERC-2771 forward requests for each raw transaction
  const wrappedTransactions: Array<{
    chain: number;
    target: string;
    data: string;
    value: string;
  }> = [];

  for (const tx of rawTransactions) {
    const publicClient = getPublicClient(tx.chainId);

    // Get nonce from TrustedForwarder
    const forwarderContract = getContract({
      address: ERC2771_FORWARDER_ADDRESS,
      abi: ERC2771_FORWARDER_ABI,
      client: publicClient,
    });

    const signerAddress = signingAccount.address;
    // Each signed forward request increments the nonce, so we need to track
    // the expected nonce across multiple txs on the same chain
    const baseNonce = await forwarderContract.read.nonces([signerAddress]);
    const chainTxCount = wrappedTransactions.filter((w) => w.chain === tx.chainId).length;
    const nonce = baseNonce + BigInt(chainTxCount);

    const deadline = Math.floor(Date.now() / 1000) + ERC2771_DEADLINE_DURATION_SECONDS;

    // Build the ForwardRequest message
    const messageData = {
      from: signerAddress,
      to: tx.target,
      value: tx.value,
      gas: BigInt(2000000), // Conservative gas estimate
      nonce,
      deadline,
      data: tx.data,
    };

    // Sign the EIP-712 typed data
    const signature = await signingAccount.signTypedData({
      domain: {
        name: 'Juicebox',
        chainId: tx.chainId,
        verifyingContract: ERC2771_FORWARDER_ADDRESS,
        version: '1',
      },
      primaryType: 'ForwardRequest',
      types: FORWARD_REQUEST_TYPES,
      message: messageData,
    });

    logger.debug('Signed ERC-2771 forward request', {
      chainId: tx.chainId,
      signer: signerAddress,
      to: tx.target,
      nonce: nonce.toString(),
      isSmartAccountCall: !!smartAccountAddress,
    });

    // Encode the execute() call with the signed request
    const forwarderExecuteData = encodeFunctionData({
      abi: ERC2771_FORWARDER_ABI,
      functionName: 'execute',
      args: [{
        from: messageData.from,
        to: messageData.to,
        value: messageData.value,
        gas: messageData.gas,
        deadline: messageData.deadline,
        data: messageData.data,
        signature,
      }],
    });

    wrappedTransactions.push({
      chain: tx.chainId,
      target: ERC2771_FORWARDER_ADDRESS,
      data: forwarderExecuteData,
      value: tx.value.toString(),
    });
  }

  // Create Relayr bundle
  const bundleRequest = {
    app_id: RELAYR_APP_ID,
    transactions: wrappedTransactions,
    perform_simulation: true,
    virtual_nonce_mode: 'Disabled',
  };

  logger.info('Submitting bundle to Relayr', {
    userId,
    transactionCount: wrappedTransactions.length,
    smartAccount: smartAccountAddress || 'none',
  });

  if (operationKey) {
    const claimed = await queryOne<{ id: string }>(
      `INSERT INTO relayr_bundle_operations
         (user_id, operation_key, request_hash, status)
       VALUES ($1, $2, $3, 'creating')
       ON CONFLICT (user_id, operation_key) DO UPDATE
         SET status = 'creating', error_message = NULL, updated_at = NOW()
         WHERE relayr_bundle_operations.request_hash = EXCLUDED.request_hash
           AND relayr_bundle_operations.status = 'rejected'
       RETURNING id`,
      [userId, operationKey, requestHash],
    );
    if (!claimed) {
      const existing = await queryOne<{
        request_hash: string;
        status: string;
        bundle_id: string | null;
      }>(
        `SELECT request_hash, status, bundle_id
         FROM relayr_bundle_operations
         WHERE user_id = $1 AND operation_key = $2`,
        [userId, operationKey],
      );
      if (existing?.request_hash !== requestHash) {
        throw new Error('Operation key is already bound to a different transaction set');
      }
      if (existing.status === 'created' && existing.bundle_id) {
        return { bundleId: existing.bundle_id };
      }
      throw new Error('This operation was already submitted and cannot be safely submitted again');
    }
  }

  let response: Response;
  try {
    response = await fetch(`${RELAYR_API_URL}/v1/bundle/balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(RELAYR_API_KEY ? { 'x-api-key': RELAYR_API_KEY } : {}),
      },
      body: JSON.stringify(bundleRequest),
    });
  } catch (error) {
    if (operationKey) {
      await execute(
        `UPDATE relayr_bundle_operations
         SET status = 'uncertain', error_message = $1, updated_at = NOW()
         WHERE user_id = $2 AND operation_key = $3 AND status = 'creating'`,
        [error instanceof Error ? error.message : String(error), userId, operationKey],
      );
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text();
    if (operationKey) {
      await execute(
        `UPDATE relayr_bundle_operations
         SET status = 'rejected', error_message = $1, updated_at = NOW()
         WHERE user_id = $2 AND operation_key = $3 AND status = 'creating'`,
        [`Relayr API ${response.status}: ${errorText}`, userId, operationKey],
      );
    }
    logger.error('Relayr bundle creation failed', new Error(errorText), {
      status: response.status,
      userId,
    });
    throw new Error(`Relayr API error: ${response.status} - ${errorText}`);
  }

  let bundleId: string;
  try {
    const bundleResponse = await response.json();
    bundleId = bundleResponse.bundle_uuid;
    if (!bundleId || typeof bundleId !== 'string') {
      throw new Error('Relayr response omitted bundle ID');
    }
  } catch (error) {
    if (operationKey) {
      await execute(
        `UPDATE relayr_bundle_operations
         SET status = 'uncertain', error_message = $1, updated_at = NOW()
         WHERE user_id = $2 AND operation_key = $3 AND status = 'creating'`,
        [error instanceof Error ? error.message : String(error), userId, operationKey],
      );
    }
    throw error;
  }

  if (operationKey) {
    await execute(
      `UPDATE relayr_bundle_operations
       SET status = 'created', bundle_id = $1, error_message = NULL, updated_at = NOW()
       WHERE user_id = $2 AND operation_key = $3 AND status = 'creating'`,
      [bundleId, userId, operationKey],
    );
  }

  logger.info('Relayr bundle created', {
    userId,
    bundleId,
    chains: transactions.map((tx) => tx.chainId),
  });

  return { bundleId };
}

// ============================================================================
// Bundle Status
// ============================================================================

/**
 * Get the status of a Relayr bundle.
 * Proxies the call through the backend to keep API keys server-side.
 */
export async function getRelayrBundleStatus(userId: string, bundleId: string): Promise<unknown> {
  const ownedBundle = await queryOne<{ id: string }>(
    `SELECT id
     FROM relayr_bundle_operations
     WHERE user_id = $1 AND bundle_id = $2 AND status = 'created'`,
    [userId, bundleId],
  );
  if (!ownedBundle) throw new Error('Relayr bundle not found');

  // Validate required env vars
  if (!RELAYR_API_URL) {
    throw new Error('RELAYR_API_URL not configured');
  }

  const response = await fetch(`${RELAYR_API_URL}/v1/bundle/${bundleId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(RELAYR_API_KEY ? { 'x-api-key': RELAYR_API_KEY } : {}),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Relayr bundle status fetch failed', new Error(errorText), {
      status: response.status,
      bundleId,
    });
    throw new Error(`Relayr API error: ${response.status} - ${errorText}`);
  }

  const bundleStatus = await response.json();
  return bundleStatus;
}
