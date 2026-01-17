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
  const { action, amount, txHash, from, fromContext } = getEventInfo(event)
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
      className={`flex gap-3 px-4 py-3 -mx-4 border-b cursor-pointer transition-colors ${
        theme === 'dark'
          ? 'border-white/10 hover:bg-white/5'
          : 'border-gray-200 hover:bg-black/5'
      }`}
    >
      {/* Project Logo */}
      <div className={`w-10 h-10 rounded-full overflow-hidden flex-shrink-0 border ${
        theme === 'dark' ? 'border-gray-600 bg-juice-dark-lighter' : 'border-gray-300 bg-gray-100'
      }`}>
        {logoUri ? (
          <img src={logoUri} alt={projectName} className="w-full h-full object-cover" />
        ) : (
          <div className={`w-full h-full flex items-center justify-center text-xs font-bold ${
            theme === 'dark' ? 'bg-juice-orange/20 text-juice-orange' : 'bg-juice-orange/10 text-juice-orange'
          }`}>
            {projectName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Project name + chain */}
        <div className="flex items-center gap-2">
          <span className={`font-medium truncate ${
            theme === 'dark' ? 'text-juice-cyan' : 'text-teal-600'
          }`}>
            {projectName.length > 20 ? `${projectName.slice(0, 20)}...` : projectName}
          </span>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: `${chain.color}20`, color: chain.color }}
          >
            {chain.name}
          </span>
        </div>

        {/* Action */}
        <div className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
          {action}
        </div>

        {/* Amount */}
        {amount && (
          <div className={`font-semibold ${
            theme === 'dark' ? 'text-juice-orange' : 'text-orange-600'
          }`}>
            {amount}
          </div>
        )}

        {/* Metadata - each on own line */}
        <div className={`text-xs mt-1.5 space-y-0.5 ${
          theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
        }`}>
          <div>{formatTimeAgo(event.timestamp)}</div>
          {from && (
            <div>{fromContext} {ensName || truncateAddress(from)}</div>
          )}
          {txHash && (
            <a
              href={`${chain.explorer}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 hover:text-juice-cyan"
            >
              <span>View tx</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
