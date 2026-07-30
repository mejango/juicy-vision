import { createConfig, http, fallback, custom, type Config } from 'wagmi'
import { injected, walletConnect, safe } from 'wagmi/connectors'
import { IS_TESTNET, IS_LOCAL_ONLY_BROWSER_TEST, CHAIN_IDS } from './environment'
import {
  RPC_ENDPOINTS,
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  sepolia,
} from '../constants/chains'

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'juicy-vision'

// Build fallback transport with all RPCs for a chain
function buildFallbackTransport(chainKey: keyof typeof CHAIN_IDS) {
  if (IS_LOCAL_ONLY_BROWSER_TEST) {
    const chainId = CHAIN_IDS[chainKey]
    return custom({
      async request({ method }) {
        switch (method) {
          case 'eth_chainId': return `0x${chainId.toString(16)}`
          case 'net_version': return String(chainId)
          case 'eth_blockNumber':
          case 'eth_getBalance':
          case 'eth_getTransactionCount':
          case 'eth_gasPrice':
          case 'eth_maxPriorityFeePerGas': return '0x0'
          case 'eth_getCode':
          case 'eth_call': return '0x'
          case 'eth_getLogs': return []
          case 'eth_feeHistory': return {
            oldestBlock: '0x0',
            baseFeePerGas: ['0x0'],
            gasUsedRatio: [0],
            reward: [['0x0']],
          }
          default: return null
        }
      },
    })
  }

  const rpcs = RPC_ENDPOINTS[CHAIN_IDS[chainKey]]
  return fallback(rpcs.map(url => http(url)))
}

function buildConnectors(name: string) {
  const localConnectors = [injected(), safe()]
  if (IS_LOCAL_ONLY_BROWSER_TEST) return localConnectors

  return [
    ...localConnectors,
    walletConnect({
      projectId: walletConnectProjectId,
      metadata: {
        name,
        description: 'AI-powered Juicebox interface',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://juicy.vision',
        icons: [typeof window !== 'undefined' ? `${window.location.origin}/head-dark.png` : ''],
      },
      showQrModal: true,
      qrModalOptions: {
        enableExplorer: false,
      },
    }),
  ]
}

// Build config based on environment
// Using a function to ensure TypeScript infers the correct types
function buildWagmiConfig(): Config {
  if (IS_TESTNET) {
    return createConfig({
      chains: [sepolia, optimismSepolia, baseSepolia, arbitrumSepolia],
      connectors: buildConnectors('Juicy Vision (Testnet)'),
      transports: {
        [sepolia.id]: buildFallbackTransport('ethereum'),
        [optimismSepolia.id]: buildFallbackTransport('optimism'),
        [baseSepolia.id]: buildFallbackTransport('base'),
        [arbitrumSepolia.id]: buildFallbackTransport('arbitrum'),
      },
    })
  }

  return createConfig({
    chains: [mainnet, optimism, base, arbitrum],
    connectors: buildConnectors('Juicy Vision'),
    transports: {
      [mainnet.id]: buildFallbackTransport('ethereum'),
      [optimism.id]: buildFallbackTransport('optimism'),
      [base.id]: buildFallbackTransport('base'),
      [arbitrum.id]: buildFallbackTransport('arbitrum'),
    },
  })
}

// Wagmi configuration for self-custody wallet connection
// Using injected() for browser extension wallets (MetaMask, Coinbase, Rainbow, etc.)
// This avoids loading separate SDKs with their own analytics
export const wagmiConfig = buildWagmiConfig()
