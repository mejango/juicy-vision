import { useThemeStore } from '../../stores'

interface Chip {
  label: string
  prompt: string
  icon?: string
}

interface RecommendationChipsProps {
  chips?: Chip[]
  onSelect: (prompt: string) => void
}

const DEFAULT_CHIPS: Chip[] = [
  { label: 'Model my revenues', prompt: 'Help me model my revenue streams and design a treasury that fits', icon: '📊' },
  { label: 'Manage my revenues', prompt: 'Show me how to manage incoming revenues for my project', icon: '💰' },
  { label: 'Manage my payouts', prompt: 'Help me set up and manage payout splits for my project', icon: '📤' },
  { label: 'Design tokenomics', prompt: 'Help me design token issuance, reserved rates, and cash out mechanics', icon: '🪙' },
]

export default function RecommendationChips({
  chips = DEFAULT_CHIPS,
  onSelect
}: RecommendationChipsProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip, i) => (
        <button
          key={i}
          onClick={() => onSelect(chip.prompt)}
          className={`
            inline-flex items-center gap-1.5 px-3 py-1.5 text-sm
            transition-colors border
            ${isDark
              ? 'bg-transparent hover:bg-white/5 text-gray-300 border-white/20 hover:border-white/40'
              : 'bg-transparent hover:bg-gray-50 text-gray-700 border-gray-300 hover:border-gray-400'
            }
          `}
        >
          {chip.icon && <span className="text-base">{chip.icon}</span>}
          <span>{chip.label}</span>
        </button>
      ))}
    </div>
  )
}
