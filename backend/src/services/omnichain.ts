/**
 * Omnichain/Sucker Service
 *
 * Implements tool handlers for cross-chain operations:
 * - Querying sucker pairs and bridge status
 * - Encoding bridge transactions
 * - Fetching merkle proofs for claims
 */

import {
  createPublicClient,
  http,
  encodeFunctionData,
  type Address,
  formatEther,
  parseUnits,
} from 'viem';
import { mainnet, optimism, arbitrum, base } from 'viem/chains';
import { logger } from '../utils/logger.ts';
import { getConfig } from '../utils/config.ts';
import {
  SUCKER_ABI,
  SUCKER_REGISTRY_ABI,
  SUPPORTED_CHAINS,
  BRIDGE_PROTOCOLS,
} from '../context/omnichain.ts';

// ============================================================================
// Chain Configuration
// ============================================================================

const CHAINS: Record<number, { chain: typeof mainnet; rpcUrl: string }> = {
  1: { chain: mainnet, rpcUrl: 'https://eth.llamarpc.com' },
  10: { chain: optimism, rpcUrl: 'https://optimism.llamarpc.com' },
  8453: { chain: base, rpcUrl: 'https://base.llamarpc.com' },
  42161: { chain: arbitrum, rpcUrl: 'https://arbitrum.llamarpc.com' },
};

// JBSuckerRegistry address (same on all chains via CREATE2)
// TODO: Update with actual deployed address
const SUCKER_REGISTRY: Record<number, Address> = {
  1: '0x0000000000000000000000000000000000000000',
  10: '0x0000000000000000000000000000000000000000',
  8453: '0x0000000000000000000000000000000000000000',
  42161: '0x0000000000000000000000000000000000000000',
};

// Juicerkle API for merkle proofs
const JUICERKLE_API = 'https://juicerkle-production.up.railway.app';

// Bendystraw GraphQL API
const BENDYSTRAW_API = 'https://bendystraw.xyz/graphql';

// ============================================================================
// Client Factory
// ============================================================================

function getClient(chainId: number) {
  const config = CHAINS[chainId];
  if (!config) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }
  return createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
}

// ============================================================================
// Types
// ============================================================================

interface SuckerPair {
  local: Address;
  remote: Address;
  remoteChainId: number;
}

interface BridgeTransaction {
  id: string;
  chainId: number;
  peerChainId: number;
  sucker: Address;
  peer: Address;
  beneficiary: Address;
  projectTokenCount: string;
  terminalTokenAmount: string;
  token: Address;
  status: 'pending' | 'claimable' | 'claimed';
  index: number;
  root: string | null;
  createdAt: string;
}

interface CrossChainBalance {
  chainId: number;
  chainName: string;
  balance: string;
  formattedBalance: string;
}

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Get all sucker pairs for a project (available bridge destinations)
 */
export async function getSuckerPairs(
  projectId: number,
  chainId: number = 1
): Promise<SuckerPair[]> {
  const client = getClient(chainId);
  const registryAddress = SUCKER_REGISTRY[chainId];

  if (!registryAddress || registryAddress === '0x0000000000000000000000000000000000000000') {
    // Fallback: Query Bendystraw for sucker group data
    return getSuckerPairsFromSubgraph(projectId, chainId);
  }

  try {
    const pairs = await client.readContract({
      address: registryAddress,
      abi: SUCKER_REGISTRY_ABI,
      functionName: 'suckerPairsOf',
      args: [BigInt(projectId)],
    });

    return pairs.map((p) => ({
      local: p.local,
      remote: p.remote,
      remoteChainId: Number(p.remoteChainId),
    }));
  } catch (error) {
    logger.warn('Failed to fetch sucker pairs from registry, using subgraph', {
      projectId,
      chainId,
      error,
    });
    return getSuckerPairsFromSubgraph(projectId, chainId);
  }
}

/**
 * Fallback: Get sucker pairs from Bendystraw subgraph
 */
