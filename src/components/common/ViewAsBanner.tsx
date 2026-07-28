import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'
import { useViewAsStore } from '../../stores/viewAsStore'
import { useEnsNameResolved } from '../../hooks/useEnsName'
import { truncateAddress } from '../../utils/ens'

/**
 * Slim, persistent top-of-page banner shown whenever view-as mode is active.
 * Rendered at the App layout level so every route carries it.
 */
export default function ViewAsBanner() {
  const viewAs = useViewAsStore(s => s.viewAs)
  const clearViewAs = useViewAsStore(s => s.clearViewAs)
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const { ensName } = useEnsNameResolved(viewAs ?? undefined)

  if (!viewAs) return null

  return (
    <div
      data-testid="view-as-banner"
      className={`fixed top-0 inset-x-0 z-[70] flex items-center justify-center gap-3 px-4 py-1 text-xs border-b ${
        theme === 'dark'
          ? 'bg-amber-950/90 border-amber-500/50 text-amber-300 backdrop-blur-sm'
          : 'bg-amber-50/95 border-amber-400 text-amber-800 backdrop-blur-sm'
      }`}
    >
      <span className="truncate">
        {t('viewAs.banner', 'Viewing as')}{' '}
        <span className="font-semibold">{ensName || truncateAddress(viewAs)}</span>
      </span>
      <button
        onClick={clearViewAs}
        className={`shrink-0 px-2 py-0.5 border font-medium transition-colors ${
          theme === 'dark'
            ? 'border-amber-500/60 hover:bg-amber-500/20'
            : 'border-amber-500 hover:bg-amber-100'
        }`}
      >
        {t('viewAs.exit', 'Exit')}
      </button>
    </div>
  )
}
