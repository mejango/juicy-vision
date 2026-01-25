import { createConfig, http } from 'wagmi'
import { mainnet, optimism, base, arbitrum } from 'viem/chains'
import { injected, walletConnect, safe } from 'wagmi/connectors'

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'juicy-vision'

// Wagmi configuration for self-custody wallet connection
// Using injected() for browser extension wallets (MetaMask, Coinbase, Rainbow, etc.)
// This avoids loading separate SDKs with their own analytics
export const wagmiConfig = createConfig({
  chains: [mainnet, optimism, base, arbitrum],
  connectors: [
    // Browser extension wallets (MetaMask, Coinbase Wallet, Rainbow, etc.)
    // Using generic injected connector avoids SDK-specific analytics
    injected(),
    // Safe (Gnosis Safe)
    safe(),
    // WalletConnect for mobile wallets
    walletConnect({
      projectId: walletConnectProjectId,
      metadata: {
        name: 'Juicy Vision',
        description: 'AI-powered Juicebox interface',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://juicy.vision',
        icons: [typeof window !== 'undefined' ? `${window.location.origin}/head-dark.png` : ''],
      },
      showQrModal: true,
      // Disable WalletConnect telemetry
      qrModalOptions: {
        enableExplorer: false,
      },
    }),
  ],
  transports: {
    [mainnet.id]: http('https://rpc.ankr.com/eth'),
    [optimism.id]: http('https://rpc.ankr.com/optimism'),
    [base.id]: http('https://rpc.ankr.com/base'),
    [arbitrum.id]: http('https://rpc.ankr.com/arbitrum'),
  },
})
