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
          flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer ${
            isAllSelected
              ? isDark
                ? 'bg-white/20 text-white'
                : 'bg-gray-200 text-gray-900'
              : isDark
                ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-900'
          }
        `}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: isAllSelected ? CHART_COLORS.primary : isDark ? '#666' : '#ccc' }}
        />
        <span>All</span>
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
              inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer ${
                isSelected
                  ? isDark
                    ? 'bg-white/20 text-white'
                    : 'bg-gray-200 text-gray-900'
                  : isDark
                    ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-900'
              }
            `}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span>{name}</span>
          </button>
        )
      })}
    </div>
  )
}
