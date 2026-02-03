import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'
import { fetchSuckerGroupBalance, fetchEthPrice } from '../../services/bendystraw'

interface MascotPanelProps {
  onSuggestionClick: (text: string) => void
}

export default function MascotPanel({ onSuggestionClick }: MascotPanelProps) {
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const [balanceUsd, setBalanceUsd] = useState<number | null>(null)

  useEffect(() => {
    async function loadBalance() {
      try {
        const [balance, ethPrice] = await Promise.all([
          fetchSuckerGroupBalance('1', 1),
          fetchEthPrice(),
        ])
        if (balance && ethPrice) {
          const balanceEth = parseFloat(balance.totalBalance) / 1e18
          setBalanceUsd(balanceEth * ethPrice)
        }
      } catch (err) {
        console.error('Failed to fetch NANA balance:', err)
      }
    }
    loadBalance()
  }, [])

  return (
    <div className={`w-full h-full flex flex-col backdrop-blur-md relative overflow-y-auto hide-scrollbar ${
      theme === 'dark'
        ? 'bg-juice-dark/75'
        : 'bg-white/75'
    }`}>
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => onSuggestionClick('I want to pay project ID 1 (NANA)')}
          className={`px-3 py-1.5 text-sm border transition-colors ${
            theme === 'dark'
              ? 'border-green-500/50 text-green-400 hover:border-green-500 hover:bg-green-500/10 bg-juice-dark/60 backdrop-blur-sm'
              : 'border-green-500/60 text-green-600 hover:border-green-500 hover:bg-green-50 bg-white/60 backdrop-blur-sm'
          }`}
        >
          {t('ui.joinUs', 'Join us')}
        </button>
      </div>

      <div className={`absolute right-2 bottom-2 z-10 animate-bounce ${
        theme === 'dark' ? 'text-green-500' : 'text-green-600'
      }`}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </div>

      <div className="flex-1 flex flex-col items-center px-4">
        <div className="shrink-0 w-full flex flex-col items-center justify-end" style={{ height: 'calc(100vh * 0.62 - 8px)' }}>
          <div className="flex-1 flex items-end justify-center pointer-events-none" style={{ maxHeight: 'calc(100vh * 0.52)' }}>
            <img
              src={theme === 'dark' ? '/mascot-dark.png' : '/mascot-light.png'}
              alt="Juicy Mascot"
              className="drop-shadow-lg h-full object-contain"
            />
          </div>

          <div className="pb-4 pointer-events-none text-center px-4" style={{ marginTop: '-5vh' }}>
            <p className="text-sm sm:text-base md:text-lg font-bold text-juice-orange whitespace-pre-line">
              {t('mascot.tagline', 'Fund Your Thing Your Way')}
            </p>
          </div>
        </div>

        <div className="flex items-start pt-16 pb-8">
          <div className={`p-4 max-w-[340px] ${
            theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
          }`}>
            {/* Hero section */}
            <div className={`pb-4 mb-4 border-b ${
              theme === 'dark' ? 'border-white/10' : 'border-gray-200'
            }`}>
              <p className={`text-sm leading-relaxed font-medium ${
                theme === 'dark' ? 'text-gray-200' : 'text-gray-700'
              }`}>
                {t('juicyExplainer.intro', "The juiciest way to fund and grow your project.")}
              </p>
              <p className={`text-sm leading-relaxed mt-3 ${
                theme === 'dark' ? 'text-gray-200' : 'text-gray-700'
              }`}>
                {t('juicyExplainer.useIt', 'Use it to run your fundraise, operate your business, manage your campaign, sell to customers, work with your community, and build out your dreams.')}
              </p>
              <p className={`text-sm leading-relaxed mt-3 ${
                theme === 'dark' ? 'text-gray-200' : 'text-gray-700'
              }`}>
                {t('juicyExplainer.promptAway', 'Just prompt away, in private or together.')}
              </p>
              <button
                onClick={() => onSuggestionClick('I want to pay project ID 1 (NANA)')}
                className={`mt-4 px-3 py-1.5 text-sm border transition-colors ${
                  theme === 'dark'
                    ? 'border-green-500/50 text-green-400 hover:border-green-500 hover:bg-green-500/10'
                    : 'border-green-500/60 text-green-600 hover:border-green-500 hover:bg-green-50'
                }`}
              >
                Join us
              </button>
              {balanceUsd !== null && (
                <p className={`text-xs font-mono mt-2 ${
                  theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                }`}>
                  {t('ui.nanaBalance', 'NANA balance')} ${balanceUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
              )}
            </div>

            {/* Details section */}
            <p className="text-xs leading-relaxed">
              {t('juicyExplainer.paragraph1')}
            </p>
            <p className="text-xs leading-relaxed mt-3">
              {t('juicyExplainer.paragraph2')}
            </p>
            <button
              onClick={() => onSuggestionClick('I want to pay project ID 1 (NANA)')}
              className={`mt-4 px-3 py-1.5 text-sm border transition-colors ${
                theme === 'dark'
                  ? 'border-green-500/50 text-green-400 hover:border-green-500 hover:bg-green-500/10'
                  : 'border-green-500/60 text-green-600 hover:border-green-500 hover:bg-green-50'
              }`}
            >
              {t('ui.joinUs', 'Join us')}
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
            <button
              onClick={() => onSuggestionClick('I want to create a project just like NANA')}
              className={`mt-3 px-3 py-1.5 text-xs border transition-colors ${
                theme === 'dark'
                  ? 'border-gray-600 text-gray-500 hover:border-gray-500 hover:text-gray-400'
                  : 'border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-500'
              }`}
            >
              Copy us
            </button>
            <p className={`text-xs leading-relaxed mt-3 ${
              theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
            }`}>
              {t('juicyExplainer.teachSkills', 'Teach the juicebox skills that Juicy is based on to your AI')}{' '}
              <a
                href="https://github.com/mejango/juicebox-skills"
                target="_blank"
                rel="noopener noreferrer"
                className={`underline hover:no-underline ${
                  theme === 'dark' ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'
                }`}
              >
                here
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
