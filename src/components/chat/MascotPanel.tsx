import { useThemeStore } from '../../stores'

interface MascotPanelProps {
  onSuggestionClick: (text: string) => void
}

export default function MascotPanel({ onSuggestionClick }: MascotPanelProps) {
  const { theme } = useThemeStore()

  return (
    <div className={`w-full h-full flex flex-col backdrop-blur-md relative overflow-y-auto hide-scrollbar ${
      theme === 'dark'
        ? 'bg-juice-dark/60'
        : 'bg-white/60'
    }`}>
      {/* Pay us button - top right */}
      <button
        onClick={() => onSuggestionClick('I want to pay project ID 1 (NANA)')}
        className={`absolute top-4 right-4 z-10 px-3 py-1.5 text-sm border transition-colors ${
          theme === 'dark'
            ? 'border-green-500/50 text-green-400 hover:border-green-500 hover:bg-green-500/10 bg-juice-dark/60 backdrop-blur-sm'
            : 'border-green-500/60 text-green-600 hover:border-green-500 hover:bg-green-50 bg-white/60 backdrop-blur-sm'
        }`}
      >
        Pay us
      </button>

      {/* Subtle scroll hint arrow - bottom right */}
      <div className={`absolute bottom-4 right-4 z-10 animate-bounce ${
        theme === 'dark' ? 'text-gray-600' : 'text-gray-300'
      }`}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </div>

      {/* Scrollable content - mascot bottom-aligned in visible fold */}
      <div className="flex-1 flex flex-col items-center px-4">
        {/* First section: visible fold - mascot bottom-aligned within container */}
        <div className="shrink-0 w-full flex flex-col items-center justify-end" style={{ height: 'calc(100vh * 0.62 - 8px)' }}>
          <div className="flex-1 flex items-end justify-center pointer-events-none pb-2" style={{ maxHeight: 'calc(100vh * 0.45)' }}>
            <img
              src={theme === 'dark' ? '/mascot-dark.png' : '/mascot-light.png'}
              alt="Juicy Mascot"
              className="drop-shadow-lg h-full object-contain"
            />
          </div>

          <div className="pb-4 pointer-events-none text-center px-2">
            <p className="text-lg sm:text-xl font-bold text-juice-orange whitespace-nowrap">
              Fund Your Thing Your Way
            </p>
          </div>
        </div>

        {/* $JUICY explainer - just below the fold, scrolls into view */}
        <div className="flex items-start pt-16 pb-8">
          <div className={`p-4 max-w-[280px] ${
            theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
          }`}>
            <p className="text-xs leading-relaxed">
              $JUICY is the revenue token that powers this app. When you pay into Juicy Vision, you receive $JUICY tokens proportional to your contribution.
            </p>
            <p className="text-xs leading-relaxed mt-3">
              As the balance grows, so does the value backing each token. You can cash out anytime for your share, or hold to support the community business.
            </p>
            <p className={`text-xs leading-relaxed mt-3 ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
            }`}>
              We run extremely lean. Revenue from the app mostly flows back to $JUICY holders, guaranteed. The more value created, the more everyone benefits. We're in this together, and LLM costs do accumulate.
            </p>
            <button
              onClick={() => onSuggestionClick('I want to pay project ID 1 (NANA)')}
              className={`mt-4 px-3 py-1.5 text-sm border transition-colors ${
                theme === 'dark'
                  ? 'border-green-500/50 text-green-400 hover:border-green-500 hover:bg-green-500/10'
                  : 'border-green-500/60 text-green-600 hover:border-green-500 hover:bg-green-50'
              }`}
            >
              Pay us
            </button>
            <p className={`text-xs leading-relaxed mt-4 pt-4 border-t ${
              theme === 'dark' ? 'text-gray-500 border-white/10' : 'text-gray-400 border-gray-200'
            }`}>
              Uses{' '}
              <a
                href="https://revnet.app"
                target="_blank"
                rel="noopener noreferrer"
                className={`underline hover:no-underline ${
                  theme === 'dark' ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'
                }`}
              >
                revnets
              </a>
              , powered by{' '}
              <a
                href="https://docs.juicebox.money"
                target="_blank"
                rel="noopener noreferrer"
                className={`underline hover:no-underline ${
                  theme === 'dark' ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'
                }`}
              >
                Juicebox
              </a>
              , secured by Ethereum, Optimism, Base, and Arbitrum.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
