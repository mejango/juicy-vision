import { CHAINS, EXPLORER_URLS } from '../../constants'

const ACCENTS = {
  purple: {
    highlightDark: 'bg-purple-500/20 border border-purple-500/50',
    highlightLight: 'bg-purple-100 border border-purple-300',
    spinner: 'border-purple-500',
    signingTextDark: 'text-purple-300',
    signingTextLight: 'text-purple-600',
  },
  green: {
    highlightDark: 'bg-green-500/20 border border-green-500/50',
    highlightLight: 'bg-green-100 border border-green-300',
    spinner: 'border-green-500',
    signingTextDark: 'text-green-300',
    signingTextLight: 'text-green-600',
  },
  orange: {
    highlightDark: 'bg-juice-orange/20 border border-juice-orange/50',
    highlightLight: 'bg-orange-100 border border-orange-300',
    spinner: 'border-juice-orange',
    signingTextDark: 'text-juice-orange',
    signingTextLight: 'text-orange-600',
  },
} as const

export type ChainRowStatus = 'pending' | 'signing' | 'submitted' | 'confirmed' | 'failed'

interface ChainStatusRowProps {
  chainId: number
  status: ChainRowStatus
  isDark: boolean
  accent: keyof typeof ACCENTS
  txHash?: string
  /** When set, renders the "Project #<id>" tag next to the chain name. */
  projectId?: number
  highlighted?: boolean
  /** Shows the signing indicator even when `status` lags behind (e.g. bundle status still 'pending'). */
  signing?: boolean
  signingLabel?: string
  confirmedGlyph?: string
}

export default function ChainStatusRow({
  chainId,
  status,
  isDark,
  accent,
  txHash,
  projectId,
  highlighted = false,
  signing = false,
  signingLabel = 'Sign in wallet',
  confirmedGlyph = '✓',
}: ChainStatusRowProps) {
  const chainInfo = CHAINS[chainId]
  const colors = ACCENTS[accent]

  return (
    <div
      className={`p-3 flex items-center justify-between ${
        highlighted
          ? isDark ? colors.highlightDark : colors.highlightLight
          : isDark ? 'bg-white/5' : 'bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: chainInfo?.color || '#888' }}
        />
        <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {chainInfo?.name || `Chain ${chainId}`}
        </span>
        {projectId !== undefined && (
          <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Project #{projectId}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {status === 'pending' && (
          <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Waiting...
          </span>
        )}
        {(status === 'signing' || signing) && (
          <div className="flex items-center gap-2">
            <div className={`animate-spin w-3 h-3 border-2 ${colors.spinner} border-t-transparent rounded-full`} />
            <span className={`text-xs ${isDark ? colors.signingTextDark : colors.signingTextLight}`}>
              {signingLabel}
            </span>
          </div>
        )}
        {status === 'submitted' && (
          <div className="flex items-center gap-2">
            <div className="animate-spin w-3 h-3 border-2 border-juice-cyan border-t-transparent rounded-full" />
            <span className={`text-xs ${isDark ? 'text-juice-cyan' : 'text-cyan-600'}`}>
              Confirming...
            </span>
          </div>
        )}
        {status === 'confirmed' && (
          <div className="flex items-center gap-2">
            <span className="text-green-500">{confirmedGlyph}</span>
            {txHash && (
              <a
                href={`${EXPLORER_URLS[chainId]}${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-juice-cyan hover:underline"
              >
                View
              </a>
            )}
          </div>
        )}
        {status === 'failed' && (
          <span className="text-xs text-red-400">
            Failed
          </span>
        )}
      </div>
    </div>
  )
}
