/**
 * Relayr Bundle Service
 *
 * Creates Relayr bundles with ERC-2771 signed forward requests.
 * Enables server-side signing for managed wallet users.
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
 * Server signs on behalf of the user's smart account.
 */
export async function createRelayrBundle(params: CreateBundleParams): Promise<{ bundleId: string }> {
  const { userId, transactions, owner } = params;
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
  const userSigningKey = await getSigningKey(userId);

  if (userSigningKey) {
    // Use the user's passkey-derived signing key
    signingAccount = privateKeyToAccount(userSigningKey);
    logger.info('Using user signing key', { userId, signer: signingAccount.address });
  } else {
    // Fall back to reserves key (for backwards compatibility)
    const reservesKey = config.reservesPrivateKey as `0x${string}`;
    if (!reservesKey) {
      throw new Error('No signing key available: user has no stored key and RESERVES_PRIVATE_KEY not configured');
    }
    signingAccount = privateKeyToAccount(reservesKey);
    logger.info('Using reserves signing key (no user key stored)', { userId, signer: signingAccount.address });
  }

  logger.info('Creating Relayr bundle', {
    userId,
    owner,
    chainCount: transactions.length,
    chains: transactions.map(tx => tx.chainId),
  });

  // Sign ERC-2771 forward requests for each transaction
  const wrappedTransactions: Array<{
    chain: number;
    target: string;
    data: string;
    value: string;
  }> = [];

  for (const tx of transactions) {
    const publicClient = getPublicClient(tx.chainId);

    // Get nonce from TrustedForwarder
    const forwarderContract = getContract({
      address: ERC2771_FORWARDER_ADDRESS,
      abi: ERC2771_FORWARDER_ABI,
      client: publicClient,
    });

    // Use system account as the ERC-2771 signer (not user's address)
    // The project owner is encoded in the transaction calldata, not the meta-tx sender
    const signerAddress = signingAccount.address;
    const nonce = await forwarderContract.read.nonces([signerAddress]);
    const deadline = Math.floor(Date.now() / 1000) + ERC2771_DEADLINE_DURATION_SECONDS;

    // Build the ForwardRequest message
    const messageData = {
      from: signerAddress,
      to: tx.target as Address,
      value: BigInt(tx.value || '0'),
      gas: BigInt(2000000), // Conservative gas estimate
      nonce,
      deadline,
      data: tx.data as Hex,
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
      projectOwner: owner,
      to: tx.target,
      nonce: nonce.toString(),
    });

    // Encode the execute() call with the signed request
    const executeData = encodeFunctionData({
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
      data: executeData,
      value: tx.value,
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