async function getSuckerPairsFromSubgraph(
  projectId: number,
  chainId: number
): Promise<SuckerPair[]> {
  const config = getConfig();
  const apiKey = config.bendystrawApiKey;

  const query = `
    query GetSuckerPairs($projectId: Int!, $chainId: Int!) {
      suckerDeployments(
        where: { projectId: $projectId, chainId: $chainId }
      ) {
        items {
          sucker
          peer
          peerChainId
        }
      }
    }
  `;

  try {
    const response = await fetch(BENDYSTRAW_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({
        query,
        variables: { projectId, chainId },
      }),
    });

    const data = await response.json();
    const deployments = data.data?.suckerDeployments?.items ?? [];

    return deployments.map((d: { sucker: Address; peer: Address; peerChainId: number }) => ({
      local: d.sucker,
      remote: d.peer,
      remoteChainId: d.peerChainId,
    }));
  } catch (error) {
    logger.error('Failed to fetch sucker pairs from subgraph', error as Error, {
      projectId,
      chainId,
    });
    return [];
  }
}

/**
 * Get bridge transactions for a sucker group
 */
export async function getBridgeTransactions(params: {
  suckerGroupId: string;
  status?: 'pending' | 'claimable' | 'claimed';
  beneficiary?: string;
}): Promise<BridgeTransaction[]> {
  const config = getConfig();
  const apiKey = config.bendystrawApiKey;

  const query = `
    query SuckerTransactions($suckerGroupId: String!, $status: suckerTransactionStatus, $beneficiary: String) {
      suckerTransactions(
        where: { suckerGroupId: $suckerGroupId, status: $status, beneficiary: $beneficiary }
        orderBy: "createdAt"
        orderDirection: "desc"
        limit: 100
      ) {
        items {
          id
          chainId
          peerChainId
          sucker
          peer
          beneficiary
          projectTokenCount
          terminalTokenAmount
          token
          status
          index
          root
          createdAt
        }
      }
    }
  `;

  try {
    const response = await fetch(BENDYSTRAW_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({
        query,
        variables: {
          suckerGroupId: params.suckerGroupId,
          status: params.status,
          beneficiary: params.beneficiary,
        },
      }),
    });

    const data = await response.json();
    return data.data?.suckerTransactions?.items ?? [];
  } catch (error) {
    logger.error('Failed to fetch bridge transactions', error as Error, params);
    return [];
  }
}

/**
 * Estimate bridge fee via simulation
 */
export async function estimateBridgeFee(params: {
  sourceChainId: number;
  destinationChainId: number;
  suckerAddress: Address;
  token: Address;
}): Promise<{ fee: string; formattedFee: string; protocol: string }> {
  const client = getClient(params.sourceChainId);

  // Binary search for minimum viable fee
  let low = 0n;
  let high = parseUnits('0.04', 18); // Max 0.04 ETH
  let result = high;

  for (let i = 0; i < 10; i++) {
    const mid = (low + high) / 2n;

    try {
      await client.simulateContract({
        address: params.suckerAddress,
        abi: SUCKER_ABI,
        functionName: 'toRemote',
        args: [params.token],
        value: mid,
      });
      // Success - try lower
      result = mid;
      high = mid;
    } catch {
      // Failed - try higher
      low = mid;
    }
  }

  // Add 10% buffer
  const bufferedFee = (result * 110n) / 100n;

  const protocolKey = `${params.sourceChainId}-${params.destinationChainId}`;
  const protocol = BRIDGE_PROTOCOLS[protocolKey] ?? 'Unknown';

  return {
    fee: bufferedFee.toString(),
    formattedFee: formatEther(bufferedFee),
    protocol,
  };
}

/**
 * Generate prepare transaction calldata
 */
