import { useState } from 'react'
import { useAuthStore, PRIVACY_MODES, type PrivacyMode } from '../../stores/authStore'
import { useThemeStore } from '../../stores'

export default function PrivacySelector() {
  const { theme } = useThemeStore()
  const { privacyMode, setPrivacyMode, mode } = useAuthStore()
  const [menuOpen, setMenuOpen] = useState(false)

  const currentConfig = PRIVACY_MODES[privacyMode]

  // Privacy mode icons
  const icons: Record<PrivacyMode, JSX.Element> = {
    open_book: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
    anonymous: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c-1.5 0-3-1-3-3" />
      </svg>
    ),
    private: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
    ghost: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
      </svg>
    ),
  }

  const handleSelect = (newMode: PrivacyMode) => {
    const config = PRIVACY_MODES[newMode]

    // Ghost mode requires self-custody
    if (config.requiresSelfCustody && mode === 'managed') {
      // Could show a toast/warning here
      console.warn('Ghost mode requires self-custody. Switching to self-custody mode.')
    }

    setPrivacyMode(newMode)
    setMenuOpen(false)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className={`p-1.5 transition-colors ${
          theme === 'dark'
            ? 'text-gray-400 hover:text-white'
            : 'text-gray-500 hover:text-gray-900'
        }`}
        title={`Privacy: ${currentConfig.name}`}
      >
        {icons[privacyMode]}
      </button>

      {menuOpen && (
        <div
          className={`absolute top-full right-0 mt-1 py-1 border shadow-lg min-w-[200px] ${
            theme === 'dark'
              ? 'bg-juice-dark border-white/20'
              : 'bg-white border-gray-200'
          }`}
          onMouseLeave={() => setMenuOpen(false)}
        >
          <div className={`px-3 py-2 text-xs font-medium border-b ${
            theme === 'dark'
              ? 'text-gray-400 border-white/10'
              : 'text-gray-500 border-gray-200'
          }`}>
            Privacy Mode
          </div>

          {(Object.entries(PRIVACY_MODES) as [PrivacyMode, typeof currentConfig][]).map(([key, config]) => {
            const isDisabled = config.requiresSelfCustody && mode === 'managed'

            return (
              <button
                key={key}
                onClick={() => !isDisabled && handleSelect(key)}
                disabled={isDisabled}
                className={`w-full px-3 py-2 text-left transition-colors flex items-start gap-2 ${
                  privacyMode === key
                    ? theme === 'dark'
                      ? 'bg-juice-orange/20 text-juice-orange'
                      : 'bg-orange-50 text-orange-700'
                    : isDisabled
                      ? theme === 'dark'
                        ? 'text-gray-600 cursor-not-allowed'
                        : 'text-gray-400 cursor-not-allowed'
                      : theme === 'dark'
                        ? 'text-white/80 hover:bg-white/10'
                        : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span className="mt-0.5">{icons[key]}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">
                    {config.name}
                    {isDisabled && (
                      <span className={`ml-1 text-xs ${
                        theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                      }`}>
                        (self-custody only)
                      </span>
                    )}
                  </div>
                  <div className={`text-xs mt-0.5 ${
                    theme === 'dark' ? 'text-gray-500' : 'text-gray-500'
                  }`}>
                    {config.description}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
