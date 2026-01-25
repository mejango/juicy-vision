import { useState } from 'react'
import { useTranslation } from 'react-i18next'

// Juice and fruit-themed verb keys for thinking states
const THINKING_VERB_KEYS = [
  'squeezing',
  'pulping',
  'juicing',
  'fermenting',
  'zesting',
  'blending',
  'ripening',
  'peeling',
  'extracting',
  'muddling',
  'straining',
  'macerating',
  'pressing',
  'infusing',
  'distilling',
  'concentrating',
  'sweetening',
  'garnishing',
  'citrusing',
  'nectaring',
  'smoothiefying',
  'marinating',
  'caramelizing',
  'pureeing',
  'simmering',
  'reducing',
  'drizzling',
  'tasteTesting',
  'bottling',
  'uncorking',
]

export default function ThinkingIndicator() {
  const { t } = useTranslation()
  const [verbKey] = useState(() =>
    THINKING_VERB_KEYS[Math.floor(Math.random() * THINKING_VERB_KEYS.length)]
  )
  const verb = t(`thinkingVerbs.${verbKey}`)

  return (
    <span className="text-juice-orange font-semibold">
      {verb}
      <span className="inline-flex ml-1" style={{ letterSpacing: '-0.15em' }}>
        <span className="dot-shimmer" style={{ animationDelay: '0s' }}>.</span>
        <span className="dot-shimmer" style={{ animationDelay: '0.15s' }}>.</span>
        <span className="dot-shimmer" style={{ animationDelay: '0.3s' }}>.</span>
      </span>
      <style>{`
        @keyframes dotShimmer {
          0%, 40% { opacity: 0.35; }
          45%, 55% { opacity: 1; }
          60%, 100% { opacity: 0.35; }
        }
        .dot-shimmer {
          animation: dotShimmer 0.9s steps(1, end) infinite;
        }
      `}</style>
    </span>
  )
}
