import { createConfig, http } from 'wagmi'
import { mainnet, optimism, base, arbitrum } from 'viem/chains'
import { injected, walletConnect, metaMask, coinbaseWallet, safe } from 'wagmi/connectors'

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'juicy-vision'

// Wagmi configuration for self-custody wallet connection
export const wagmiConfig = createConfig({
  chains: [mainnet, optimism, base, arbitrum],
  connectors: [
    // MetaMask
    metaMask(),
    // Coinbase Wallet
    coinbaseWallet({
      appName: 'Juicy Vision',
    }),
    // Rainbow, Trust, and other injected wallets
    injected({
      target: 'rainbow',
    }),
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
    }),
  ],
  transports: {
    [mainnet.id]: http('https://rpc.ankr.com/eth'),
    [optimism.id]: http('https://rpc.ankr.com/optimism'),
    [base.id]: http('https://rpc.ankr.com/base'),
    [arbitrum.id]: http('https://rpc.ankr.com/arbitrum'),
  },
})
