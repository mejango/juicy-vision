import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'

interface ActionButtonProps {
  action: string
  label?: string
}

const ACTION_KEY_MAP: Record<string, string> = {
  pay: 'actions.pay',
  cashOut: 'actions.cashOut',
  sendPayouts: 'actions.sendPayouts',
  useAllowance: 'actions.useAllowance',
  mintTokens: 'actions.mintTokens',
  burnTokens: 'actions.burnTokens',
  launchProject: 'actions.launchProject',
  launch721Project: 'actions.launchProject',
  queueRuleset: 'actions.queueRuleset',
  deployERC20: 'actions.deployToken',
}

export default function ActionButton({ action, label }: ActionButtonProps) {
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const isDark = theme === 'dark'

  const buttonLabel = label || (ACTION_KEY_MAP[action] ? t(ACTION_KEY_MAP[action]) : action)

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
