import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'
import { useViewAsStore } from '../../stores/viewAsStore'
import { useEnsNameResolved } from '../../hooks/useEnsName'
import { truncateAddress } from '../../utils/ens'
import ViewAsMenuAction from './ViewAsMenuAction'

/** Compact view-as identity that replaces the normal connected-wallet state. */
export default function ViewAsWalletState({ hasConnectedWallet }: { hasConnectedWallet: boolean }) {
  const viewAs = useViewAsStore(s => s.viewAs)
  const clearViewAs = useViewAsStore(s => s.clearViewAs)
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const { ensName } = useEnsNameResolved(viewAs ?? undefined)
  const [open, setOpen] = useState(false)

  if (!viewAs) return null

  return (
    <div data-testid="view-as-wallet-state" className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className={`inline-flex items-center gap-1.5 border px-2 py-1 font-medium transition-colors ${
          theme === 'dark'
            ? 'border-amber-500/60 bg-amber-950/60 text-amber-300 hover:bg-amber-500/20'
            : 'border-amber-500 bg-amber-50 text-amber-800 hover:bg-amber-100'
        }`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        <span className="truncate">
          {t('viewAs.banner', 'Viewing as')}{' '}
          <span className="font-semibold">{ensName || truncateAddress(viewAs)}</span>
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute left-0 top-full z-[70] mt-1 min-w-52 border p-1 shadow-lg ${
            theme === 'dark'
              ? 'border-white/15 bg-zinc-900 text-gray-200'
              : 'border-gray-200 bg-white text-gray-800'
          }`}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              clearViewAs()
              setOpen(false)
            }}
            className={`block w-full px-3 py-2 text-left text-xs font-medium ${
              theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-amber-50'
            }`}
          >
            {hasConnectedWallet
              ? t('viewAs.connectedWallet', 'View as connected wallet')
              : t('viewAs.exit', 'Exit View as')}
          </button>
          <ViewAsMenuAction alternate menuItem onActivate={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  )
}
