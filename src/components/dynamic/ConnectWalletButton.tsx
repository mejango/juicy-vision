import { useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { Button } from '../ui'
import { useWalletBalances } from '../../hooks'
import { hasValidWalletSession } from '../../services/siwe'
import { useAuthStore } from '../../stores'

interface ConnectWalletButtonProps {
  onConnect?: () => void
}

// Dispatch event to open wallet panel
function openWalletPanel() {
  window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
}

export default function ConnectWalletButton({ onConnect }: ConnectWalletButtonProps) {
  const { isConnected } = useAccount()
  const { mode, isAuthenticated } = useAuthStore()
  const { totalEth, totalUsdc, loading: balancesLoading } = useWalletBalances()

  // Convert bigint to numbers for comparison
  const ethNumber = parseFloat(formatEther(totalEth))
  const usdcNumber = Number(totalUsdc) / 1e6

  // Check if user is signed in (SIWE for self-custody, or managed auth)
  const isSelfCustodySignedIn = mode === 'self_custody' && hasValidWalletSession()
  const isManagedSignedIn = mode === 'managed' && isAuthenticated()
  const isSignedIn = isSelfCustodySignedIn || isManagedSignedIn

  // Connection states
  const hasNoFunds = isConnected && !balancesLoading && ethNumber < 0.0001 && usdcNumber < 1
  const hasFunds = isConnected && !balancesLoading && (ethNumber >= 0.0001 || usdcNumber >= 1)

  const handleClick = () => {
    openWalletPanel()
    onConnect?.()
  }

  // Wallet icon for not connected
  const walletIcon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  )

  // Plus icon for funding
  const fundIcon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
    </svg>
  )

  // Get button text and icon based on state
  const getButtonContent = () => {
    if (!isConnected) {
      return { text: 'Connect Account', icon: walletIcon }
    }

    if (balancesLoading) {
      return { text: 'Loading...', icon: walletIcon }
    }

    if (hasNoFunds) {
      return { text: 'Fund your account', icon: fundIcon }
    }

    // Connected with funds - show balance summary
    if (hasFunds) {
      // Format balance display
      const ethDisplay = ethNumber >= 0.0001 ? `${ethNumber.toFixed(4)} ETH` : null
      const usdcDisplay = usdcNumber >= 1 ? `$${usdcNumber.toFixed(0)}` : null

      // Show primary balance (prefer USDC for readability, then ETH)
      const balanceText = usdcDisplay || ethDisplay || 'Account'

      return { text: balanceText, icon: walletIcon }
    }

    return { text: 'Connect Account', icon: walletIcon }
  }

  const { text, icon } = getButtonContent()

  return (
    <Button
      onClick={handleClick}
      variant="secondary"
      icon={icon}
    >
      {text}
    </Button>
  )
}
