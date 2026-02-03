import { createConfig, http, fallback, type Config } from 'wagmi'
import { mainnet, optimism, base, arbitrum, sepolia, optimismSepolia, baseSepolia, arbitrumSepolia } from 'viem/chains'
import { injected, walletConnect, safe } from 'wagmi/connectors'
import { IS_TESTNET, CHAIN_IDS } from './environment'
import { RPC_ENDPOINTS } from '../constants/chains'

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'juicy-vision'

// Build fallback transport with all RPCs for a chain
function buildFallbackTransport(chainKey: keyof typeof CHAIN_IDS) {
  const rpcs = RPC_ENDPOINTS[CHAIN_IDS[chainKey]]
  return fallback(rpcs.map(url => http(url)))
}

// Build config based on environment
// Using a function to ensure TypeScript infers the correct types
function buildWagmiConfig(): Config {
  if (IS_TESTNET) {
    return createConfig({
      chains: [sepolia, optimismSepolia, baseSepolia, arbitrumSepolia],
      connectors: [
        injected(),
        safe(),
        walletConnect({
          projectId: walletConnectProjectId,
          metadata: {
            name: 'Juicy Vision (Testnet)',
            description: 'AI-powered Juicebox interface',
            url: typeof window !== 'undefined' ? window.location.origin : 'https://juicy.vision',
            icons: [typeof window !== 'undefined' ? `${window.location.origin}/head-dark.png` : ''],
          },
          showQrModal: true,
          qrModalOptions: {
            enableExplorer: false,
          },
        }),
      ],
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
    connectors: [
      injected(),
      safe(),
      walletConnect({
        projectId: walletConnectProjectId,
        metadata: {
          name: 'Juicy Vision',
          description: 'AI-powered Juicebox interface',
          url: typeof window !== 'undefined' ? window.location.origin : 'https://juicy.vision',
          icons: [typeof window !== 'undefined' ? `${window.location.origin}/head-dark.png` : ''],
        },
        showQrModal: true,
        qrModalOptions: {
          enableExplorer: false,
        },
      }),
    ],
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
