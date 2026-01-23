import { useAccount, useDisconnect } from 'wagmi'
import { useThemeStore } from '../../stores'
import { useWalletBalances, formatEthBalance, formatUsdcBalance, useEnsNameResolved } from '../../hooks'
import { hasValidWalletSession } from '../../services/siwe'

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

interface WalletInfoProps {
  inline?: boolean
}

export default function WalletInfo({ inline }: WalletInfoProps = {}) {
  const { theme } = useThemeStore()
  const { address, isConnected } = useAccount()
  const { ensName } = useEnsNameResolved(address)
  const { disconnect } = useDisconnect()
  const { totalEth, totalUsdc, loading: balancesLoading } = useWalletBalances()

  // User is "signed in" if they have a valid SIWE session
  const isSignedIn = hasValidWalletSession()

  const content = (
    <div className={`flex items-center text-xs ${
      theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
    }`}>
      {!isConnected || !address ? (
        <button
          onClick={openWalletPanel}
          className={`transition-colors ${
            theme === 'dark'
              ? 'text-gray-500 hover:text-gray-300'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          Connect account
        </button>
      ) : (
        <>
          {isSignedIn ? (
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 shrink-0" />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full border border-current opacity-50 mr-1.5 shrink-0" />
          )}
          <span className="mr-1">Connected as</span>
          <button
            onClick={openWalletPanel}
            className={`transition-colors ${
              theme === 'dark'
                ? 'text-gray-500 hover:text-gray-300'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {ensName || shortenAddress(address)}
          </button>
          {balancesLoading ? (
            <span className="ml-2 opacity-50">Loading...</span>
          ) : (
            <button
              onClick={openWalletPanel}
              className={`ml-2 transition-colors ${
                theme === 'dark'
                  ? 'text-gray-500 hover:text-gray-300'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              · {formatUsdcBalance(totalUsdc)} USDC · {formatEthBalance(totalEth)} ETH
            </button>
          )}
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
        </>
      )}
    </div>
  )

  if (inline) {
    return content
  }

  return (
    <div className="flex gap-3 mt-2 px-6">
      {/* Spacer to align with textarea */}
      <div className="w-[48px] shrink-0" />
      <div className="flex-1">
        {content}
      </div>
    </div>
  )
}
