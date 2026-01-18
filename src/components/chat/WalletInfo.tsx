import { useWallet, useLogout } from '@getpara/react-sdk'
import { useThemeStore } from '../../stores'
import { useWalletBalances, formatEthBalance, formatUsdcBalance } from '../../hooks'

function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

export default function WalletInfo() {
  const { theme } = useThemeStore()
  const { data: wallet } = useWallet()
  const { logout } = useLogout()
  const { totalEth, totalUsdc, loading: balancesLoading } = useWalletBalances()

  if (!wallet?.address) return null

  return (
    <div className="flex gap-3 mt-2 px-6">
      {/* Spacer to align with textarea */}
      <div className="w-[48px] shrink-0" />
      <div className={`flex-1 text-xs ${
        theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
      }`}>
        <div>
          <span>Connected as {wallet.ensName || shortenAddress(wallet.address)}</span>
          <button
            onClick={() => logout()}
            className={`ml-2 transition-colors ${
              theme === 'dark'
                ? 'text-gray-600 hover:text-gray-400'
                : 'text-gray-300 hover:text-gray-500'
            }`}
          >
            · Disconnect
          </button>
        </div>
        {!balancesLoading && (totalEth > 0n || totalUsdc > 0n) && (
          <div className="mt-1">
            {formatEthBalance(totalEth)} ETH · {formatUsdcBalance(totalUsdc)} USDC
          </div>
        )}
      </div>
    </div>
  )
}
