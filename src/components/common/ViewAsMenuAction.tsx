import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'
import { useViewAsStore } from '../../stores/viewAsStore'
import { resolveEnsToAddress } from '../../utils/ens'

const VIEW_AS_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/

/** Final, separated wallet-menu action for browsing as an address or ENS name. */
export default function ViewAsMenuAction({
  onActivate,
  alternate = false,
  menuItem = false,
}: {
  onActivate?: () => void
  alternate?: boolean
  menuItem?: boolean
}) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { t } = useTranslation()
  const setViewAs = useViewAsStore(s => s.setViewAs)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activate = async () => {
    const input = value.trim()
    if (!input) return
    setError(null)
    if (VIEW_AS_ADDRESS_REGEX.test(input)) {
      setViewAs(input)
      setOpen(false)
      setValue('')
      onActivate?.()
      return
    }
    if (input.includes('.')) {
      setResolving(true)
      try {
        const resolved = await resolveEnsToAddress(input)
        if (resolved) {
          setViewAs(resolved)
          setOpen(false)
          setValue('')
          onActivate?.()
        } else {
          setError(t('viewAs.notFound', 'Could not resolve that name'))
        }
      } finally {
        setResolving(false)
      }
      return
    }
    setError(t('viewAs.invalid', 'Enter a 0x address or ENS name'))
  }

  return (
    <div className={`mt-3 border-t pt-2 ${isDark ? 'border-white/15' : 'border-gray-200'}`}>
      {open ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={value}
              onChange={event => {
                setValue(event.target.value)
                setError(null)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') void activate()
                if (event.key === 'Escape') {
                  setOpen(false)
                  setValue('')
                  setError(null)
                }
              }}
              placeholder={t('viewAs.placeholder', 'Address or ENS…')}
              className={`min-w-0 flex-1 border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-amber-500 ${
                isDark
                  ? 'border-white/20 text-white placeholder-gray-500'
                  : 'border-gray-300 text-gray-900 placeholder-gray-400'
              }`}
            />
            <button
              type="button"
              onClick={() => void activate()}
              disabled={resolving}
              className={`border px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                isDark
                  ? 'border-amber-500/60 text-amber-300 hover:bg-amber-500/20'
                  : 'border-amber-500 text-amber-700 hover:bg-amber-100'
              }`}
            >
              {resolving ? '…' : t('viewAs.go', 'View')}
            </button>
          </div>
          {error ? <p className="text-xs text-red-400">{error}</p> : null}
        </div>
      ) : (
        <button
          type="button"
          role={menuItem ? 'menuitem' : undefined}
          onClick={() => setOpen(true)}
          className={`block w-full px-2 py-2 text-left text-xs font-medium transition-colors ${
            isDark ? 'text-gray-400 hover:bg-white/10 hover:text-amber-300' : 'text-gray-600 hover:bg-gray-50 hover:text-amber-700'
          }`}
        >
          {alternate
            ? t('viewAs.another', 'View as another account…')
            : t('viewAs.action', 'View as…')}
        </button>
      )}
    </div>
  )
}
