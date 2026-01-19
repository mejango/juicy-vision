import { useModal, useWallet } from '@getpara/react-sdk'
import { Button } from '../ui'
import { useWalletBalances } from '../../hooks'

interface ConnectWalletButtonProps {
  onConnect?: () => void
}

export default function ConnectWalletButton({ onConnect }: ConnectWalletButtonProps) {
  const { openModal } = useModal()
  const { data: wallet } = useWallet()
  const { totalEth, totalUsdc, loading: balancesLoading } = useWalletBalances()

  const isConnected = !!wallet?.address
  const hasNoFunds = isConnected && !balancesLoading && totalEth < 0.0001 && totalUsdc < 1

  const handleClick = () => {
    openModal()
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

  return (
    <Button
      onClick={handleClick}
      variant="secondary"
      icon={hasNoFunds ? fundIcon : walletIcon}
    >
      {hasNoFunds ? 'Fund your account' : 'Connect Account'}
    </Button>
  )
}