export function prepareBridgeTransaction(params: {
  suckerAddress: Address;
  projectTokenAmount: string;
  beneficiary: Address;
  minTokensReclaimed: string;
  terminalToken: Address;
}): { to: Address; data: `0x${string}`; value: string } {
  const data = encodeFunctionData({
    abi: SUCKER_ABI,
    functionName: 'prepare',
    args: [
      BigInt(params.projectTokenAmount),
      params.beneficiary,
      BigInt(params.minTokensReclaimed),
      params.terminalToken,
    ],
  });

  return {
    to: params.suckerAddress,
    data,
    value: '0',
  };
}

/**
 * Generate toRemote transaction calldata
 */
export async function executeBridgeTransaction(params: {
  chainId: number;
  suckerAddress: Address;
  token: Address;
}): Promise<{ to: Address; data: `0x${string}`; value: string }> {
  // Estimate fee first
  // Note: We can't know destination chain without more context, so use a reasonable default
  const fee = await estimateBridgeFee({
    sourceChainId: params.chainId,
    destinationChainId: params.chainId === 1 ? 10 : 1, // Default to mainnet or OP
    suckerAddress: params.suckerAddress,
    token: params.token,
  });

  const data = encodeFunctionData({
    abi: SUCKER_ABI,
    functionName: 'toRemote',
    args: [params.token],
  });

  return {
    to: params.suckerAddress,
    data,
    value: fee.fee,
  };
}

/**
 * Juicerkle claim response format (PascalCase)
 */
interface JuicerkleClaim {
  Token: string;
  Leaf: {
    Index: number;
    Beneficiary: string;
    ProjectTokenCount: string;
    TerminalTokenAmount: string;
  };
  Proof: number[][]; // Array of 32-byte arrays
}

/**
 * Fetch merkle proof from Juicerkle and generate claim transaction
 */
