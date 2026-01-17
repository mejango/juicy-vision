import { Button } from '../ui'

interface ConnectWalletButtonProps {
  onConnect?: () => void
}

export default function ConnectWalletButton({ onConnect }: ConnectWalletButtonProps) {
  const handleClick = () => {
    // Dispatch custom event for wallet modal
    window.dispatchEvent(new CustomEvent('juice:open-wallet-modal'))
    onConnect?.()
  }

  return (
    <Button
      onClick={handleClick}
      variant="secondary"
      icon={
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      }
    >
      Connect Wallet
    </Button>
  )
}
