import { useThemeStore } from '../../../stores'
import { getChainColor, getChainName, CHART_COLORS } from './utils'

interface ChainToggleBarProps {
  availableChains: number[]
  selectedChains: Set<number> | 'all'
  onToggle: (chainId: number) => void
  onSelectAll: () => void
}

export default function ChainToggleBar({
  availableChains,
  selectedChains,
  onToggle,
  onSelectAll,
}: ChainToggleBarProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const isAllSelected = selectedChains === 'all'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* All button */}
      <button
        onClick={onSelectAll}
        className={`
          flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-all cursor-pointer
          ${isAllSelected
            ? isDark
              ? 'border-juice-orange/40 bg-juice-orange/10'
              : 'border-juice-orange/40 bg-juice-orange/10'
            : isDark
              ? 'border-white/10 hover:border-white/20'
              : 'border-gray-200 hover:border-gray-300'
          }
        `}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: isAllSelected ? CHART_COLORS.primary : isDark ? '#666' : '#ccc' }}
        />
        <span className={isAllSelected ? 'text-juice-orange' : (isDark ? 'text-gray-500' : 'text-gray-400')}>
          All
        </span>
      </button>

      {/* Per-chain toggles */}
      {availableChains.map(chainId => {
        const isSelected = !isAllSelected && (selectedChains as Set<number>).has(chainId)
        const color = getChainColor(chainId)
        const name = getChainName(chainId)

        return (
          <button
            key={chainId}
            onClick={() => onToggle(chainId)}
            className={`
              flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-all cursor-pointer
              ${isSelected
                ? isDark
                  ? 'border-white/20 bg-white/5'
                  : 'border-gray-300 bg-gray-50'
                : isDark
                  ? 'border-white/10 hover:border-white/20'
                  : 'border-gray-200 hover:border-gray-300'
              }
            `}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: isSelected ? color : isDark ? '#666' : '#ccc' }}
            />
            <span className={isSelected ? (isDark ? 'text-white' : 'text-gray-900') : (isDark ? 'text-gray-500' : 'text-gray-400')}>
              {name}
            </span>
          </button>
        )
      })}
    </div>
  )
}
