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
  createPublicClient,
  encodeFunctionData,
  http,
  getContract,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import {
  mainnet,
  optimism,
  arbitrum,
  base,
  sepolia,
  optimismSepolia,
  baseSepolia,
  arbitrumSepolia,
} from 'viem/chains';
import { getConfig } from '../utils/config.ts';
import { logger } from '../utils/logger.ts';
import { getSigningKey } from './encryption.ts';
import { getFactoryDeployData } from './smartAccounts.ts';

// ============================================================================
// Chain Configuration
// ============================================================================

const CHAINS: Record<number, typeof mainnet> = {
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
const ERC2771_FORWARDER_ADDRESS = '0xc29d6995ab3b0df4650ad643adeac55e7acbb566' as const;

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
export async function createRelayrBundle(params: CreateBundleParams): Promise<{ bundleId: string }> {
  const { userId, transactions, owner, smartAccountAddress } = params;
  const config = getConfig();

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

  // Get signing account: prefer user's stored signing key, fall back to reserves
  let signingAccount: PrivateKeyAccount;

  {
    const userSigningKey = await getSigningKey(userId);
    if (userSigningKey) {
      signingAccount = privateKeyToAccount(userSigningKey);
      logger.info('Using user signing key', { userId, signer: signingAccount.address });
    } else {
      const reservesKey = config.reservesPrivateKey as `0x${string}`;
      if (!reservesKey) {
        throw new Error('No signing key available: user has no stored key and RESERVES_PRIVATE_KEY not configured');
      }
      signingAccount = privateKeyToAccount(reservesKey);
      logger.info('Using reserves signing key (no user key stored)', { userId, signer: signingAccount.address });
    }
  }

  logger.info('Creating Relayr bundle', {
    userId,
    owner,
    smartAccount: smartAccountAddress || 'none',
    chainCount: transactions.length,
    chains: transactions.map(tx => tx.chainId),
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
    const uniqueChainIds = [...new Set(transactions.map(tx => tx.chainId))];
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
    const chainTxCount = wrappedTransactions.filter(w => w.chain === tx.chainId).length;
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

  const response = await fetch(`${RELAYR_API_URL}/v1/bundle/balance`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(RELAYR_API_KEY ? { 'x-api-key': RELAYR_API_KEY } : {}),
    },
    body: JSON.stringify(bundleRequest),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Relayr bundle creation failed', new Error(errorText), {
      status: response.status,
      userId,
    });
    throw new Error(`Relayr API error: ${response.status} - ${errorText}`);
  }

  const bundleResponse = await response.json();
  const bundleId = bundleResponse.bundle_uuid;

  logger.info('Relayr bundle created', {
    userId,
    bundleId,
    chains: transactions.map(tx => tx.chainId),
  });

  return { bundleId };
}
