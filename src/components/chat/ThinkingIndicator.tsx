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
    <span className="inline-flex items-center gap-1.5 text-juice-orange font-semibold">
      {/* Glitchy lightning bolt */}
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="currentColor"
        style={{
          animation: 'lightning 2.5s ease-in-out infinite',
        }}
      >
        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
      </svg>
      <span>{verb}...</span>
      <style>{`
        @keyframes lightning {
          /* Dim state */
          0%, 100% { opacity: 0.3; }

          /* First strike */
          8% { opacity: 0.3; }
          9% { opacity: 1; }
          10% { opacity: 0.15; }
          11% { opacity: 0.6; }
          12% { opacity: 0.3; }

          /* Quick double flash */
          25% { opacity: 0.3; }
          26% { opacity: 1; }
          27% { opacity: 0.2; }
          28% { opacity: 0.9; }
          29% { opacity: 0.15; }
          31% { opacity: 0.3; }

          /* Single strike */
          45% { opacity: 0.3; }
          46% { opacity: 1; }
          48% { opacity: 0.2; }
          50% { opacity: 0.3; }

          /* Rapid triple shock */
          65% { opacity: 0.3; }
          66% { opacity: 1; }
          67% { opacity: 0.15; }
          68% { opacity: 0.85; }
          69% { opacity: 0.1; }
          70% { opacity: 0.95; }
          71% { opacity: 0.2; }
          73% { opacity: 0.3; }

          /* Quiet period then single */
          88% { opacity: 0.3; }
          89% { opacity: 0.8; }
          91% { opacity: 0.3; }
        }
      `}</style>
    </span>
  )
}
