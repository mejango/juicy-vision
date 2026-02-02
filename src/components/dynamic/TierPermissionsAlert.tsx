import { useThemeStore } from '../../stores'
import type { JB721HookFlags } from '../../services/nft'
import { getBlockedOperations } from '../../services/nft'

interface TierPermissionsAlertProps {
  flags: JB721HookFlags
  onDeployNew?: () => void
  compact?: boolean
}

export default function TierPermissionsAlert({
  flags,
  onDeployNew,
  compact = false,
}: TierPermissionsAlertProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const blockedOperations = getBlockedOperations(flags)

  // If nothing is blocked, don't render
  if (blockedOperations.length === 0) {
    return null
  }

  // Check if all major tier features are blocked
  const allBlocked =
    flags.noNewTiersWithReserves &&
    flags.noNewTiersWithVotes &&
    flags.noNewTiersWithOwnerMinting

  if (compact) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 text-xs ${
        isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-700'
      }`}>
        <span className="text-sm">!</span>
        <span>
          {blockedOperations.length === 1
            ? `${blockedOperations[0]} is restricted`
            : `${blockedOperations.length} operations restricted`}
        </span>
      </div>
    )
  }

  return (
    <div className={`p-4 border ${
      allBlocked
        ? isDark
          ? 'bg-red-500/10 border-red-500/30'
          : 'bg-red-50 border-red-200'
        : isDark
          ? 'bg-amber-500/10 border-amber-500/30'
          : 'bg-amber-50 border-amber-200'
    }`}>
      <div className="flex items-start gap-3">
        <span className={`text-xl ${
          allBlocked
            ? isDark ? 'text-red-400' : 'text-red-600'
            : isDark ? 'text-amber-400' : 'text-amber-600'
        }`}>
          {allBlocked ? '!' : '!'}
        </span>
        <div className="flex-1">
          <h4 className={`font-medium mb-2 ${
            allBlocked
              ? isDark ? 'text-red-300' : 'text-red-800'
              : isDark ? 'text-amber-300' : 'text-amber-800'
          }`}>
            {allBlocked
              ? 'Collection Has Restrictions'
              : 'Some Operations Restricted'}
          </h4>

          <p className={`text-sm mb-3 ${
            isDark ? 'text-gray-400' : 'text-gray-600'
          }`}>
            This NFT collection was deployed with the following restrictions:
          </p>

          <ul className={`text-sm space-y-1.5 mb-3 ${
            isDark ? 'text-gray-300' : 'text-gray-700'
          }`}>
            {blockedOperations.map((op, idx) => (
              <li key={idx} className="flex items-center gap-2">
                <span className={`${
                  allBlocked
                    ? isDark ? 'text-red-400' : 'text-red-500'
                    : isDark ? 'text-amber-400' : 'text-amber-500'
                }`}>
                  x
                </span>
                {op}
              </li>
            ))}
          </ul>

          {allBlocked && (
            <p className={`text-xs mb-3 ${
              isDark ? 'text-gray-500' : 'text-gray-500'
            }`}>
              To use these features, you would need to deploy a new NFT collection
              with different settings.
            </p>
          )}

          {onDeployNew && (
            <button
              onClick={onDeployNew}
              className={`text-sm font-medium transition-colors ${
                allBlocked
                  ? isDark
                    ? 'text-red-400 hover:text-red-300'
                    : 'text-red-600 hover:text-red-700'
                  : isDark
                    ? 'text-amber-400 hover:text-amber-300'
                    : 'text-amber-600 hover:text-amber-700'
              }`}
            >
              Deploy New Collection
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
