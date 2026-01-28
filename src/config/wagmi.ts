import { createConfig, http, type Config } from 'wagmi'
import { mainnet, optimism, base, arbitrum, sepolia, optimismSepolia, baseSepolia, arbitrumSepolia } from 'viem/chains'
import { injected, walletConnect, safe } from 'wagmi/connectors'
import { IS_TESTNET, CHAIN_IDS } from './environment'
import { RPC_ENDPOINTS } from '../constants/chains'

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'juicy-vision'

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
        [sepolia.id]: http(RPC_ENDPOINTS[CHAIN_IDS.ethereum][0]),
        [optimismSepolia.id]: http(RPC_ENDPOINTS[CHAIN_IDS.optimism][0]),
        [baseSepolia.id]: http(RPC_ENDPOINTS[CHAIN_IDS.base][0]),
        [arbitrumSepolia.id]: http(RPC_ENDPOINTS[CHAIN_IDS.arbitrum][0]),
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
      [mainnet.id]: http(RPC_ENDPOINTS[CHAIN_IDS.ethereum][0]),
      [optimism.id]: http(RPC_ENDPOINTS[CHAIN_IDS.optimism][0]),
      [base.id]: http(RPC_ENDPOINTS[CHAIN_IDS.base][0]),
      [arbitrum.id]: http(RPC_ENDPOINTS[CHAIN_IDS.arbitrum][0]),
    },
  })
}

// Wagmi configuration for self-custody wallet connection
// Using injected() for browser extension wallets (MetaMask, Coinbase, Rainbow, etc.)
// This avoids loading separate SDKs with their own analytics
export const wagmiConfig = buildWagmiConfig()
