import { useAccount, useDisconnect } from 'wagmi'
import { useThemeStore } from '../../stores'
import { useWalletBalances, formatEthBalance, formatUsdcBalance, useEnsNameResolved } from '../../hooks'

function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

// Dispatch event to open wallet panel
function openWalletPanel() {
  window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
}

export default function WalletInfo() {
  const { theme } = useThemeStore()
  const { address, isConnected } = useAccount()
  const { ensName } = useEnsNameResolved(address)
  const { disconnect } = useDisconnect()
  const { totalEth, totalUsdc, loading: balancesLoading } = useWalletBalances()

  if (!isConnected || !address) return null

  const handleTopUp = () => {
    // Open wallet panel to show funding options
    openWalletPanel()
  }

  return (
    <div className="flex gap-3 mt-2 px-6">
      {/* Spacer to align with textarea */}
      <div className="w-[48px] shrink-0" />
      <div className={`flex-1 text-xs ${
        theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
      }`}>
        <div>
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
        </div>
        <div className="mt-1">
          {balancesLoading ? (
            <span className="opacity-50">Loading balances...</span>
          ) : (
            <>
              {formatUsdcBalance(totalUsdc)} USDC · {formatEthBalance(totalEth)} ETH
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
    </div>
  )
}
