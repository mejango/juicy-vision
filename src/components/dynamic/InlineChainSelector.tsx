import type { ReactNode } from 'react'
import { CHAINS, MAINNET_CHAINS } from '../../constants'

// Mainnet info is always available; environment-specific (testnet) entries overlay it.
const CHAIN_INFO = { ...MAINNET_CHAINS, ...CHAINS }

export type ChainSelectorOption = {
  /** React key + identity passed back through onSelect. */
  key: string | number
  chainId: number
  selected: boolean
  /** Optional label override (variant "row"); defaults to the chain's short name. */
  label?: ReactNode
  /** Optional trailing content rendered after the label (variant "compact"). */
  suffix?: ReactNode
}

/**
 * Shared inline chain-pill selector used by the dynamic forms.
 * - "compact": small pills with hover text color changes (DeployERC20Form,
 *   SendReservedTokensForm, RulesetSchedule style).
 * - "row": truncating pills with an aria-label (SendPayoutsForm,
 *   UseSurplusAllowanceForm style).
 * Renders nothing when there is at most one option.
 */
export default function InlineChainSelector({
  options,
  onSelect,
  isDark,
  variant = 'compact',
  ariaLabel,
}: {
  options: ChainSelectorOption[]
  onSelect: (option: ChainSelectorOption) => void
  isDark: boolean
  variant?: 'compact' | 'row'
  ariaLabel?: string
}) {
  if (options.length <= 1) return null

  if (variant === 'row') {
    return (
      <div className="flex min-w-0 flex-wrap gap-1" aria-label={ariaLabel}>
        {options.map(option => {
          const chain = CHAIN_INFO[option.chainId] || {
            name: `Chain ${option.chainId}`,
            shortName: String(option.chainId),
            color: '#888888',
          }
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onSelect(option)}
              className={`inline-flex min-w-0 items-center gap-1 px-2 py-1 text-[10px] ${option.selected
                ? isDark ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-900'
                : isDark ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
              }`}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: chain.color }} />
              <span className="min-w-0 truncate">{option.label ?? chain.shortName}</span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {options.map(option => {
        const chain = CHAIN_INFO[option.chainId] || {
          name: `Chain ${option.chainId}`,
          shortName: String(option.chainId),
          color: '#888888',
        }
        return (
          <button
            key={option.key}
            onClick={() => onSelect(option)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium transition-colors ${
              option.selected
                ? isDark
                  ? 'bg-white/20 text-white'
                  : 'bg-gray-200 text-gray-900'
                : isDark
                  ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                  : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: chain.color }}
            />
            {chain.shortName}
            {option.suffix}
          </button>
        )
      })}
    </div>
  )
}
