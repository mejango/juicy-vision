import { useThemeStore } from '../../stores'

interface ActionButtonProps {
  action: string
  label?: string
}

const ACTION_LABELS: Record<string, string> = {
  pay: 'Pay',
  cashOut: 'Cash Out',
  sendPayouts: 'Send Payouts',
  useAllowance: 'Use Allowance',
  mintTokens: 'Mint Tokens',
  burnTokens: 'Burn Tokens',
  launchProject: 'Launch Project',
  queueRuleset: 'Queue Ruleset',
  deployERC20: 'Deploy Token',
}

export default function ActionButton({ action, label }: ActionButtonProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const buttonLabel = label || ACTION_LABELS[action] || action

  return (
    <button
      onClick={() => {
        window.dispatchEvent(new CustomEvent('juice:send-message', {
          detail: { message: buttonLabel }
        }))
      }}
      className={`px-3 py-1.5 text-sm font-medium border transition-all ${
        isDark
          ? 'bg-green-500/20 border-green-400/40 text-green-300 hover:bg-green-500/35 hover:border-green-400'
          : 'bg-green-50 border-green-400/50 text-green-700 hover:bg-green-100 hover:border-green-500'
      }`}
    >
      {buttonLabel}
    </button>
  )
}
