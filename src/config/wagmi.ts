import { createConfig, http } from 'wagmi'
import { mainnet, optimism, base, arbitrum } from 'viem/chains'
import { injected, walletConnect } from 'wagmi/connectors'

// Wagmi configuration for self-custody wallet connection
export const wagmiConfig = createConfig({
  chains: [mainnet, optimism, base, arbitrum],
  connectors: [
    injected(),
    walletConnect({
      projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'juicy-vision',
      metadata: {
        name: 'Juicy Vision',
        description: 'AI-powered Juicebox interface',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://juicy.vision',
        icons: [typeof window !== 'undefined' ? `${window.location.origin}/head-dark.png` : ''],
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