export async function claimBridgeTransaction(params: {
  chainId: number;
  suckerAddress: Address;
  token: Address;
  beneficiary: Address;
}): Promise<{
  to: Address;
  data: `0x${string}`;
  value: string;
  claims: Array<{
    index: number;
    projectTokenCount: string;
    terminalTokenAmount: string;
  }>;
}> {
  // Fetch proofs from Juicerkle (note: addresses must be lowercase)
  const response = await fetch(`${JUICERKLE_API}/claims`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chainId: params.chainId,
      sucker: params.suckerAddress.toLowerCase(),
      token: params.token.toLowerCase(),
      beneficiary: params.beneficiary.toLowerCase(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Juicerkle API error: ${response.status}`);
  }

  const proofs = (await response.json()) as JuicerkleClaim[];

  if (!proofs || proofs.length === 0) {
    throw new Error('No claimable proofs found for this beneficiary');
  }

  // For simplicity, claim the first available proof
  // In production, could batch multiple claims
  const claim = proofs[0];

  // Convert Proof from number[][] to bytes32[]
  const proofBytes = claim.Proof.map((arr) => {
    const hex = arr.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `0x${hex}` as `0x${string}`;
  });

  const claimData = {
    token: params.token,
    leaf: {
      index: BigInt(claim.Leaf.Index),
      beneficiary: claim.Leaf.Beneficiary as Address,
      projectTokenCount: BigInt(claim.Leaf.ProjectTokenCount),
      terminalTokenAmount: BigInt(claim.Leaf.TerminalTokenAmount),
    },
    proof: proofBytes,
  };

  const data = encodeFunctionData({
    abi: SUCKER_ABI,
    functionName: 'claim',
    args: [claimData],
  });

  return {
    to: params.suckerAddress,
    data,
    value: '0',
    claims: proofs.map((p) => ({
      index: p.Leaf.Index,
      projectTokenCount: p.Leaf.ProjectTokenCount,
      terminalTokenAmount: p.Leaf.TerminalTokenAmount,
    })),
  };
}

/**
 * Get cross-chain token balance for a user
 */
export async function getCrossChainBalance(params: {
  suckerGroupId: string;
  userAddress: Address;
}): Promise<{
  balances: CrossChainBalance[];
  totalBalance: string;
  formattedTotal: string;
}> {
  const config = getConfig();
  const apiKey = config.bendystrawApiKey;

  // First get all projects in the sucker group
  const query = `
    query SuckerGroup($id: String!) {
      suckerGroup(id: $id) {
        projects {
          items {
            chainId
            projectId
            token
            tokenSymbol
            decimals
          }
        }
      }
    }
  `;

  const response = await fetch(BENDYSTRAW_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
    },
    body: JSON.stringify({
      query,
      variables: { id: params.suckerGroupId },
    }),
  });

  const data = await response.json();
  const projects = data.data?.suckerGroup?.projects?.items ?? [];

  // Query balance on each chain
  const balancePromises = projects.map(
    async (project: { chainId: number; token: Address; decimals: number }) => {
      if (!CHAINS[project.chainId]) return null;

      const client = getClient(project.chainId);

      try {
        const balance = await client.readContract({
          address: project.token,
          abi: [
            {
              name: 'balanceOf',
              type: 'function',
              inputs: [{ name: 'account', type: 'address' }],
              outputs: [{ name: 'balance', type: 'uint256' }],
              stateMutability: 'view',
            },
          ],
          functionName: 'balanceOf',
          args: [params.userAddress],
        });

        const chainInfo = SUPPORTED_CHAINS[project.chainId as keyof typeof SUPPORTED_CHAINS];

        return {
          chainId: project.chainId,
          chainName: chainInfo?.name ?? `Chain ${project.chainId}`,
          balance: balance.toString(),
          formattedBalance: formatEther(balance),
        };
      } catch (error) {
        logger.warn('Failed to fetch balance on chain', {
          chainId: project.chainId,
          error,
        });
        return null;
      }
    }
  );

  const balances = (await Promise.all(balancePromises)).filter(
    (b): b is CrossChainBalance => b !== null
  );

  const totalBalance = balances.reduce((sum, b) => sum + BigInt(b.balance), 0n);

  return {
    balances,
    totalBalance: totalBalance.toString(),
    formattedTotal: formatEther(totalBalance),
  };
}

// ============================================================================
// Tool Handler Router
// ============================================================================

export async function handleOmnichainTool(
  toolName: string,
  input: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case 'get_sucker_pairs':
      return getSuckerPairs(
        input.projectId as number,
        (input.chainId as number) ?? 1
      );

    case 'get_bridge_transactions':
      return getBridgeTransactions({
        suckerGroupId: input.suckerGroupId as string,
        status: input.status as 'pending' | 'claimable' | 'claimed' | undefined,
        beneficiary: input.beneficiary as string | undefined,
      });

    case 'estimate_bridge_fee':
      return estimateBridgeFee({
        sourceChainId: input.sourceChainId as number,
        destinationChainId: input.destinationChainId as number,
        suckerAddress: input.suckerAddress as Address,
        token: input.token as Address,
      });

    case 'prepare_bridge_transaction':
      return prepareBridgeTransaction({
        suckerAddress: input.suckerAddress as Address,
        projectTokenAmount: input.projectTokenAmount as string,
        beneficiary: input.beneficiary as Address,
        minTokensReclaimed: input.minTokensReclaimed as string,
        terminalToken: input.terminalToken as Address,
      });

    case 'execute_bridge_transaction':
      return executeBridgeTransaction({
        chainId: input.chainId as number,
        suckerAddress: input.suckerAddress as Address,
        token: input.token as Address,
      });

    case 'claim_bridge_transaction':
      return claimBridgeTransaction({
        chainId: input.chainId as number,
        suckerAddress: input.suckerAddress as Address,
        token: input.token as Address,
        beneficiary: input.beneficiary as Address,
      });

    case 'get_cross_chain_balance':
      return getCrossChainBalance({
        suckerGroupId: input.suckerGroupId as string,
        userAddress: input.userAddress as Address,
      });

    default:
      throw new Error(`Unknown omnichain tool: ${toolName}`);
  }
}
