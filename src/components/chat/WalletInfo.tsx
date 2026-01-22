import { useAccount, useDisconnect } from 'wagmi'
import { useThemeStore } from '../../stores'
import { useWalletBalances, formatEthBalance, formatUsdcBalance, useEnsNameResolved } from '../../hooks'

function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

// Dispatch event to open wallet panel with anchor position
function openWalletPanel(e: React.MouseEvent<HTMLButtonElement>) {
  const rect = e.currentTarget.getBoundingClientRect()
  window.dispatchEvent(new CustomEvent('juice:open-wallet-panel', {
    detail: { anchorPosition: { top: rect.top, left: rect.left, width: rect.width, height: rect.height } }
  }))
}

export default function WalletInfo() {
  const { theme } = useThemeStore()
  const { address, isConnected } = useAccount()
  const { ensName } = useEnsNameResolved(address)
  const { disconnect } = useDisconnect()
  const { totalEth, totalUsdc, loading: balancesLoading } = useWalletBalances()

  if (!isConnected || !address) return null

  const handleTopUp = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Open wallet panel to show funding options
    openWalletPanel(e)
  }

  return (
    <div className="flex gap-3 mt-2 px-6">
      {/* Spacer to align with textarea */}
      <div className="w-[48px] shrink-0" />
      <div className={`flex-1 text-xs ${
        theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
      }`}>
        <span>Connected as {ensName || shortenAddress(address)}</span>
        <button
          onClick={() => disconnect()}
          className={`ml-2 transition-colors ${
            theme === 'dark'
              ? 'text-gray-600 hover:text-gray-400'
              : 'text-gray-300 hover:text-gray-500'
          }`}
        >
          · Disconnect
        </button>
        {balancesLoading ? (
          <span className="ml-2 opacity-50">Loading...</span>
        ) : (
          <>
            <span className="ml-2">· {formatUsdcBalance(totalUsdc)} USDC · {formatEthBalance(totalEth)} ETH</span>
            <button
              onClick={handleTopUp}
              className={`ml-2 transition-colors ${
                theme === 'dark'
                  ? 'text-juice-cyan/70 hover:text-juice-cyan'
                  : 'text-teal-500 hover:text-teal-600'
              }`}
            >
              · Top up
            </button>
          </>
        )}
      </div>
    </div>
  )
}
