import { Hono } from 'hono';
import { getConfig } from '../utils/config.ts';

export const proxyRouter = new Hono();

// ============================================================================
// Bendystraw GraphQL Proxy
// ============================================================================
// Proxies requests to Bendystraw GraphQL API with server-side API key

proxyRouter.post('/bendystraw', async (c) => {
  const config = getConfig();

  if (!config.bendystrawApiKey) {
    return c.json({ error: 'Bendystraw API key not configured' }, 503);
  }

  try {
    const body = await c.req.json();

    // Construct the authenticated endpoint (testnet uses a separate indexer)
    const host = config.isTestnet ? 'testnet.bendystraw.xyz' : 'bendystraw.xyz';
    const endpoint = `https://${host}/${config.bendystrawApiKey}/graphql`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Bendystraw proxy error:', response.status, errorText);
      return c.json({ error: 'Bendystraw request failed' }, response.status as 400 | 401 | 403 | 404 | 500 | 502 | 503);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    console.error('Bendystraw proxy error:', error);
    return c.json({ error: 'Failed to proxy request to Bendystraw' }, 500);
  }
});

// ============================================================================
// The Graph Uniswap Subgraph Proxy
// ============================================================================
// Proxies requests to The Graph Uniswap subgraphs with server-side API key

// Subgraph IDs for Uniswap V3 on each chain
const UNISWAP_SUBGRAPH_IDS: Record<number, string> = {
  1: '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV',     // Ethereum
  10: 'Cghf4LfVqPiFw6fp6Y5X5Ubc8UpmUhSfJL82zwiBFLaj',    // Optimism
  8453: 'GqzP4Xaehti8KSfQmv3ZctFSjnSUYZ4En5NRsiTbvZpz', // Base
  42161: 'FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM', // Arbitrum
};

proxyRouter.post('/thegraph/uniswap', async (c) => {
  const config = getConfig();

  if (!config.theGraphApiKey) {
    return c.json({ error: 'TheGraph API key not configured' }, 503);
  }

  try {
    const body = await c.req.json();
    const { chainId, query, variables } = body;

    if (!chainId || !query) {
      return c.json({ error: 'Missing chainId or query' }, 400);
    }

    const subgraphId = UNISWAP_SUBGRAPH_IDS[chainId];
    if (!subgraphId) {
      return c.json({ error: `Unsupported chain: ${chainId}` }, 400);
    }

    const endpoint = `https://gateway.thegraph.com/api/${config.theGraphApiKey}/subgraphs/id/${subgraphId}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('TheGraph proxy error:', response.status, errorText);
      return c.json({ error: 'TheGraph request failed' }, response.status as 400 | 401 | 403 | 404 | 500 | 502 | 503);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    console.error('TheGraph proxy error:', error);
    return c.json({ error: 'Failed to proxy request to TheGraph' }, 500);
  }
});

// ============================================================================
// Ankr RPC Proxy
// ============================================================================
// Proxies JSON-RPC requests to Ankr with server-side API key

const ANKR_CHAIN_SLUGS: Record<number, string> = {
  1: 'eth',
  10: 'optimism',
  8453: 'base',
  42161: 'arbitrum',
};

// Allowlist of safe read-only RPC methods
const ALLOWED_RPC_METHODS = new Set([
  // Read state
  'eth_call',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getTransactionCount',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getBlockByHash',
  'eth_getBlockByNumber',
  'eth_blockNumber',
  'eth_chainId',
  'eth_gasPrice',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_maxPriorityFeePerGas',
  'eth_getLogs',
  // Network info
  'net_version',
  'net_listening',
  'web3_clientVersion',
]);

// Explicitly blocked dangerous methods (for clarity and logging)
const BLOCKED_RPC_METHODS = new Set([
  'eth_sign',
  'eth_signTransaction',
  'eth_sendTransaction',
  'eth_sendRawTransaction',
  'personal_sign',
  'personal_sendTransaction',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'wallet_addEthereumChain',
  'wallet_switchEthereumChain',
]);

proxyRouter.post('/rpc/:chainId', async (c) => {
  const config = getConfig();
  const chainId = parseInt(c.req.param('chainId'), 10);

  if (!chainId || isNaN(chainId)) {
    return c.json({ error: 'Invalid chainId' }, 400);
  }

  const chainSlug = ANKR_CHAIN_SLUGS[chainId];
  if (!chainSlug) {
    return c.json({ error: `Unsupported chain: ${chainId}` }, 400);
  }

  try {
    const body = await c.req.json();

    // Validate RPC method is allowed
    const method = body.method;
    if (!method || typeof method !== 'string') {
      return c.json({ error: 'Invalid RPC request: missing method' }, 400);
    }

    if (BLOCKED_RPC_METHODS.has(method)) {
      console.warn(`[RPC Proxy] Blocked dangerous method: ${method}`);
      return c.json({ error: `Method not allowed: ${method}` }, 403);
    }

    if (!ALLOWED_RPC_METHODS.has(method)) {
      console.warn(`[RPC Proxy] Blocked unknown method: ${method}`);
      return c.json({ error: `Method not allowed: ${method}` }, 403);
    }

    // Use Ankr with API key if available, otherwise fall back to public endpoints
    let endpoint: string;
    if (config.ankrApiKey) {
      endpoint = `https://rpc.ankr.com/${chainSlug}/${config.ankrApiKey}`;
    } else {
      // Fallback to public endpoints
      const publicEndpoints: Record<number, string> = {
        1: 'https://ethereum.publicnode.com',
        10: 'https://optimism.publicnode.com',
        8453: 'https://base.publicnode.com',
        42161: 'https://arbitrum-one.publicnode.com',
      };
      endpoint = publicEndpoints[chainId] || `https://rpc.ankr.com/${chainSlug}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('RPC proxy error:', response.status, errorText);
      return c.json({ error: 'RPC request failed' }, response.status as 400 | 401 | 403 | 404 | 500 | 502 | 503);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    console.error('RPC proxy error:', error);
    return c.json({ error: 'Failed to proxy RPC request' }, 500);
  }
});

// ============================================================================
// Health/Status endpoint for proxy services
// ============================================================================

proxyRouter.get('/status', (c) => {
  const config = getConfig();

  return c.json({
    bendystraw: !!config.bendystrawApiKey,
    theGraph: !!config.theGraphApiKey,
    ankr: !!config.ankrApiKey,
  });
});
