import { useState, useEffect } from 'react'
import { useThemeStore } from '../../stores'
import { resolveIpfsUri } from '../../utils/ipfs'
import { resolveEnsName, truncateAddress } from '../../utils/ens'
import { getEventInfo, formatTimeAgo } from '../../utils/activityEvents'
import { CHAINS } from '../../constants'
import type { ActivityEvent } from '../../services/bendystraw/client'

interface ActivityItemProps {
  event: ActivityEvent
  onProjectClick?: (query: string) => void
}

export default function ActivityItem({ event, onProjectClick }: ActivityItemProps) {
  const { theme } = useThemeStore()
  const { action, amount, txHash, from } = getEventInfo(event)
  const chain = CHAINS[event.chainId] || { name: '?', color: '#888', explorer: 'https://etherscan.io' }
  const projectName = event.project?.name || 'Unknown Project'
  const logoUri = resolveIpfsUri(event.project?.logoUri)
  const [ensName, setEnsName] = useState<string | null>(null)

  // Resolve ENS name
  useEffect(() => {
    if (from) {
      resolveEnsName(from).then(setEnsName)
    }
  }, [from])

  const handleClick = () => {
    if (onProjectClick && event.project?.name) {
      const chainName = CHAINS[event.chainId]?.name || 'unknown chain'
      onProjectClick(`Tell me about "${event.project.name}" on ${chainName}. What's the project's current state, treasury balance, and recent activity?`)
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`relative overflow-hidden px-3 py-3 -mx-4 border-b cursor-pointer transition-colors ${
        theme === 'dark'
          ? 'border-white/10 hover:bg-white/5'
          : 'border-gray-200 hover:bg-black/5'
      }`}
    >
      {/* Background logo */}
      {logoUri && (
        <div
          className="absolute right-0 top-1/2 -translate-y-1/2 w-16 h-16 opacity-20"
          style={{
            backgroundImage: `url(${logoUri})`,
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
          }}
        />
      )}

      {/* Content overlay */}
      <div className="relative z-10">
        {/* Top row: Project name + time */}
        <div className="flex items-center gap-2">
          <span className={`flex-1 min-w-0 text-xs font-medium truncate ${
            theme === 'dark' ? 'text-juice-cyan' : 'text-teal-600'
          }`}>
            {projectName}
          </span>
          <span className={`text-[10px] shrink-0 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
            {formatTimeAgo(event.timestamp)}
          </span>
        </div>

        {/* Middle row: Action + Amount */}
        <div className="flex items-baseline gap-1.5 mt-0.5">
          <span className={`text-[10px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
            {action}
          </span>
          {amount && (
            <span className={`text-xs font-semibold ${
              theme === 'dark' ? 'text-juice-orange' : 'text-orange-600'
            }`}>
              {amount}
            </span>
          )}
        </div>

        {/* Bottom row: "address on CHAIN" + link icon */}
        <div className={`flex items-center gap-1.5 mt-0.5 text-[10px] ${
          theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
        }`}>
          {from && (
            <>
              <span className="truncate">{ensName || truncateAddress(from)}</span>
              <span>on</span>
              <span
                className="text-[8px] font-bold px-1 py-0.5 rounded"
                style={{ backgroundColor: `${chain.color}80`, color: 'rgba(255,255,255,0.85)' }}
              >
                {chain.shortName || chain.name}
              </span>
            </>
          )}
          {txHash && (
            <a
              href={`${chain.explorer}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="hover:text-juice-cyan"
            >
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
