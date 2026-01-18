import { useWallet, useLogout, useModal, ModalStep } from '@getpara/react-sdk'
import { useThemeStore } from '../../stores'
import { useWalletBalances, formatEthBalance, formatUsdcBalance } from '../../hooks'

function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

export default function WalletInfo() {
  const { theme } = useThemeStore()
  const { data: wallet } = useWallet()
  const { logout } = useLogout()
  const { openModal } = useModal()
  const { totalEth, totalUsdc, loading: balancesLoading } = useWalletBalances()

  if (!wallet?.address) return null

  const handleTopUp = () => {
    // Open Para modal to onramp/buy crypto screen
    openModal({ step: ModalStep.ADD_FUNDS_BUY })
  }

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
        <div className="mt-1">
          {balancesLoading ? (
            <span className="opacity-50">Loading balances...</span>
          ) : (
            <>
              {formatEthBalance(totalEth)} ETH · {formatUsdcBalance(totalUsdc)} USDC
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
